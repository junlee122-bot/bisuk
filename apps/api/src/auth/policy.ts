import type { PublicUser, UserRole } from "@seokmun/types";
import type { Db } from "../db";
import {
  comments,
  comparisons,
  glyphCells,
  readings,
  researchSets,
  setMembers,
  steleAssets,
  steleTabs,
} from "../repo";
import { assetVariants } from "../threeD/store";

export const ROLE_RANK: Record<UserRole, number> = { GUEST: 1, RESEARCHER: 2, PI: 3 };

export function hasRole(user: PublicUser | null, min: UserRole): boolean {
  return Boolean(user && ROLE_RANK[user.role] >= ROLE_RANK[min]);
}

export type MinRole = UserRole | "PUBLIC";

/**
 * 라우트별 최소 역할 — 지정이 없으면 GET은 GUEST, 변경은 RESEARCHER.
 * 키: "METHOD /route/pattern"
 */
const ROUTE_ROLES: Record<string, MinRole> = {
  "GET /api/health": "PUBLIC",
  "GET /api/auth/status": "PUBLIC",
  "POST /api/auth/login": "PUBLIC",
  "POST /api/auth/setup": "PUBLIC",
  "POST /api/auth/logout": "PUBLIC",
  // 공개 쇼케이스 — 세트 가시성은 핸들러에서 검사
  "GET /api/showcase/:setId": "PUBLIC",
  // 파일 — 권리·가시성은 핸들러에서 검사 (공개 쇼케이스용 가상 자산 허용)
  "GET /api/3d/variants/:variantId/file": "PUBLIC",
  "GET /api/assets/:id/file": "PUBLIC",
  // 세트 번들(전체 데이터) 내보내기는 연구원 이상
  "GET /api/research-sets/:id/bundle": "RESEARCHER",
  // PI 전용: 권리 확정·판독 승인·계정·구성원·백업·보정·삭제
  "POST /api/assets/:id/license": "PI",
  "POST /api/readings/:id/review": "PI",
  "GET /api/users": "PI",
  "POST /api/users": "PI",
  "PATCH /api/users/:id": "PI",
  "POST /api/users/:id/reset-password": "PI",
  "PUT /api/research-sets/:id/members/:userId": "PI",
  "DELETE /api/research-sets/:id/members/:userId": "PI",
  "PATCH /api/research-sets/:id/visibility": "PI",
  "POST /api/admin/backup": "PI",
  "GET /api/admin/backups": "PI",
  "POST /api/research-sets/import": "PI",
  "POST /api/calibration/fit": "PI",
  "POST /api/calibration/:id/activate": "PI",
  "POST /api/calibration/deactivate": "PI",
  "DELETE /api/documents/:id": "PI",
  "DELETE /api/bibliography/:id": "PI",
  "DELETE /api/glyphs/:id": "PI",
  "DELETE /api/source-records/:id": "PI",
  "POST /api/3d/adapters/:adapterId/validate": "PI",
  "POST /api/glyphs/:id/revert": "PI",
  "POST /api/stele-tabs/:id/unarchive": "RESEARCHER",
  "POST /api/variants/import-unihan": "PI",
  // 세션 사용자 본인 작업
  "GET /api/auth/me": "GUEST",
  "POST /api/auth/password": "GUEST",
  // dev reset은 핸들러가 플래그·loopback·dev 모드를 검사
  "POST /api/dev/reset": "PUBLIC",
};

export function minRoleFor(method: string, routeUrl: string): MinRole {
  const explicit = ROUTE_ROLES[`${method} ${routeUrl}`];
  if (explicit) return explicit;
  return method === "GET" || method === "HEAD" ? "GUEST" : "RESEARCHER";
}

/** 라우트 파라미터로부터 소속 연구 세트를 찾는다 (없으면 null = 세트 비귀속 자원) */
export function resolveSetId(
  db: Db,
  routeUrl: string,
  params: Record<string, string>
): string | null | undefined {
  const tabSet = (tabId: string | undefined) =>
    tabId ? (steleTabs.get(db, tabId)?.researchSetId ?? undefined) : undefined;
  const assetSet = (assetId: string | undefined) => {
    if (!assetId) return undefined;
    const a = steleAssets.get(db, assetId);
    return a ? tabSet(a.steleTabId) : undefined;
  };
  if (routeUrl.startsWith("/api/research-sets/:id")) return params.id;
  if (routeUrl.startsWith("/api/stele-tabs/:id")) return tabSet(params.id);
  if (routeUrl.startsWith("/api/glyphs/:id")) {
    const c = params.id ? glyphCells.get(db, params.id) : null;
    return c ? tabSet(c.entity.steleTabId) : undefined;
  }
  if (routeUrl.startsWith("/api/assets/:id")) return assetSet(params.id);
  if (routeUrl.startsWith("/api/3d/assets/:assetId")) return assetSet(params.assetId);
  if (routeUrl.startsWith("/api/3d/reference-renders/:assetId")) return assetSet(params.assetId);
  if (routeUrl.startsWith("/api/3d/variants/:variantId")) {
    const v = params.variantId ? assetVariants.get(db, params.variantId) : null;
    return v ? assetSet(v.steleAssetId) : undefined;
  }
  if (routeUrl.startsWith("/api/readings/:id")) {
    const r = params.id ? readings.get(db, params.id) : null;
    return r ? tabSet(r.steleTabId) : undefined;
  }
  if (routeUrl.startsWith("/api/comments/:id")) {
    const c = params.id ? comments.get(db, params.id) : null;
    if (!c) return undefined;
    return commentTargetSet(db, c.targetType, c.targetId);
  }
  if (routeUrl.startsWith("/api/comparisons/:id")) {
    return params.id ? (comparisons.get(db, params.id)?.researchSetId ?? undefined) : undefined;
  }
  if (routeUrl.startsWith("/api/source-records/:id")) {
    const row = db.prepare("SELECT stele_tab_id FROM source_records WHERE id = ?").get(params.id) as
      | { stele_tab_id: string }
      | undefined;
    return row ? tabSet(row.stele_tab_id) : undefined;
  }
  return null;
}

export function commentTargetSet(db: Db, targetType: string, targetId: string): string | undefined {
  switch (targetType) {
    case "GLYPH_CELL": {
      const c = glyphCells.get(db, targetId);
      return c ? steleTabs.get(db, c.entity.steleTabId)?.researchSetId : undefined;
    }
    case "READING": {
      const r = readings.get(db, targetId);
      return r ? steleTabs.get(db, r.steleTabId)?.researchSetId : undefined;
    }
    case "TAB":
      return steleTabs.get(db, targetId)?.researchSetId;
    default:
      return undefined;
  }
}

/**
 * 세트 안에서의 유효 역할.
 * - PI(전역)는 모든 세트에서 PI
 * - 구성원이 지정된 세트: 구성원만 접근 (역할 = min(전역, 세트 역할))
 * - 구성원이 없는 세트: 연구실 전체 공유 (전역 역할 그대로)
 * - SHARED/PUBLIC 세트는 비구성원도 GUEST로 열람 가능
 */
export function effectiveSetRole(db: Db, user: PublicUser | null, setId: string): UserRole | null {
  const set = researchSets.get(db, setId);
  if (!set) return null;
  if (!user) return null;
  if (user.role === "PI") return "PI";
  const members = setMembers.list(db, setId);
  if (members.length === 0) return user.role;
  const m = members.find((x) => x.userId === user.id);
  if (m) return ROLE_RANK[m.role] < ROLE_RANK[user.role] ? m.role : user.role;
  if (set.visibility === "SHARED" || set.visibility === "PUBLIC") return "GUEST";
  return null;
}

export function canAccessSet(db: Db, user: PublicUser | null, setId: string, min: UserRole): boolean {
  const role = effectiveSetRole(db, user, setId);
  return Boolean(role && ROLE_RANK[role] >= ROLE_RANK[min]);
}
