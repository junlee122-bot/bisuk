import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SceneLook, CameraBookmark } from "@seokmun/types";

let app: FastifyInstance;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-look-test-"));
  process.env.SEOKMUN_DATA_DIR = tmpDir;
  const { buildServer } = await import("../src/server");
  app = buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SceneLook CRUD + 내장 프리셋", () => {
  it("내장 프리셋 6종이 시드된다 (스펙 §12 이름 일치)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/3d/scene-looks" });
    expect(res.statusCode).toBe(200);
    const looks = res.json() as SceneLook[];
    const names = looks.filter((l) => l.builtIn).map((l) => l.name);
    for (const expected of [
      "MUSEUM_WARM",
      "LAB_NEUTRAL",
      "RAKING_EAST",
      "RAKING_WEST",
      "SOURCE_COLOR_REVIEW",
      "PORTFOLIO_HERO",
    ]) {
      expect(names).toContain(expected);
    }
    // 직렬화 왕복 — 저장된 모든 룩이 스키마를 통과한다
    for (const look of looks) {
      expect(() => SceneLook.parse(JSON.parse(JSON.stringify(look)))).not.toThrow();
    }
    // SOURCE_COLOR_REVIEW는 톤매핑 개입 최소(Neutral)
    const scr = looks.find((l) => l.name === "SOURCE_COLOR_REVIEW")!;
    expect(scr.toneMapping).toBe("NEUTRAL");
    expect(scr.representation).toBe("UNLIT_ORIGINAL");
  });

  it("생성 → 조회 → 수정(버전 증가) → 삭제", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/3d/scene-looks",
      payload: { name: "내 사광 세팅", lightingPreset: "RAKING", lightAzimuthDeg: 200 },
    });
    expect(created.statusCode).toBe(201);
    const look = created.json() as SceneLook;
    expect(look.builtIn).toBe(false);
    expect(look.version).toBe(1);
    expect(look.lightAzimuthDeg).toBe(200);

    const fetched = await app.inject({ method: "GET", url: `/api/3d/scene-looks/${look.id}` });
    expect(fetched.statusCode).toBe(200);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/3d/scene-looks/${look.id}`,
      payload: { exposure: 1.3 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().version).toBe(2);
    expect(patched.json().exposure).toBe(1.3);

    const deleted = await app.inject({ method: "DELETE", url: `/api/3d/scene-looks/${look.id}` });
    expect(deleted.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: `/api/3d/scene-looks/${look.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it("검증 실패는 400 + issues, 내장 삭제는 409", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/3d/scene-looks",
      payload: { name: "", lightingPreset: "NOT_A_PRESET" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("VALIDATION");

    const badExposure = await app.inject({
      method: "POST",
      url: "/api/3d/scene-looks",
      payload: { name: "x", lightingPreset: "RAKING", exposure: 99 },
    });
    expect(badExposure.statusCode).toBe(400);

    const del = await app.inject({ method: "DELETE", url: "/api/3d/scene-looks/look-museum-warm" });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe("BUILT_IN");
  });
});

describe("CameraBookmark CRUD", () => {
  it("생성 → 목록 → 삭제, 스키마 왕복", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/3d/camera-bookmarks",
      payload: {
        name: "내 히어로 뷰",
        projection: "perspective",
        position: [1.7, -0.12, 4.55],
        target: [0, 0.05, 0],
        fov: 32,
        near: 0.01,
        far: 50,
        assetVariantId: "asset-demo-a",
        selectedGlyphId: "demoA-L2-C3",
      },
    });
    expect(created.statusCode).toBe(201);
    const bm = created.json() as CameraBookmark;
    expect(bm.up).toEqual([0, 1, 0]); // 기본값
    expect(() => CameraBookmark.parse(JSON.parse(JSON.stringify(bm)))).not.toThrow();

    const list = await app.inject({ method: "GET", url: "/api/3d/camera-bookmarks" });
    expect(list.json().some((b: CameraBookmark) => b.id === bm.id)).toBe(true);

    const del = await app.inject({ method: "DELETE", url: `/api/3d/camera-bookmarks/${bm.id}` });
    expect(del.statusCode).toBe(200);
  });

  it("position 튜플 검증 실패 → 400", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/3d/camera-bookmarks",
      payload: {
        name: "broken",
        projection: "perspective",
        position: [1, 2],
        target: [0, 0, 0],
        near: 0.01,
        far: 50,
        assetVariantId: "a",
      },
    });
    expect(bad.statusCode).toBe(400);
  });
});
