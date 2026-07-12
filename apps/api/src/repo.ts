/**
 * 타입 안전 저장소 계층 — 엔터티는 JSON 컬럼에 저장하고 zod로 검증한다.
 * PostgreSQL JSONB 이전을 전제로 SQL 표면을 최소화한다.
 */
import type {
  AuditEvent,
  CorpusDocument,
  FrontierWatchItem,
  GlyphCell,
  ResearchSet,
  RestorationHypothesis,
  HypothesisEvidence,
  CrossSteleMatch,
  SourceRecord,
  SteleAsset,
  SteleTab,
} from "@seokmun/types";
import type { Db } from "./db";

/** 셀 행에 함께 저장되는 확장 정보 (엔터티 스키마 밖) */
export interface GlyphCellExtra {
  seedKey: string;
  styleJitter?: number;
  hiddenBenchmark?: boolean;
  latestRunId?: string;
}

export interface DocumentExtra {
  benchmarkLeak?: boolean;
  claims: Array<{
    targetGlyphCellId: string;
    character: string;
    stance: "SUPPORT" | "COUNTER";
    quote: string;
  }>;
}

function get<T>(db: Db, table: string, id: string): T | null {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

function put(db: Db, table: string, id: string, data: unknown, extraCols: Record<string, string> = {}): void {
  const cols = ["id", ...Object.keys(extraCols), "data"];
  const placeholders = cols.map(() => "?").join(", ");
  db.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`
  ).run(id, ...Object.values(extraCols), JSON.stringify(data));
}

function all<T>(db: Db, table: string, where = "", params: unknown[] = []): T[] {
  const rows = db
    .prepare(`SELECT data FROM ${table} ${where}`)
    .all(...params) as Array<{ data: string }>;
  return rows.map((r) => JSON.parse(r.data) as T);
}

// ── Research sets ──
export const researchSets = {
  get: (db: Db, id: string) => get<ResearchSet>(db, "research_sets", id),
  list: (db: Db) => all<ResearchSet>(db, "research_sets"),
  put: (db: Db, entity: ResearchSet) => put(db, "research_sets", entity.id, entity),
  delete: (db: Db, id: string) => {
    db.prepare("DELETE FROM research_sets WHERE id = ?").run(id);
  },
};

// ── Tabs ──
export const steleTabs = {
  get: (db: Db, id: string) => get<SteleTab>(db, "stele_tabs", id),
  listBySet: (db: Db, setId: string) =>
    all<SteleTab>(db, "stele_tabs", "WHERE research_set_id = ?", [setId]),
  put: (db: Db, entity: SteleTab) =>
    put(db, "stele_tabs", entity.id, entity, { research_set_id: entity.researchSetId }),
  delete: (db: Db, id: string) => {
    db.prepare("DELETE FROM stele_tabs WHERE id = ?").run(id);
  },
};

// ── Source records ──
export const sourceRecords = {
  get: (db: Db, id: string) => get<SourceRecord>(db, "source_records", id),
  listByTab: (db: Db, tabId: string) =>
    all<SourceRecord>(db, "source_records", "WHERE stele_tab_id = ?", [tabId]),
  put: (db: Db, entity: SourceRecord) =>
    put(db, "source_records", entity.id, entity, { stele_tab_id: entity.steleTabId }),
};

// ── Assets ──
export const steleAssets = {
  get: (db: Db, id: string) => get<SteleAsset>(db, "stele_assets", id),
  listByTab: (db: Db, tabId: string) =>
    all<SteleAsset>(db, "stele_assets", "WHERE stele_tab_id = ?", [tabId]),
  listAll: (db: Db) => all<SteleAsset>(db, "stele_assets"),
  put: (db: Db, entity: SteleAsset) =>
    put(db, "stele_assets", entity.id, entity, { stele_tab_id: entity.steleTabId }),
};

// ── Documents ──
export interface StoredDocument {
  entity: CorpusDocument;
  extra: DocumentExtra;
}
export const documents = {
  get: (db: Db, id: string) => get<StoredDocument>(db, "documents", id),
  list: (db: Db) => all<StoredDocument>(db, "documents"),
  put: (db: Db, doc: StoredDocument) => put(db, "documents", doc.entity.id, doc),
};

// ── Glyph cells ──
export interface StoredGlyphCell {
  entity: GlyphCell;
  extra: GlyphCellExtra;
}
export const glyphCells = {
  get: (db: Db, id: string) => get<StoredGlyphCell>(db, "glyph_cells", id),
  listByTab: (db: Db, tabId: string) =>
    all<StoredGlyphCell>(db, "glyph_cells", "WHERE stele_tab_id = ?", [tabId]),
  put: (db: Db, cell: StoredGlyphCell) =>
    put(db, "glyph_cells", cell.entity.id, cell, {
      stele_tab_id: cell.entity.steleTabId,
    }),
};

// ── Hypotheses / evidence / matches ──
export const hypotheses = {
  listByCell: (db: Db, cellId: string) =>
    all<RestorationHypothesis>(db, "hypotheses", "WHERE glyph_cell_id = ?", [cellId]),
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
  get: (db: Db, id: string) => get<FrontierWatchItem>(db, "frontier_items", id),
  list: (db: Db) => all<FrontierWatchItem>(db, "frontier_items"),
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

// ── Audit ──
let auditCounter = 0;
export const auditEvents = {
  record: (
    db: Db,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown> = {},
    actor = "demo-researcher"
  ): AuditEvent => {
    const ts = new Date().toISOString();
    const event: AuditEvent = {
      id: `evt-${Date.now()}-${auditCounter++}`,
      ts,
      actor,
      action,
      entityType,
      entityId,
      payload,
    };
    db.prepare("INSERT INTO audit_events (id, ts, data) VALUES (?, ?, ?)").run(
      event.id,
      ts,
      JSON.stringify(event)
    );
    return event;
  },
  list: (db: Db, limit = 200) => {
    const rows = db
      .prepare("SELECT data FROM audit_events ORDER BY seq DESC LIMIT ?")
      .all(limit) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as AuditEvent);
  },
};
