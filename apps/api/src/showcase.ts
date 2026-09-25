/**
 * 공개 쇼케이스 API — 권리 필터를 서버에서 적용한다 (클라이언트 필터에 의존하지 않음).
 * - 세트가 PUBLIC이면 비로그인도 열람, 아니면 세트 열람 권한 필요
 * - 재배포 불가 자산은 메타데이터·파일 경로를 내보내지 않고 "제외 사유"만 알린다
 * - 새 분석을 만들지 않는다 (저장된 결과의 읽기 전용 재구성)
 */
import type { FastifyInstance } from "fastify";
import type { GlyphCell, SteleAsset } from "@seokmun/types";
import { isRedistributable } from "@seokmun/engine";
import type { Db } from "./db";
import { glyphCells, researchSets, sourceRecords, steleAssets, steleTabs } from "./repo";
import { effectiveSetRole } from "./auth/policy";
import { sanitizeCell } from "./sanitize";
import { computeGlyphMatrix } from "./glyphMatrix";

const UNRESOLVED_FOR_METRIC = new Set(["UNKNOWN", "CONFLICTING"]);

function publicAsset(a: SteleAsset): Omit<SteleAsset, "storageKey"> {
  const { storageKey: _omit, ...rest } = a;
  return rest;
}

export function registerShowcaseRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/showcase/:setId", async (req, reply) => {
    const { setId } = req.params as { setId: string };
    const set = researchSets.get(db, setId);
    if (!set) return reply.status(404).send({ error: "NOT_FOUND", message: "연구 세트를 찾을 수 없습니다" });
    const role = req.user ? effectiveSetRole(db, req.user, setId) : null;
    if (!role && set.visibility !== "PUBLIC") {
      return req.user
        ? reply.status(403).send({ error: "SET_ACCESS_DENIED", message: "이 연구 세트에 대한 권한이 없습니다" })
        : reply.status(401).send({ error: "UNAUTHENTICATED", message: "공개되지 않은 세트입니다. 로그인하세요." });
    }
    const tabs = steleTabs.listBySet(db, setId).filter((t) => !t.archived);
    const orderIndex = new Map(set.activeTabOrder.map((id, i) => [id, i]));
    tabs.sort((a, b) => (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999));

    const gated: Array<{ tabTitle: string; filename: string; rightsState: string }> = [];
    const tabPayload = tabs.map((tab) => {
      const assets = steleAssets.listByTab(db, tab.id);
      const showable = assets.filter((a) => isRedistributable(a));
      for (const a of assets.filter((x) => !isRedistributable(x))) {
        gated.push({
          tabTitle: tab.title,
          filename: a.originalFilename ?? a.demoLabel ?? "(이름 없는 자산)",
          rightsState: a.rightsState,
        });
      }
      return {
        tab: {
          id: tab.id,
          title: tab.title,
          canonicalName: tab.canonicalName,
          roles: tab.roles,
          periodEstimate: tab.periodEstimate,
          location: tab.location,
          material: tab.material,
          knownFacts: tab.knownFacts,
          rightsState: tab.rightsState,
        },
        assets: showable.map(publicAsset),
        sourceRecords: sourceRecords.listByTab(db, tab.id).map((s) => ({
          id: s.id,
          type: s.type,
          publisher: s.publisher,
          url: s.url,
          rightsState: s.rightsState,
        })),
        glyphCells: glyphCells.listByTab(db, tab.id).map(sanitizeCell),
      };
    });

    const allCells: GlyphCell[] = tabPayload.flatMap((t) => t.glyphCells);
    const statusCounts: Record<string, number> = {};
    for (const c of allCells) statusCounts[c.readingStatus] = (statusCounts[c.readingStatus] ?? 0) + 1;
    const unresolved = allCells.filter((c) => UNRESOLVED_FOR_METRIC.has(c.readingStatus)).length;

    // 주 대상: 공개 가능한 3D 메시가 있는 첫 탭
    const primary =
      tabPayload.find((t) => t.assets.some((a) => a.assetType === "MESH" && a.format === "PROCEDURAL_MESH")) ??
      tabPayload[0] ??
      null;
    const primaryCells = primary?.glyphCells ?? [];
    // 초점 글자: 자동·교차 근거로 확정된 셀 → 획이 있는 첫 셀
    const focusCell =
      primaryCells.find((c) => c.readingStatus === "MULTI_SOURCE_AUTOMATIC") ??
      primaryCells.find((c) => c.strokes && c.readingStatus !== "OBSERVED") ??
      primaryCells.find((c) => c.strokes) ??
      null;
    const unknownCell = primaryCells.find((c) => c.readingStatus === "UNKNOWN") ?? null;
    const compareTabIds = tabPayload.slice(0, 3).map((t) => t.tab.id);
    const matrix =
      focusCell && compareTabIds.length >= 2
        ? computeGlyphMatrix(db, [focusCell.id], compareTabIds).rows
        : [];

    return {
      set: { id: set.id, name: set.name, description: set.description, visibility: set.visibility },
      viewerRole: role,
      tabs: tabPayload,
      primaryTabId: primary?.tab.id ?? null,
      focusCellId: focusCell?.id ?? null,
      unknownCellId: unknownCell?.id ?? null,
      matrix,
      statusCounts,
      metrics: {
        tabCount: tabs.length,
        cellCount: allCells.length,
        sourceCount: tabPayload.reduce((n, t) => n + t.sourceRecords.length, 0),
        unresolved,
        unresolvedRatio: allCells.length ? Math.round((unresolved / allCells.length) * 100) : 0,
      },
      gatedAssets: gated,
      note: "쇼케이스는 저장된 결과를 읽기 전용으로 재구성합니다 — 권리 확인 전 자산은 서버에서 제외됩니다.",
    };
  });
}
