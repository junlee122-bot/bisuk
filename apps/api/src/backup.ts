/**
 * 백업·복원·세트 번들.
 *
 * 백업: SQLite 온라인 백업(서버 가동 중 안전) + 원본·파생 파일 스냅샷.
 *   원본은 불변이므로 같은 파일시스템이면 하드링크로 스냅샷한다 (추가 용량 거의 0).
 * 번들: 연구 세트 하나를 테이블 행 그대로(무손실) JSON으로 내보내고, 다른 설치본에 가져온다.
 *   파일 본문은 번들에 넣지 않는다 — 백업/복사로 옮기고, 가져온 뒤 누락 파일을 보고한다.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import { SCHEMA_VERSION } from "./db";

export interface BackupManifest {
  format: "seokmun-backup";
  createdAt: string;
  schemaVersion: number;
  label: string;
  dbFile: string;
  files: Array<{ storageKey: string; bytes: number; sha256: string | null; kind: "original" | "derived" }>;
  note: string;
}

function snapshotFile(src: string, dst: string): void {
  mkdirSync(path.dirname(dst), { recursive: true });
  try {
    linkSync(src, dst); // 불변 파일 — 하드링크
  } catch {
    copyFileSync(src, dst);
  }
}

function listFiles(root: string, rel = ""): string[] {
  const dir = path.join(root, rel);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const r = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, r));
    else if (!entry.name.includes(".part-")) out.push(r);
  }
  return out;
}

export async function createBackup(
  db: Db,
  dataDir: string,
  opts: { outDir?: string; label?: string; includeFiles?: boolean } = {}
): Promise<{ dir: string; manifest: BackupManifest }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = opts.outDir ?? path.join(dataDir, "backups", stamp);
  mkdirSync(dir, { recursive: true });
  const dbFile = "seokmun.db";
  await db.backup(path.join(dir, dbFile));

  // 원본 체크섬은 업로드 시 기록된 값을 매니페스트에 싣는다 (복원 검증용)
  const shaByKey = new Map<string, string>();
  for (const row of db.prepare("SELECT data FROM stele_assets").all() as Array<{ data: string }>) {
    const a = JSON.parse(row.data) as { storageKey?: string | null; checksumSha256?: string | null };
    if (a.storageKey && a.checksumSha256) shaByKey.set(a.storageKey, a.checksumSha256);
  }
  const files: BackupManifest["files"] = [];
  if (opts.includeFiles !== false) {
    for (const [sub, kind] of [
      ["originals", "original"],
      ["derived", "derived"],
    ] as const) {
      for (const rel of listFiles(dataDir, sub)) {
        const src = path.join(dataDir, rel);
        snapshotFile(src, path.join(dir, rel));
        files.push({ storageKey: rel, bytes: statSync(src).size, sha256: shaByKey.get(rel) ?? null, kind });
      }
    }
  }
  const manifest: BackupManifest = {
    format: "seokmun-backup",
    createdAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    label: opts.label ?? "",
    dbFile,
    files,
    note:
      "복원: 서버를 멈추고 이 디렉터리의 seokmun.db·originals/·derived/를 새 SEOKMUN_DATA_DIR로 복사한 뒤 기동 (또는 `pnpm --filter @seokmun/api restore -- <백업경로> <새 데이터 디렉터리>`).",
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}

export function listBackups(dataDir: string): Array<{ name: string; createdAt: string; files: number; label: string }> {
  const root = path.join(dataDir, "backups");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => existsSync(path.join(root, n, "manifest.json")))
    .map((n) => {
      const m = JSON.parse(readFileSync(path.join(root, n, "manifest.json"), "utf8")) as BackupManifest;
      return { name: n, createdAt: m.createdAt, files: m.files.length, label: m.label };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 백업 무결성 검증 — 파일 존재·크기, 체크섬이 기록된 원본은 sha256 재계산 */
export function verifyBackup(dir: string): { ok: boolean; problems: string[]; checked: number } {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as BackupManifest;
  const problems: string[] = [];
  if (!existsSync(path.join(dir, manifest.dbFile))) problems.push(`DB 파일 없음: ${manifest.dbFile}`);
  for (const f of manifest.files) {
    const p = path.join(dir, f.storageKey);
    if (!existsSync(p)) {
      problems.push(`파일 없음: ${f.storageKey}`);
      continue;
    }
    if (statSync(p).size !== f.bytes) problems.push(`크기 불일치: ${f.storageKey}`);
    if (f.sha256) {
      const sha = createHash("sha256").update(readFileSync(p)).digest("hex");
      if (sha !== f.sha256) problems.push(`체크섬 불일치: ${f.storageKey}`);
    }
  }
  return { ok: problems.length === 0, problems, checked: manifest.files.length };
}

// ── 세트 번들 ──
type Row = Record<string, unknown>;

export interface SetBundle {
  format: "seokmun-set-bundle";
  version: 1;
  schemaVersion: number;
  exportedAt: string;
  researchSetId: string;
  tables: Record<string, Row[]>;
  /** 참고용 — 원 설치본의 감사 로그 (가져오기 시 체인에 삽입하지 않음) */
  auditTrail: Row[];
  files: Array<{ storageKey: string; sha256: string | null; bytes: number | null }>;
  note: string;
}

function inList(ids: string[]): { sql: string; params: string[] } {
  return { sql: ids.length ? ids.map(() => "?").join(",") : "NULL", params: ids };
}

function select(db: Db, table: string, where: string, params: unknown[]): Row[] {
  return db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params) as Row[];
}

const GLOBAL_SHARED_TABLES = new Set(["documents", "bibliography", "document_claims"]);

/** 번들로 주고받는 테이블 — 가져오기는 이 목록만 허용 (임의 테이블 삽입 방지) */
const BUNDLE_TABLES = new Set([
  "research_sets", "set_members", "stele_tabs", "source_records", "stele_assets",
  "asset_variants", "three_d_jobs", "glyph_cells", "readings", "hypotheses", "evidence",
  "cross_matches", "analysis_runs", "comparisons", "comments", "entity_versions",
  "document_claims", "documents", "bibliography",
]);

export function exportSetBundle(db: Db, setId: string): SetBundle {
  const t: Record<string, Row[]> = {};
  t.research_sets = select(db, "research_sets", "id = ?", [setId]);
  t.set_members = select(db, "set_members", "research_set_id = ?", [setId]);
  t.stele_tabs = select(db, "stele_tabs", "research_set_id = ?", [setId]);
  const tabIds = t.stele_tabs.map((r) => String(r.id));
  const T = inList(tabIds);
  t.source_records = select(db, "source_records", `stele_tab_id IN (${T.sql})`, T.params);
  t.stele_assets = select(db, "stele_assets", `stele_tab_id IN (${T.sql})`, T.params);
  const A = inList(t.stele_assets.map((r) => String(r.id)));
  t.asset_variants = select(db, "asset_variants", `stele_asset_id IN (${A.sql})`, A.params);
  t.three_d_jobs = select(db, "three_d_jobs", `stele_asset_id IN (${A.sql})`, A.params);
  t.glyph_cells = select(db, "glyph_cells", `stele_tab_id IN (${T.sql})`, T.params);
  const cellIds = t.glyph_cells.map((r) => String(r.id));
  const C = inList(cellIds);
  t.readings = select(db, "readings", `stele_tab_id IN (${T.sql})`, T.params);
  const readingIds = t.readings.map((r) => String(r.id));
  t.hypotheses = select(db, "hypotheses", `glyph_cell_id IN (${C.sql})`, C.params);
  const H = inList(t.hypotheses.map((r) => String(r.id)));
  t.evidence = select(db, "evidence", `hypothesis_id IN (${H.sql})`, H.params);
  t.cross_matches = select(db, "cross_matches", `source_glyph_cell_id IN (${C.sql})`, C.params);
  t.analysis_runs = select(db, "analysis_runs", `glyph_cell_id IN (${C.sql})`, C.params);
  t.comparisons = select(db, "comparisons", "research_set_id = ?", [setId]);
  const R = inList(readingIds);
  t.comments = [
    ...select(db, "comments", `target_type = 'GLYPH_CELL' AND target_id IN (${C.sql})`, C.params),
    ...select(db, "comments", `target_type = 'READING' AND target_id IN (${R.sql})`, R.params),
    ...select(db, "comments", `target_type = 'TAB' AND target_id IN (${T.sql})`, T.params),
  ];
  const entityIds = inList([...cellIds, ...readingIds, ...tabIds]);
  t.entity_versions = select(db, "entity_versions", `entity_id IN (${entityIds.sql})`, entityIds.params);
  t.document_claims = select(db, "document_claims", `target_glyph_cell_id IN (${C.sql})`, C.params);

  // 문헌: claim·근거가 참조하거나 탭에 연결된 문헌
  const docIds = new Set<string>(t.document_claims.map((r) => String(r.document_id)));
  for (const e of t.evidence) {
    const d = (JSON.parse(String(e.data)) as { documentId?: string | null }).documentId;
    if (d) docIds.add(d);
  }
  for (const row of db.prepare("SELECT id, data FROM documents").all() as Array<{ id: string; data: string }>) {
    const related = (JSON.parse(row.data) as { entity?: { relatedTabIds?: string[] } }).entity?.relatedTabIds ?? [];
    if (related.some((id) => tabIds.includes(id))) docIds.add(row.id);
  }
  const D = inList([...docIds]);
  t.documents = select(db, "documents", `id IN (${D.sql})`, D.params);
  const bibIds = new Set<string>();
  for (const r of t.readings) {
    const b = (JSON.parse(String(r.data)) as { bibliographyId?: string | null }).bibliographyId;
    if (b) bibIds.add(b);
  }
  for (const d of t.documents) {
    const b = (JSON.parse(String(d.data)) as { entity?: { bibliographyId?: string | null } }).entity?.bibliographyId;
    if (b) bibIds.add(b);
  }
  const B = inList([...bibIds]);
  t.bibliography = select(db, "bibliography", `id IN (${B.sql})`, B.params);

  const allIds = inList([setId, ...tabIds, ...cellIds, ...readingIds, ...A.params]);
  const auditTrail = (
    db
      .prepare(`SELECT seq, data FROM audit_events WHERE json_extract(data, '$.entityId') IN (${allIds.sql}) ORDER BY seq`)
      .all(...allIds.params) as Array<{ seq: number; data: string }>
  ).map((r) => ({ seq: r.seq, ...(JSON.parse(r.data) as Row) }));

  const files = t.stele_assets
    .map((r) => JSON.parse(String(r.data)) as { storageKey?: string | null; checksumSha256?: string | null; byteSize?: number | null })
    .filter((a) => a.storageKey)
    .map((a) => ({ storageKey: a.storageKey!, sha256: a.checksumSha256 ?? null, bytes: a.byteSize ?? null }));

  return {
    format: "seokmun-set-bundle",
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    researchSetId: setId,
    tables: t,
    auditTrail,
    files,
    note:
      "파일 본문은 포함하지 않습니다. files 목록의 원본을 백업에서 같은 storageKey 경로로 복사하세요. 숨김 벤치마크 정답은 내보내지 않습니다.",
  };
}

export class BundleConflictError extends Error {
  statusCode = 409;
  code = "BUNDLE_CONFLICT";
  constructor(public conflicts: Array<{ table: string; id: string }>) {
    super(`이미 존재하는 행과 충돌합니다 (${conflicts.length}건)`);
  }
}

function pkWhere(table: string, row: Row): { where: string; params: unknown[] } {
  switch (table) {
    case "set_members":
      return { where: "research_set_id = ? AND user_id = ?", params: [row.research_set_id, row.user_id] };
    default:
      return { where: "id = ?", params: [row.id] };
  }
}

export function importSetBundle(
  db: Db,
  dataDir: string,
  bundle: SetBundle
): { inserted: Record<string, number>; skippedShared: number; missingFiles: string[] } {
  if (bundle.format !== "seokmun-set-bundle" || bundle.version !== 1) {
    const e = new Error("지원하지 않는 번들 형식입니다") as Error & { statusCode: number; code: string };
    e.statusCode = 400;
    e.code = "BAD_BUNDLE";
    throw e;
  }
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    const e = new Error(
      `번들 스키마(v${bundle.schemaVersion})가 이 서버(v${SCHEMA_VERSION})보다 새롭습니다 — 서버를 먼저 업데이트하세요`
    ) as Error & { statusCode: number; code: string };
    e.statusCode = 400;
    e.code = "BUNDLE_TOO_NEW";
    throw e;
  }
  const allowedTables = BUNDLE_TABLES;
  const conflicts: Array<{ table: string; id: string }> = [];
  let skippedShared = 0;
  const toInsert: Array<{ table: string; row: Row }> = [];
  for (const [table, rows] of Object.entries(bundle.tables)) {
    if (!allowedTables.has(table) || !/^[a-z_]+$/.test(table)) continue;
    for (const row of rows) {
      const { where, params } = pkWhere(table, row);
      const existing = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...params) as Row | undefined;
      if (existing) {
        // 공유 코퍼스(문헌·서지·claim)는 동일 내용이면 건너뛴다
        if (GLOBAL_SHARED_TABLES.has(table) && existing.data === row.data) {
          skippedShared++;
          continue;
        }
        conflicts.push({ table, id: String(row.id ?? `${row.research_set_id}/${row.user_id}`) });
        continue;
      }
      toInsert.push({ table, row });
    }
  }
  if (conflicts.length > 0) throw new BundleConflictError(conflicts.slice(0, 50));
  const inserted: Record<string, number> = {};
  db.transaction(() => {
    for (const { table, row } of toInsert) {
      const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
      db.prepare(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
      ).run(...cols.map((c) => row[c]));
      inserted[table] = (inserted[table] ?? 0) + 1;
    }
  })();
  const missingFiles = bundle.files
    .filter((f) => !existsSync(path.join(dataDir, f.storageKey)))
    .map((f) => f.storageKey);
  return { inserted, skippedShared, missingFiles };
}
