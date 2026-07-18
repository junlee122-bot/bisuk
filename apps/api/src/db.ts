import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Db = Database.Database;

export function dataDir(): string {
  if (process.env.SEOKMUN_DATA_DIR) return process.env.SEOKMUN_DATA_DIR;
  if (process.env.VERCEL) {
    return path.join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", "seokmun-data");
  }
  return path.resolve(import.meta.dirname, "../.data");
}

export function openDb(): Db {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "seokmun.db"));
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

const TABLES = [
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

export function migrate(db: Db): void {
  for (const sql of TABLES) db.exec(sql);
}

export function wipe(db: Db): void {
  const tables = [
    "research_sets", "stele_tabs", "source_records", "stele_assets", "documents",
    "glyph_cells", "hypotheses", "evidence", "cross_matches", "comparisons",
    "frontier_items", "benchmark_cases", "audit_events",
    "asset_variants", "three_d_jobs", "render_presets", "scene_looks", "camera_bookmarks",
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
}
