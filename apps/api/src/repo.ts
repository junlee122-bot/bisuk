/**
 * 타입 안전 저장소 계층 — 엔터티는 JSON 컬럼에 저장한다.
 * 주요 엔터티는 읽을 때 zod로 파싱해 스키마 변경 후 기존 행에도 기본값을 채운다
 * (마이그레이션 없이 필드를 추가해도 런타임 오류가 나지 않도록).
 */
import { createHash } from "node:crypto";
import {
  AuditEvent,
  BibliographyEntry,
  CalibrationProfile,
  CharacterExemplar,
  ChronologyAttestation,
  Comment,
  CorpusDocument,
  DocumentClaim,
  EntityVersion,
  FrontierWatchItem,
  GlyphCell,
  Reading,
  ResearchSet,
  SourceRecord,
  SteleAsset,
  SteleTab,
  User,
  type AnalysisRunRecord,
  type CrossSteleMatch,
  type HypothesisEvidence,
  type RestorationHypothesis,
  type UserRole,
  type VariantPair,
} from "@seokmun/types";
import type { ZodTypeAny } from "zod";
import { currentActor, requestContext, newId } from "./context";
import type { Db } from "./db";

/** 셀 행에 함께 저장되는 확장 정보 (엔터티 스키마 밖) */
export interface GlyphCellExtra {
  /** 시드 유래 셀 식별 (가상 데모 판별) — 사용자 생성 셀은 빈 문자열 */
  seedKey: string;
  styleJitter?: number;
  hiddenBenchmark?: boolean;
  latestRunId?: string;
}

export interface DocumentExtra {
  benchmarkLeak?: boolean;
  /** v1 호환 필드 — v2부터 claim의 원천은 document_claims 테이블 */
  claims?: Array<{
    targetGlyphCellId: string;
    character: string;
    stance: "SUPPORT" | "COUNTER";
    quote: string;
  }>;
}

function parseWith<T>(schema: ZodTypeAny | undefined, raw: unknown, table: string): T {
  if (!schema) return raw as T;
  const res = schema.safeParse(raw);
  if (!res.success) {
    throw new Error(
      `저장된 ${table} 행이 현재 스키마와 맞지 않습니다: ${res.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return res.data as T;
}

function get<T>(db: Db, table: string, id: string, schema?: ZodTypeAny): T | null {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? parseWith<T>(schema, JSON.parse(row.data), table) : null;
}

function put(db: Db, table: string, id: string, data: unknown, extraCols: Record<string, string | number> = {}): void {
  const cols = ["id", ...Object.keys(extraCols), "data"];
  const placeholders = cols.map(() => "?").join(", ");
  db.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`
  ).run(id, ...Object.values(extraCols), JSON.stringify(data));
}

function all<T>(db: Db, table: string, where = "", params: unknown[] = [], schema?: ZodTypeAny): T[] {
  const rows = db
    .prepare(`SELECT data FROM ${table} ${where}`)
    .all(...params) as Array<{ data: string }>;
  return rows.map((r) => parseWith<T>(schema, JSON.parse(r.data), table));
}

function del(db: Db, table: string, id: string): void {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

// ── Research sets ──
export const researchSets = {
  get: (db: Db, id: string) => get<ResearchSet>(db, "research_sets", id, ResearchSet),
  list: (db: Db) => all<ResearchSet>(db, "research_sets", "", [], ResearchSet),
  put: (db: Db, entity: ResearchSet) => put(db, "research_sets", entity.id, entity),
  delete: (db: Db, id: string) => del(db, "research_sets", id),
};

// ── Tabs ──
export const steleTabs = {
  get: (db: Db, id: string) => get<SteleTab>(db, "stele_tabs", id, SteleTab),
  listBySet: (db: Db, setId: string) =>
    all<SteleTab>(db, "stele_tabs", "WHERE research_set_id = ?", [setId], SteleTab),
  put: (db: Db, entity: SteleTab) =>
    put(db, "stele_tabs", entity.id, entity, { research_set_id: entity.researchSetId }),
  delete: (db: Db, id: string) => del(db, "stele_tabs", id),
};

// ── Source records ──
export const sourceRecords = {
  get: (db: Db, id: string) => get<SourceRecord>(db, "source_records", id, SourceRecord),
  listByTab: (db: Db, tabId: string) =>
    all<SourceRecord>(db, "source_records", "WHERE stele_tab_id = ?", [tabId], SourceRecord),
  put: (db: Db, entity: SourceRecord) =>
    put(db, "source_records", entity.id, entity, { stele_tab_id: entity.steleTabId }),
  delete: (db: Db, id: string) => del(db, "source_records", id),
};

// ── Assets ──
export const steleAssets = {
  get: (db: Db, id: string) => get<SteleAsset>(db, "stele_assets", id, SteleAsset),
  listByTab: (db: Db, tabId: string) =>
    all<SteleAsset>(db, "stele_assets", "WHERE stele_tab_id = ?", [tabId], SteleAsset),
  listAll: (db: Db) => all<SteleAsset>(db, "stele_assets", "", [], SteleAsset),
  put: (db: Db, entity: SteleAsset) =>
    put(db, "stele_assets", entity.id, entity, { stele_tab_id: entity.steleTabId }),
};

// ── Documents ──
export interface StoredDocument {
  entity: CorpusDocument;
  extra: DocumentExtra;
}
function parseStoredDocument(raw: unknown): StoredDocument {
  const r = raw as { entity: unknown; extra?: DocumentExtra };
  return { entity: CorpusDocument.parse(r.entity), extra: r.extra ?? {} };
}
export const documents = {
  get: (db: Db, id: string) => {
    const raw = get<unknown>(db, "documents", id);
    return raw ? parseStoredDocument(raw) : null;
  },
  list: (db: Db) => all<unknown>(db, "documents").map(parseStoredDocument),
  put: (db: Db, doc: StoredDocument) => put(db, "documents", doc.entity.id, doc),
  delete: (db: Db, id: string) => del(db, "documents", id),
};

// ── Glyph cells ──
export interface StoredGlyphCell {
  entity: GlyphCell;
  extra: GlyphCellExtra;
}
function parseStoredCell(raw: unknown): StoredGlyphCell {
  const r = raw as { entity: unknown; extra?: GlyphCellExtra };
  return { entity: GlyphCell.parse(r.entity), extra: r.extra ?? { seedKey: "" } };
}
export const glyphCells = {
  get: (db: Db, id: string) => {
    const raw = get<unknown>(db, "glyph_cells", id);
    return raw ? parseStoredCell(raw) : null;
  },
  listByTab: (db: Db, tabId: string) =>
    all<unknown>(db, "glyph_cells", "WHERE stele_tab_id = ?", [tabId]).map(parseStoredCell),
  put: (db: Db, cell: StoredGlyphCell) =>
    put(db, "glyph_cells", cell.entity.id, cell, {
      stele_tab_id: cell.entity.steleTabId,
    }),
  delete: (db: Db, id: string) => del(db, "glyph_cells", id),
};

// ── Hypotheses / evidence / matches ──
export const hypotheses = {
  listByCell: (db: Db, cellId: string) =>
    all<RestorationHypothesis>(db, "hypotheses", "WHERE glyph_cell_id = ?", [cellId]),
  listByRun: (db: Db, runId: string) =>
    all<RestorationHypothesis>(db, "hypotheses", "WHERE run_id = ?", [runId]),
  put: (db: Db, h: RestorationHypothesis, runId: string) =>
    put(db, "hypotheses", h.id, h, { glyph_cell_id: h.glyphCellId, run_id: runId }),
};
export const evidenceRepo = {
  listByHypothesis: (db: Db, hypId: string) =>
    all<HypothesisEvidence>(db, "evidence", "WHERE hypothesis_id = ?", [hypId]),
  put: (db: Db, e: HypothesisEvidence) =>
    put(db, "evidence", e.id, e, { hypothesis_id: e.hypothesisId }),
};
export const crossMatches = {
  listByCell: (db: Db, cellId: string) =>
    all<CrossSteleMatch>(db, "cross_matches", "WHERE source_glyph_cell_id = ?", [cellId]),
  put: (db: Db, m: CrossSteleMatch, runId: string) =>
    put(db, "cross_matches", m.id, m, {
      source_glyph_cell_id: m.sourceGlyphCellId,
      run_id: runId,
    }),
};

// ── Comparisons ──
export interface StoredComparison {
  id: string;
  researchSetId: string;
  kind: "GLYPH_MATRIX" | "FRAGMENT_JOIN";
  payload: unknown;
  createdAt: string;
}
export const comparisons = {
  get: (db: Db, id: string) => get<StoredComparison>(db, "comparisons", id),
  put: (db: Db, c: StoredComparison) =>
    put(db, "comparisons", c.id, c, { research_set_id: c.researchSetId }),
};

// ── Frontier ──
export const frontierItems = {
  get: (db: Db, id: string) => get<FrontierWatchItem>(db, "frontier_items", id, FrontierWatchItem),
  list: (db: Db) => all<FrontierWatchItem>(db, "frontier_items", "", [], FrontierWatchItem),
  put: (db: Db, item: FrontierWatchItem) => put(db, "frontier_items", item.id, item),
};

// ── Benchmark (정답 격리 — 자동 분석 경로에서 읽기 금지) ──
export interface BenchmarkCase {
  glyphCellId: string;
  hiddenTruth: string;
  note: string;
}
export const benchmarkCases = {
  list: (db: Db) => {
    const rows = db
      .prepare("SELECT data FROM benchmark_cases")
      .all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as BenchmarkCase);
  },
  put: (db: Db, c: BenchmarkCase) => {
    db.prepare(
      "INSERT OR REPLACE INTO benchmark_cases (glyph_cell_id, data) VALUES (?, ?)"
    ).run(c.glyphCellId, JSON.stringify(c));
  },
};

// ── Audit (추가 전용 + 해시 체인) ──
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function auditHash(prevHash: string | null, event: Omit<AuditEvent, "hash" | "prevHash">): string {
  return createHash("sha256")
    .update(`${prevHash ?? "GENESIS"}\n${stableStringify(event)}`)
    .digest("hex");
}

export interface AuditQuery {
  limit?: number;
  beforeSeq?: number;
  entityType?: string;
  entityId?: string;
  actor?: string;
  action?: string;
  since?: string;
}

export const auditEvents = {
  record: (
    db: Db,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown> = {},
    actorOverride?: { id: string; name: string }
  ): AuditEvent => {
    const actor = actorOverride ?? currentActor();
    const base = {
      id: newId("evt"),
      ts: new Date().toISOString(),
      actor: actor.id,
      actorName: actor.name,
      action,
      entityType,
      entityId,
      payload,
      ...(requestContext.getStore()?.requestId
        ? { requestId: requestContext.getStore()!.requestId }
        : {}),
    };
    const last = db
      .prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1")
      .get() as { hash: string | null } | undefined;
    const prevHash = last?.hash ?? null;
    const hash = auditHash(prevHash, base);
    const event: AuditEvent = { ...base, prevHash, hash };
    db.prepare(
      "INSERT INTO audit_events (id, ts, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?)"
    ).run(event.id, event.ts, JSON.stringify(event), prevHash, hash);
    return event;
  },
  list: (db: Db, q: AuditQuery | number = {}) => {
    const query: AuditQuery = typeof q === "number" ? { limit: q } : q;
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.beforeSeq) {
      where.push("seq < ?");
      params.push(query.beforeSeq);
    }
    if (query.since) {
      where.push("ts >= ?");
      params.push(query.since);
    }
    for (const [key, col] of [
      ["entityType", "$.entityType"],
      ["entityId", "$.entityId"],
      ["actor", "$.actor"],
      ["action", "$.action"],
    ] as const) {
      const v = query[key];
      if (v) {
        where.push(`json_extract(data, '${col}') = ?`);
        params.push(v);
      }
    }
    const sql = `SELECT seq, data FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...params, query.limit ?? 200) as Array<{
      seq: number;
      data: string;
    }>;
    return rows.map((r) => ({ seq: r.seq, ...(JSON.parse(r.data) as AuditEvent) }));
  },
  /** 해시 체인 검증 — 변조·삭제·삽입 시 첫 불일치 지점을 보고 */
  verify: (db: Db): { ok: boolean; checked: number; firstBrokenSeq: number | null; reason: string | null } => {
    const rows = db
      .prepare("SELECT seq, data, prev_hash, hash FROM audit_events ORDER BY seq ASC")
      .iterate() as IterableIterator<{ seq: number; data: string; prev_hash: string | null; hash: string | null }>;
    let prev: string | null = null;
    let checked = 0;
    for (const row of rows) {
      checked++;
      if (row.hash === null) {
        // v1 시절(해시 도입 전) 이벤트 — 체인 시작 전 구간으로 취급
        prev = null;
        continue;
      }
      const ev = JSON.parse(row.data) as AuditEvent;
      const { hash: _h, prevHash: _p, ...base } = ev;
      if (row.prev_hash !== prev) {
        return { ok: false, checked, firstBrokenSeq: row.seq, reason: "prev_hash 불일치 (중간 이벤트 삭제·삽입 의심)" };
      }
      if (auditHash(prev, base) !== row.hash || ev.hash !== row.hash) {
        return { ok: false, checked, firstBrokenSeq: row.seq, reason: "내용 해시 불일치 (이벤트 변조 의심)" };
      }
      prev = row.hash;
    }
    return { ok: true, checked, firstBrokenSeq: null, reason: null };
  },
};

// ── 사용자·자격 증명·세션 ──
export const users = {
  get: (db: Db, id: string) => get<User>(db, "users", id, User),
  getByEmail: (db: Db, email: string) => {
    const row = db.prepare("SELECT data FROM users WHERE email = ?").get(email.toLowerCase()) as
      | { data: string }
      | undefined;
    return row ? User.parse(JSON.parse(row.data)) : null;
  },
  list: (db: Db) => all<User>(db, "users", "ORDER BY email", [], User),
  count: (db: Db) => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n,
  put: (db: Db, u: User) => {
    const normalized = { ...u, email: u.email.toLowerCase() };
    // UPSERT — REPLACE는 행을 지웠다 다시 넣어 세션(ON DELETE CASCADE)까지 삭제한다
    db.prepare(
      "INSERT INTO users (id, email, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, data = excluded.data"
    ).run(normalized.id, normalized.email, JSON.stringify(normalized));
  },
};

export const credentials = {
  get: (db: Db, userId: string) =>
    (db.prepare("SELECT password_hash FROM user_credentials WHERE user_id = ?").get(userId) as
      | { password_hash: string }
      | undefined)?.password_hash ?? null,
  set: (db: Db, userId: string, passwordHash: string) => {
    db.prepare(
      "INSERT OR REPLACE INTO user_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)"
    ).run(userId, passwordHash, new Date().toISOString());
  },
};

export const sessions = {
  create: (db: Db, s: { idHash: string; userId: string; expiresAt: number; ip: string; userAgent: string }) => {
    db.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(s.idHash, s.userId, s.expiresAt, new Date().toISOString(), s.ip, s.userAgent.slice(0, 300));
  },
  get: (db: Db, idHash: string) =>
    db.prepare("SELECT id, user_id AS userId, expires_at AS expiresAt FROM sessions WHERE id = ?").get(idHash) as
      | { id: string; userId: string; expiresAt: number }
      | undefined,
  delete: (db: Db, idHash: string) => {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(idHash);
  },
  deleteForUser: (db: Db, userId: string) => {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  },
  purgeExpired: (db: Db) => {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  },
};

export const setMembers = {
  list: (db: Db, setId: string) =>
    db
      .prepare("SELECT research_set_id AS researchSetId, user_id AS userId, role, added_at AS addedAt FROM set_members WHERE research_set_id = ?")
      .all(setId) as Array<{ researchSetId: string; userId: string; role: UserRole; addedAt: string }>,
  get: (db: Db, setId: string, userId: string) =>
    db
      .prepare("SELECT role FROM set_members WHERE research_set_id = ? AND user_id = ?")
      .get(setId, userId) as { role: UserRole } | undefined,
  put: (db: Db, setId: string, userId: string, role: UserRole) => {
    db.prepare(
      "INSERT OR REPLACE INTO set_members (research_set_id, user_id, role, added_at) VALUES (?, ?, ?, ?)"
    ).run(setId, userId, role, new Date().toISOString());
  },
  remove: (db: Db, setId: string, userId: string) => {
    db.prepare("DELETE FROM set_members WHERE research_set_id = ? AND user_id = ?").run(setId, userId);
  },
};

// ── 판독·토론·이력 ──
export const readings = {
  get: (db: Db, id: string) => get<Reading>(db, "readings", id, Reading),
  listByCell: (db: Db, cellId: string) =>
    all<Reading>(db, "readings", "WHERE glyph_cell_id = ? ORDER BY json_extract(data, '$.createdAt')", [cellId], Reading),
  listByTab: (db: Db, tabId: string) =>
    all<Reading>(db, "readings", "WHERE stele_tab_id = ?", [tabId], Reading),
  listPendingReview: (db: Db) =>
    all<Reading>(db, "readings", "WHERE json_extract(data, '$.reviewStatus') = 'PROPOSED' ORDER BY json_extract(data, '$.createdAt')", [], Reading),
  put: (db: Db, r: Reading) =>
    put(db, "readings", r.id, r, { glyph_cell_id: r.glyphCellId, stele_tab_id: r.steleTabId }),
  delete: (db: Db, id: string) => del(db, "readings", id),
};

export const comments = {
  get: (db: Db, id: string) => get<Comment>(db, "comments", id, Comment),
  listByTarget: (db: Db, targetType: string, targetId: string) =>
    all<Comment>(
      db,
      "comments",
      "WHERE target_type = ? AND target_id = ? ORDER BY json_extract(data, '$.createdAt')",
      [targetType, targetId],
      Comment
    ),
  countByTargets: (db: Db, targetType: string, targetIds: string[]) => {
    if (targetIds.length === 0) return new Map<string, number>();
    const rows = db
      .prepare(
        `SELECT target_id AS id, COUNT(*) AS n FROM comments WHERE target_type = ? AND target_id IN (${targetIds.map(() => "?").join(",")}) GROUP BY target_id`
      )
      .all(targetType, ...targetIds) as Array<{ id: string; n: number }>;
    return new Map(rows.map((r) => [r.id, r.n]));
  },
  put: (db: Db, c: Comment) =>
    put(db, "comments", c.id, c, { target_type: c.targetType, target_id: c.targetId }),
  delete: (db: Db, id: string) => del(db, "comments", id),
};

export const entityVersions = {
  record: (
    db: Db,
    entityType: string,
    entityId: string,
    version: number,
    snapshot: Record<string, unknown>,
    action: string,
    reason = ""
  ): EntityVersion => {
    const actor = currentActor();
    const v: EntityVersion = {
      id: newId("ver"),
      entityType,
      entityId,
      version,
      snapshot,
      action,
      actorId: actor.id,
      actorName: actor.name,
      reason,
      ts: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO entity_versions (id, entity_type, entity_id, version, ts, data) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(v.id, entityType, entityId, version, v.ts, JSON.stringify(v));
    return v;
  },
  list: (db: Db, entityType: string, entityId: string) =>
    all<EntityVersion>(
      db,
      "entity_versions",
      "WHERE entity_type = ? AND entity_id = ? ORDER BY version DESC, ts DESC",
      [entityType, entityId],
      EntityVersion
    ),
  get: (db: Db, id: string) => get<EntityVersion>(db, "entity_versions", id, EntityVersion),
};

// ── 서지·주장 ──
export const bibliography = {
  get: (db: Db, id: string) => get<BibliographyEntry>(db, "bibliography", id, BibliographyEntry),
  list: (db: Db) => all<BibliographyEntry>(db, "bibliography", "", [], BibliographyEntry),
  put: (db: Db, b: BibliographyEntry) => put(db, "bibliography", b.id, b),
  delete: (db: Db, id: string) => del(db, "bibliography", id),
};

export const documentClaims = {
  get: (db: Db, id: string) => get<DocumentClaim>(db, "document_claims", id, DocumentClaim),
  listByDocument: (db: Db, documentId: string) =>
    all<DocumentClaim>(db, "document_claims", "WHERE document_id = ?", [documentId], DocumentClaim),
  listConfirmed: (db: Db) =>
    all<DocumentClaim>(db, "document_claims", "WHERE status = 'CONFIRMED'", [], DocumentClaim),
  listByCell: (db: Db, cellId: string) =>
    all<DocumentClaim>(db, "document_claims", "WHERE target_glyph_cell_id = ?", [cellId], DocumentClaim),
  put: (db: Db, c: DocumentClaim) =>
    put(db, "document_claims", c.id, c, {
      document_id: c.documentId,
      target_glyph_cell_id: c.targetGlyphCellId,
      status: c.status,
    }),
  delete: (db: Db, id: string) => del(db, "document_claims", id),
};

// ── 자형 표본·이체자·연대·보정·분석 실행 ──
export const exemplars = {
  list: (db: Db) => all<CharacterExemplar>(db, "exemplars", "", [], CharacterExemplar),
  listByChar: (db: Db, ch: string) =>
    all<CharacterExemplar>(db, "exemplars", "WHERE character = ?", [ch], CharacterExemplar),
  put: (db: Db, e: CharacterExemplar) => put(db, "exemplars", e.id, e, { character: e.character }),
  delete: (db: Db, id: string) => del(db, "exemplars", id),
};

export const variantPairs = {
  list: (db: Db) =>
    db.prepare("SELECT a, b, kind, source FROM variant_pairs").all() as VariantPair[],
  count: (db: Db) => (db.prepare("SELECT COUNT(*) AS n FROM variant_pairs").get() as { n: number }).n,
  putMany: (db: Db, pairs: VariantPair[]) => {
    const stmt = db.prepare("INSERT OR IGNORE INTO variant_pairs (a, b, kind, source) VALUES (?, ?, ?, ?)");
    let inserted = 0;
    db.transaction(() => {
      for (const p of pairs) inserted += stmt.run(p.a, p.b, p.kind, p.source).changes;
    })();
    return inserted;
  },
  delete: (db: Db, p: { a: string; b: string; kind: string }) => {
    db.prepare("DELETE FROM variant_pairs WHERE a = ? AND b = ? AND kind = ?").run(p.a, p.b, p.kind);
  },
};

export const chronology = {
  list: (db: Db) => all<ChronologyAttestation>(db, "chronology", "", [], ChronologyAttestation),
  put: (db: Db, c: ChronologyAttestation) => {
    db.prepare("INSERT OR REPLACE INTO chronology (character, data) VALUES (?, ?)").run(
      c.character,
      JSON.stringify(c)
    );
  },
  delete: (db: Db, ch: string) => {
    db.prepare("DELETE FROM chronology WHERE character = ?").run(ch);
  },
};

export const calibrationProfiles = {
  list: (db: Db) => all<CalibrationProfile>(db, "calibration_profiles", "", [], CalibrationProfile),
  getActive: (db: Db) => {
    const row = db
      .prepare("SELECT data FROM calibration_profiles WHERE active = 1 LIMIT 1")
      .get() as { data: string } | undefined;
    return row ? CalibrationProfile.parse(JSON.parse(row.data)) : null;
  },
  put: (db: Db, p: CalibrationProfile, active: boolean) => {
    db.transaction(() => {
      if (active) db.prepare("UPDATE calibration_profiles SET active = 0").run();
      db.prepare(
        "INSERT OR REPLACE INTO calibration_profiles (id, active, data) VALUES (?, ?, ?)"
      ).run(p.id, active ? 1 : 0, JSON.stringify(p));
    })();
  },
  deactivateAll: (db: Db) => {
    db.prepare("UPDATE calibration_profiles SET active = 0").run();
  },
};

export const analysisRuns = {
  get: (db: Db, id: string) => get<AnalysisRunRecord>(db, "analysis_runs", id),
  listByCell: (db: Db, cellId: string) =>
    all<AnalysisRunRecord>(db, "analysis_runs", "WHERE glyph_cell_id = ? ORDER BY created_at DESC", [cellId]),
  put: (db: Db, r: AnalysisRunRecord) => {
    db.prepare(
      "INSERT OR REPLACE INTO analysis_runs (id, glyph_cell_id, input_hash, created_at, data) VALUES (?, ?, ?, ?, ?)"
    ).run(r.id, r.glyphCellId, r.inputHash, r.createdAt, JSON.stringify(r));
  },
};

