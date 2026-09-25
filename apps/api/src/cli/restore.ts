/**
 * 복원 CLI — 서버를 멈춘 상태에서 실행한다.
 *   pnpm --filter @seokmun/api restore -- <백업 디렉터리> <새 데이터 디렉터리> [--force]
 * 백업을 검증(체크섬)한 뒤 새 데이터 디렉터리로 복사한다. 기존 디렉터리는 --force 없이는 덮어쓰지 않는다.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifyBackup, type BackupManifest } from "../backup";

const [src, dst] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!src || !dst) {
  console.error("사용법: restore <백업 디렉터리> <새 데이터 디렉터리> [--force]");
  process.exit(2);
}
const force = process.argv.includes("--force");
const v = verifyBackup(src);
if (!v.ok) {
  console.error(`백업 검증 실패 — 복원을 중단합니다:\n- ${v.problems.join("\n- ")}`);
  process.exit(1);
}
if (existsSync(dst) && readdirSync(dst).length > 0 && !force) {
  console.error(`${dst} 가 비어 있지 않습니다. 덮어쓰려면 --force`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(src, "manifest.json"), "utf8")) as BackupManifest;
mkdirSync(dst, { recursive: true });
copyFileSync(path.join(src, manifest.dbFile), path.join(dst, "seokmun.db"));
for (const f of manifest.files) {
  const to = path.join(dst, f.storageKey);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(path.join(src, f.storageKey), to);
}
console.log(`복원 완료: ${dst} (파일 ${manifest.files.length}개). SEOKMUN_DATA_DIR=${dst} 로 서버를 기동하세요.`);
