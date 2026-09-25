/**
 * 백업 CLI — 서버 가동 중에도 안전 (SQLite 온라인 백업).
 *   pnpm --filter @seokmun/api backup -- [--out <디렉터리>] [--label <이름>] [--verify]
 * SEOKMUN_DATA_DIR 의 DB·원본·파생 파일을 스냅샷한다.
 */
import path from "node:path";
import { loadConfig } from "../config";
import { openDb } from "../db";
import { createBackup, verifyBackup } from "../backup";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const outDir = arg("--out") ? path.resolve(arg("--out")!) : undefined;
const { dir, manifest } = await createBackup(db, cfg.dataDir, { outDir, label: arg("--label") ?? "cli" });
db.close();
console.log(`백업 완료: ${dir} (파일 ${manifest.files.length}개, 스키마 v${manifest.schemaVersion})`);
if (args.includes("--verify")) {
  const v = verifyBackup(dir);
  console.log(v.ok ? `검증 통과 (${v.checked}개 파일)` : `검증 실패:\n- ${v.problems.join("\n- ")}`);
  process.exit(v.ok ? 0 : 1);
}
