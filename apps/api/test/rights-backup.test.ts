import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { verifyBackup } from "../src/backup";

const SET_ID = "early-korean-stelae-comparative";

const PLY = [
  "ply",
  "format ascii 1.0",
  "comment 테스트 픽스처 (가상)",
  "element vertex 3",
  "property float x",
  "property float y",
  "property float z",
  "element face 1",
  "property list uchar int vertex_indices",
  "end_header",
  "0 0 0",
  "550 0 0",
  "0 2030 0",
  "3 0 1 2",
  "",
].join("\n");

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0] : String(raw ?? "")).split(";")[0]!;
}

describe("서버 측 권리 게이트 · 스트리밍 업로드 · 백업 · 세트 번들", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let pi = "";
  let student = "";
  let guest = "";
  let uploadedId = "";

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-rights-test-"));
    const { buildServer } = await import("../src/server");
    app = buildServer({
      authMode: "local",
      enableDevReset: false,
      dataDir: tmpDir,
      maxUploadBytes: 2 * 1024 * 1024,
      fullParseMaxBytes: 64 * 1024,
    });
    await app.ready();
    pi = cookieFrom(
      await app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { email: "pi@lab.ac.kr", password: "correct-horse-battery", displayName: "PI" },
      })
    );
    for (const [email, role] of [
      ["student@lab.ac.kr", "RESEARCHER"],
      ["guest@lab.ac.kr", "GUEST"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/api/users",
        headers: { cookie: pi },
        payload: { email, displayName: email, role, password: "a-long-password-1" },
      });
    }
    student = cookieFrom(
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "student@lab.ac.kr", password: "a-long-password-1" } })
    );
    guest = cookieFrom(
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "guest@lab.ac.kr", password: "a-long-password-1" } })
    );
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("연구원이 PLY를 스트리밍 업로드 — 권리 미확인 상태로 등록", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/chungju-goguryeobi/assets/upload?filename=scan.ply&usagePurpose=${encodeURIComponent("연구 분석")}`,
      headers: { cookie: student, "content-type": "application/octet-stream" },
      payload: Buffer.from(PLY),
    });
    expect(res.statusCode).toBe(201);
    const asset = res.json();
    uploadedId = asset.id;
    expect(asset.rightsState).toBe("VERIFY_REQUIRED");
    expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.qualityReport.vertexCount).toBe(3);
    expect(asset.byteSize).toBe(Buffer.byteLength(PLY));
  });

  it("이미지(PNG)·탁본 업로드: 크기 판독 + 탁본 유형 지정", async () => {
    // 3×2 PNG 헤더만 있는 최소 파일 (IHDR까지)
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000030000000208020000000000000000",
      "hex"
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/jian-goguryeo-stele/assets/upload?filename=takbon.png&usagePurpose=x&declaredType=RUBBING`,
      headers: { cookie: student, "content-type": "application/octet-stream" },
      payload: png,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().assetType).toBe("RUBBING");
    expect(res.json().imageInfo).toEqual({ width: 3, height: 2 });
  });

  it("업로드 한도 초과는 413, 임시 파일이 남지 않는다; 대용량은 헤더 전용 검사", async () => {
    const big = Buffer.concat([Buffer.from(PLY), Buffer.alloc(3 * 1024 * 1024, 0x20)]);
    const res = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/chungju-goguryeobi/assets/upload?filename=huge.ply&usagePurpose=x`,
      headers: { cookie: student, "content-type": "application/octet-stream" },
      payload: big,
    });
    expect(res.statusCode).toBe(413);
    const originals = path.join(tmpDir, "originals");
    const leftovers = readdirSync(originals, { recursive: true }).filter((f) => String(f).includes(".part-"));
    expect(leftovers).toEqual([]);

    const medium = Buffer.concat([Buffer.from(PLY), Buffer.alloc(200 * 1024, 0x0a)]);
    const ok = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/chungju-goguryeobi/assets/upload?filename=medium.ply&usagePurpose=x`,
      headers: { cookie: student, "content-type": "application/octet-stream" },
      payload: medium,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().qualityReport.warnings.join(" ")).toContain("헤더만 검사");
    expect(ok.json().qualityReport.vertexCount).toBe(3);
  });

  it("권리 미확인 원본: 방문자 403 · 비로그인 401 · 연구원은 Range 206", async () => {
    const g = await app.inject({ method: "GET", url: `/api/assets/${uploadedId}/file`, headers: { cookie: guest } });
    expect(g.statusCode).toBe(403);
    expect(g.json().error).toBe("RIGHTS_RESTRICTED");
    const anon = await app.inject({ method: "GET", url: `/api/assets/${uploadedId}/file` });
    expect(anon.statusCode).toBe(401);
    const s = await app.inject({
      method: "GET",
      url: `/api/assets/${uploadedId}/file`,
      headers: { cookie: student, range: "bytes=0-2" },
    });
    expect(s.statusCode).toBe(206);
    expect(s.body).toBe("ply");
    expect(s.headers["cache-control"]).toContain("private");
  });

  it("파생 variant 파일도 원본 권리를 상속해 방문자에게 차단된다", async () => {
    const up = await app.inject({ method: "POST", url: `/api/3d/assets/${uploadedId}/upgrade`, headers: { cookie: student } });
    expect(up.statusCode).toBe(201);
    const variants = (
      await app.inject({ method: "GET", url: `/api/3d/assets/${uploadedId}/variants`, headers: { cookie: student } })
    ).json() as Array<{ id: string; storageKey: string | null }>;
    const withFile = variants.find((v) => v.storageKey);
    expect(withFile).toBeTruthy();
    const g = await app.inject({ method: "GET", url: `/api/3d/variants/${withFile!.id}/file`, headers: { cookie: guest } });
    expect(g.statusCode).toBe(403);
    const s = await app.inject({ method: "GET", url: `/api/3d/variants/${withFile!.id}/file`, headers: { cookie: student } });
    expect(s.statusCode).toBe(200);
  });

  it("공개 쇼케이스: PRIVATE 세트는 비로그인 401, PUBLIC 전환 후 열람 + 권리 미확인 자산은 서버에서 제외", async () => {
    const anon1 = await app.inject({ method: "GET", url: `/api/showcase/${SET_ID}` });
    expect(anon1.statusCode).toBe(401);
    const byStudent = await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}/visibility`,
      headers: { cookie: student },
      payload: { visibility: "PUBLIC" },
    });
    expect(byStudent.statusCode).toBe(403);
    await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}/visibility`,
      headers: { cookie: pi },
      payload: { visibility: "PUBLIC" },
    });
    const anon = await app.inject({ method: "GET", url: `/api/showcase/${SET_ID}` });
    expect(anon.statusCode).toBe(200);
    const body = anon.json();
    expect(body.viewerRole).toBeNull();
    expect(body.metrics.tabCount).toBe(6);
    const allAssetIds = body.tabs.flatMap((t: { assets: Array<{ id: string }> }) => t.assets.map((a) => a.id));
    expect(allAssetIds).not.toContain(uploadedId);
    expect(allAssetIds).toContain("asset-demo-a");
    expect(JSON.stringify(body)).not.toContain("originals/");
    expect(body.gatedAssets.some((g: { filename: string }) => g.filename === "scan.ply")).toBe(true);
    expect(body.focusCellId).toBeTruthy();
    expect(body.matrix.length).toBe(1);
    // 공개 세트의 가상 데모 variant는 비로그인도 받을 수 있다
    await app.inject({ method: "POST", url: "/api/3d/assets/asset-demo-a/upgrade", headers: { cookie: pi } });
    const demoVariants = (
      await app.inject({ method: "GET", url: "/api/3d/assets/asset-demo-a/variants", headers: { cookie: pi } })
    ).json() as Array<{ id: string; storageKey: string | null }>;
    const dv = demoVariants.find((v) => v.storageKey)!;
    const pub = await app.inject({ method: "GET", url: `/api/3d/variants/${dv.id}/file` });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers["cache-control"]).toContain("public");
    // 권리 미확인 파생 파일은 공개 세트여도 비로그인 차단
    const upVariants = (
      await app.inject({ method: "GET", url: `/api/3d/assets/${uploadedId}/variants`, headers: { cookie: pi } })
    ).json() as Array<{ id: string; storageKey: string | null }>;
    const uv = upVariants.find((v) => v.storageKey)!;
    expect((await app.inject({ method: "GET", url: `/api/3d/variants/${uv.id}/file` })).statusCode).toBe(401);
  });

  it("권리 확정은 PI만, 확인자는 세션 사용자로 기록 (클라이언트 입력 무시)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/assets/${uploadedId}/license`,
      headers: { cookie: pi },
      payload: { licenseType: "KOGL_TYPE_1", rightsState: "OPEN_FOR_REUSE", verifiedBy: "누군가", notes: "공공누리 1유형 확인" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().licenseVerifiedBy).toMatch(/^PI \(user-/);
  });

  let backupName = "";
  it("백업: DB + 원본 스냅샷, 매니페스트 체크섬 검증 통과", async () => {
    const byStudent = await app.inject({ method: "POST", url: "/api/admin/backup", headers: { cookie: student }, payload: {} });
    expect(byStudent.statusCode).toBe(403);
    const res = await app.inject({ method: "POST", url: "/api/admin/backup", headers: { cookie: pi }, payload: { label: "주간" } });
    expect(res.statusCode).toBe(200);
    backupName = res.json().name;
    expect(res.json().files).toBeGreaterThanOrEqual(3);
    const dir = path.join(tmpDir, "backups", backupName);
    expect(existsSync(path.join(dir, "seokmun.db"))).toBe(true);
    const v = verifyBackup(dir);
    expect(v.ok).toBe(true);
    // 하드링크 스냅샷 — 원본과 같은 inode
    const orig = path.join(tmpDir, "originals", uploadedId, "scan.ply");
    expect(statSync(path.join(dir, "originals", uploadedId, "scan.ply")).ino).toBe(statSync(orig).ino);
    const list = await app.inject({ method: "GET", url: "/api/admin/backups", headers: { cookie: pi } });
    expect(list.json()[0].label).toBe("주간");
  });

  it("세트 번들: 같은 서버 재가져오기는 409, 새 설치본에는 무손실 가져오기", async () => {
    const guestExport = await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}/bundle`, headers: { cookie: guest } });
    expect(guestExport.statusCode).toBe(403);
    const exp = await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}/bundle`, headers: { cookie: student } });
    expect(exp.statusCode).toBe(200);
    const bundle = exp.json();
    expect(bundle.tables.glyph_cells.length).toBeGreaterThan(40);
    expect(bundle.tables).not.toHaveProperty("benchmark_cases");
    expect(bundle.files.some((f: { storageKey: string }) => f.storageKey.includes("scan.ply"))).toBe(true);

    const conflict = await app.inject({ method: "POST", url: "/api/research-sets/import", headers: { cookie: pi }, payload: bundle });
    expect(conflict.statusCode).toBe(409);

    const dir2 = mkdtempSync(path.join(os.tmpdir(), "seokmun-import-"));
    const { buildServer } = await import("../src/server");
    const app2 = buildServer({ authMode: "dev", enableDevReset: false, dataDir: dir2, seedDemo: false });
    await app2.ready();
    const imp = await app2.inject({ method: "POST", url: "/api/research-sets/import", payload: bundle });
    expect(imp.statusCode).toBe(201);
    expect(imp.json().inserted.glyph_cells).toBe(bundle.tables.glyph_cells.length);
    expect(imp.json().missingFiles.length).toBeGreaterThan(0);
    const set = await app2.inject({ method: "GET", url: `/api/research-sets/${SET_ID}` });
    expect(set.statusCode).toBe(200);
    expect(set.json().tabs).toHaveLength(6);
    const audit = await app2.inject({ method: "GET", url: "/api/audit?action=IMPORT_BUNDLE" });
    expect(audit.json()[0].payload.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
    await app2.close();
    rmSync(dir2, { recursive: true, force: true });
  });
});

describe("saveStream — 길이를 모르는 스트림의 한도 초과", () => {
  it("나머지를 읽어 버리고 413 오류, 임시 파일 없음", async () => {
    const { Readable } = await import("node:stream");
    const { saveStream, UploadTooLargeError } = await import("../src/uploads");
    const dir = mkdtempSync(path.join(os.tmpdir(), "seokmun-stream-"));
    const chunks = Array.from({ length: 50 }, () => Buffer.alloc(64 * 1024, 1));
    await expect(saveStream(Readable.from(chunks), path.join(dir, "x.bin"), 1024 * 1024)).rejects.toBeInstanceOf(
      UploadTooLargeError
    );
    expect(readdirSync(dir)).toEqual([]);
    const ok = await saveStream(Readable.from([Buffer.from("abc")]), path.join(dir, "y.bin"), 1024);
    expect(ok.bytes).toBe(3);
    expect(ok.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    await expect(saveStream(Readable.from([Buffer.from("abc")]), path.join(dir, "y.bin"), 1024)).rejects.toMatchObject({
      code: "ORIGINAL_EXISTS",
    });
    rmSync(dir, { recursive: true, force: true });
  });
});
