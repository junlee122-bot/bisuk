import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-3d-test-"));
  process.env.SEOKMUN_DATA_DIR = tmpDir;
  const { buildServer } = await import("../src/server");
  app = buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("3D 업그레이드 파이프라인 (데모 자산)", () => {
  it("DEMO-A 업그레이드: Evidence LOD 3종 + PBR 2종, 실측 LOD 오차 기록", async () => {
    const res = await app.inject({ method: "POST", url: "/api/3d/assets/asset-demo-a/upgrade" });
    expect(res.statusCode).toBe(201);
    const job = res.json();
    expect(job.stage).toBe("READY");
    const stages = job.stageLog.map((s: { stage: string }) => s.stage);
    expect(stages).toEqual(
      expect.arrayContaining(["VALIDATING", "INSPECTING", "GENERATING_LOD", "BAKING", "COMPRESSING", "QUALITY_CHECK", "READY"])
    );
    expect(job.outputVariantIds).toHaveLength(5);

    const variants = (
      await app.inject({ method: "GET", url: "/api/3d/assets/asset-demo-a/variants" })
    ).json();
    const high = variants.find((v: { variantType: string }) => v.variantType === "EVIDENCE_MESH_HIGH");
    const preview = variants.find((v: { variantType: string }) => v.variantType === "EVIDENCE_MESH_PREVIEW");
    expect(high.measurementAllowed).toBe(true);
    expect(high.triangleCount).toBeGreaterThan(100000);
    expect(high.byteSize).toBeGreaterThan(10000);
    expect(high.sha256).toHaveLength(64);
    // LOD 오차 단조성: preview 오차 > high 오차
    expect(preview.metrics.lodSurfaceErrorP95).toBeGreaterThan(high.metrics.lodSurfaceErrorP95);
    // PBR은 표현 보강이며 측정 불가 + 계보 기록
    const pbr = variants.find((v: { variantType: string }) => v.variantType === "PBR_MESH_HIGH");
    expect(pbr.sourceState).toBe("PRESENTATION_ENHANCED");
    expect(pbr.measurementAllowed).toBe(false);
    expect(pbr.parentVariantIds).toContain(high.id);
  });

  it("variant GLB 파일이 서빙된다 (glTF 매직 바이트)", async () => {
    const variants = (
      await app.inject({ method: "GET", url: "/api/3d/assets/asset-demo-a/variants" })
    ).json();
    const v = variants.find((x: { format: string }) => x.format === "GLB");
    const res = await app.inject({ method: "GET", url: `/api/3d/variants/${v.id}/file` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("model/gltf-binary");
    expect(res.rawPayload.subarray(0, 4).toString("latin1")).toBe("glTF");
  });

  it("품질 보고서: 고지문 + 진단 + 파이프라인 버전", async () => {
    const report = (
      await app.inject({ method: "GET", url: "/api/3d/assets/asset-demo-a/quality-report" })
    ).json();
    expect(report.disclaimers).toContain("원본 기하 정밀도보다 높은 측정 정확도를 보장하지 않음");
    expect(report.diagnostics.join(" ")).toContain("가상 데모");
    expect(report.pipelineVersion).toBeTruthy();
    expect(report.variants.length).toBeGreaterThanOrEqual(5);
  });

  it("글자 detail patch 생성 + 캐시(멱등)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/3d/mesh/generate-detail-patches",
      payload: { assetId: "asset-demo-a", glyphCellIds: ["demoA-L2-C3"], resolution: 64 },
    });
    expect(res.statusCode).toBe(200);
    const first = res.json().variants[0];
    expect(first.variantType).toBe("GLYPH_DETAIL_PATCH");
    expect(first.glyphCellId).toBe("demoA-L2-C3");
    expect(first.triangleCount).toBe(64 * 64 * 2);
    const again = (
      await app.inject({
        method: "POST",
        url: "/api/3d/mesh/generate-detail-patches",
        payload: { assetId: "asset-demo-a", glyphCellIds: ["demoA-L2-C3"], resolution: 64 },
      })
    ).json().variants[0];
    expect(again.id).toBe(first.id);
  });

  it("splat 데모: 표시 전용 variant 2종 (PLY + 바이너리 전달)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/3d/splat/demo",
      payload: { assetId: "asset-demo-a" },
    });
    expect(res.statusCode).toBe(201);
    const job = res.json();
    expect(job.outputVariantIds).toHaveLength(2);
    const variants = (
      await app.inject({ method: "GET", url: "/api/3d/assets/asset-demo-a/variants" })
    ).json();
    const splat = variants.find((v: { variantType: string }) => v.variantType === "SPLAT_DELIVERY_SOG");
    expect(splat.visualizationOnly).toBe(true);
    expect(splat.measurementAllowed).toBe(false);
    expect(splat.splatCount).toBe(60000);
    const file = await app.inject({ method: "GET", url: `/api/3d/variants/${splat.id}/file` });
    // [count u32][pos f32*3n][col f32*3n][size f32*n]
    expect(file.rawPayload.readUInt32LE(0)).toBe(60000);
    expect(file.rawPayload.length).toBe(4 + 60000 * 4 * 7);
  });

  it("splat/train은 어댑터 미설치를 정직하게 보고 (501)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/3d/splat/train", payload: {} });
    expect(res.statusCode).toBe(501);
    expect(res.json().adapter.available).toBe(false);
  });
});

describe("어댑터 레지스트리", () => {
  it("전체 어댑터 상태 — 이 환경에서는 모두 UNAVAILABLE/DISABLED", async () => {
    const adapters = (await app.inject({ method: "GET", url: "/api/3d/adapters" })).json();
    expect(adapters.length).toBeGreaterThanOrEqual(8);
    for (const a of adapters) {
      expect(a.available).toBe(false);
    }
    const openmvs = adapters.find((a: { id: string }) => a.id === "openmvs");
    expect(openmvs.enabled).toBe(false);
    expect(openmvs.licenseWarning).toContain("AGPL");
    const rs = adapters.find((a: { id: string }) => a.id === "realityscan");
    expect(rs.licenseClass).toBe("COMMERCIAL");
  });

  it("미가용 어댑터로 재구성 제출 시 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/3d/reconstruction/jobs",
      payload: { adapterId: "colmap" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain("UNAVAILABLE");
  });
});

describe("업로드 자산 3D 파이프라인", () => {
  it("ASCII PLY 업로드 → Evidence LOD 파생 (클러스터 간소화)", async () => {
    // 조밀한 평면 그리드 PLY 생성 (30x30)
    const n = 30;
    const verts: string[] = [];
    const faces: string[] = [];
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) {
        verts.push(`${(x / n).toFixed(4)} ${(y / n).toFixed(4)} ${(Math.sin(x * 0.7) * 0.01).toFixed(5)}`);
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = y * (n + 1) + x;
        faces.push(`3 ${a} ${a + 1} ${a + n + 1}`);
        faces.push(`3 ${a + 1} ${a + n + 2} ${a + n + 1}`);
      }
    }
    const ply = [
      "ply", "format ascii 1.0",
      `element vertex ${(n + 1) * (n + 1)}`,
      "property float x", "property float y", "property float z",
      `element face ${n * n * 2}`,
      "property list uchar int vertex_indices",
      "end_header", ...verts, ...faces, "",
    ].join("\n");
    const upload = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/uljin-bongpyeong-stele/assets/upload?filename=scan.ply&usagePurpose=${encodeURIComponent("3D 검증")}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(ply),
    });
    expect(upload.statusCode).toBe(201);
    const assetId = upload.json().id;
    const job = (
      await app.inject({ method: "POST", url: `/api/3d/assets/${assetId}/upgrade` })
    ).json();
    expect(job.stage).toBe("READY");
    const variants = (
      await app.inject({ method: "GET", url: `/api/3d/assets/${assetId}/variants` })
    ).json();
    const high = variants.find((v: { variantType: string }) => v.variantType === "EVIDENCE_MESH_HIGH");
    expect(high.triangleCount).toBe(n * n * 2);
    expect(high.pipelineName).toBe("upload-ingest");
    expect(high.metrics.hadNormals).toBe(false);
  });
});
