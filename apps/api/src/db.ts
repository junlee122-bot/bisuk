import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultDataDir } from "./config";

export type Db = Database.Database;

let currentDataDir: string | null = null;

/** 현재 서버 인스턴스의 데이터 디렉터리 (openDb가 설정) */
export function dataDir(): string {
  return currentDataDir ?? process.env.SEOKMUN_DATA_DIR ?? defaultDataDir();
}

export function openDb(dir: string = dataDir()): Db {
  currentDataDir = dir;
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "seokmun.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

/** 여러 행을 쓰는 작업을 원자적으로 — 중간 실패 시 전부 롤백 */
export function tx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}

// ── v1: 초기 스키마 (기존 설치와 동일 — IF NOT EXISTS로 멱등) ──
const V1 = [
  `CREATE TABLE IF NOT EXISTS research_sets (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stele_tabs (id TEXT PRIMARY KEY, research_set_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS source_records (id TEXT PRIMARY KEY, stele_tab_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stele_assets (id TEXT PRIMARY KEY, stele_tab_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS glyph_cells (id TEXT PRIMARY KEY, stele_tab_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS hypotheses (id TEXT PRIMARY KEY, glyph_cell_id TEXT NOT NULL, run_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, hypothesis_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cross_matches (id TEXT PRIMARY KEY, source_glyph_cell_id TEXT NOT NULL, run_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS comparisons (id TEXT PRIMARY KEY, research_set_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS frontier_items (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS benchmark_cases (glyph_cell_id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS asset_variants (id TEXT PRIMARY KEY, stele_asset_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS three_d_jobs (id TEXT PRIMARY KEY, stele_asset_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS render_presets (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS scene_looks (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS camera_bookmarks (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_variants_asset ON asset_variants(stele_asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_3djobs_asset ON three_d_jobs(stele_asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tabs_set ON stele_tabs(research_set_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cells_tab ON glyph_cells(stele_tab_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assets_tab ON stele_assets(stele_tab_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sources_tab ON source_records(stele_tab_id)`,
  `CREATE INDEX IF NOT EXISTS idx_hyp_cell ON hypotheses(glyph_cell_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ev_hyp ON evidence(hypothesis_id)`,
  `CREATE INDEX IF NOT EXISTS idx_match_cell ON cross_matches(source_glyph_cell_id)`,
];

// ── v2: 연구실 운영 (계정·판독·토론·이력·서지·주장·보정·재현성) ──
const V2 = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS user_credentials (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, password_hash TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL, ip TEXT, user_agent TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS set_members (research_set_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (research_set_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS readings (id TEXT PRIMARY KEY, glyph_cell_id TEXT NOT NULL, stele_tab_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_readings_cell ON readings(glyph_cell_id)`,
  `CREATE INDEX IF NOT EXISTS idx_readings_tab ON readings(stele_tab_id)`,
  `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS entity_versions (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL, ts TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_entity ON entity_versions(entity_type, entity_id, version)`,
  `CREATE TABLE IF NOT EXISTS bibliography (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS document_claims (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, target_glyph_cell_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_doc ON document_claims(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_cell ON document_claims(target_glyph_cell_id)`,
  `CREATE TABLE IF NOT EXISTS exemplars (id TEXT PRIMARY KEY, character TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_exemplars_char ON exemplars(character)`,
  `CREATE TABLE IF NOT EXISTS variant_pairs (a TEXT NOT NULL, b TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY (a, b, kind))`,
  `CREATE TABLE IF NOT EXISTS chronology (character TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS calibration_profiles (id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS analysis_runs (id TEXT PRIMARY KEY, glyph_cell_id TEXT NOT NULL, input_hash TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_cell ON analysis_runs(glyph_cell_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(id)`,
];

/** 감사 로그는 추가만 가능 — UPDATE/DELETE는 DB 수준에서 거부 */
const AUDIT_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END`,
];

interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

function columnExists(db: Db, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    up: (db) => {
      for (const sql of V1) db.exec(sql);
    },
  },
  {
    version: 2,
    name: "lab-operations",
    up: (db) => {
      for (const sql of V2) db.exec(sql);
      if (!columnExists(db, "audit_events", "hash")) {
        db.exec(`ALTER TABLE audit_events ADD COLUMN prev_hash TEXT`);
        db.exec(`ALTER TABLE audit_events ADD COLUMN hash TEXT`);
      }
      for (const sql of AUDIT_TRIGGERS) db.exec(sql);
      // 데이터 이전: 문헌 JSON 안의 주석 claim → document_claims 테이블 (단일 원천)
      const docs = db.prepare("SELECT id, data FROM documents").all() as Array<{
        id: string;
        data: string;
      }>;
      const insert = db.prepare(
        "INSERT OR IGNORE INTO document_claims (id, document_id, target_glyph_cell_id, status, data) VALUES (?, ?, ?, ?, ?)"
      );
      const now = new Date().toISOString();
      for (const row of docs) {
        const parsed = JSON.parse(row.data) as {
          extra?: { claims?: Array<{ targetGlyphCellId: string; character: string; stance: string; quote: string }> };
        };
        (parsed.extra?.claims ?? []).forEach((c, i) => {
          const id = `claim-${row.id}-${i}`;
          insert.run(
            id,
            row.id,
            c.targetGlyphCellId,
            "CONFIRMED",
            JSON.stringify({
              id,
              documentId: row.id,
              targetGlyphCellId: c.targetGlyphCellId,
              character: c.character,
              stance: c.stance,
              quote: c.quote,
              locator: "",
              status: "CONFIRMED",
              origin: "SEED_ANNOTATION",
              createdBy: "system",
              reviewedBy: null,
              createdAt: now,
            })
          );
        });
      }
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}

/** 연구 데이터 초기화 (dev reset 전용) — 계정·세션은 보존 */
const RESEARCH_TABLES = [
  "research_sets", "stele_tabs", "source_records", "stele_assets", "documents",
  "glyph_cells", "hypotheses", "evidence", "cross_matches", "comparisons",
  "frontier_items", "benchmark_cases",
  "asset_variants", "three_d_jobs", "render_presets", "scene_looks", "camera_bookmarks",
  "set_members", "readings", "comments", "entity_versions", "bibliography",
  "document_claims", "exemplars", "variant_pairs", "chronology",
  "calibration_profiles", "analysis_runs",
];

export function wipe(db: Db): void {
  db.transaction(() => {
    for (const t of RESEARCH_TABLES) db.exec(`DELETE FROM ${t}`);
    // 감사 로그는 추가 전용 — 개발 리셋에서만 트리거를 잠시 내려 비운다
    db.exec("DROP TRIGGER IF EXISTS audit_no_delete");
    db.exec("DELETE FROM audit_events");
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_events'");
    for (const sql of AUDIT_TRIGGERS) db.exec(sql);
  })();
}
