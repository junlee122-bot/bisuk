import { describe, expect, it } from "vitest";
import { lodSurfaceError, makeSurfaceField } from "../src/heightfield";
import {
  buildDetailPatchMesh,
  buildSlabMesh,
  sampleSplatPoints,
  splatToAsciiPly,
} from "../src/meshBuild";
import {
  parsePlyToMesh,
  parseStlToMesh,
  vertexClusterDecimate,
} from "../src/meshIngest";
import { loadDemoSeed } from "./helpers";

function demoAInput() {
  const seed = loadDemoSeed();
  const cells = seed.cells.filter((c) => c.steleTabId === "chungju-goguryeobi");
  const params = {
    width: 0.55, height: 2.0, depth: 0.4, noiseSeed: 41, noiseAmp: 0.012,
    crack: { from: [0.12, 0.62] as [number, number], to: [0.95, 0.78] as [number, number], depth: 0.02, widthFrac: 0.035 },
  };
  return { params, cells };
}

describe("높이장 (공유 수식)", () => {
  it("결정적: 같은 (u,v)는 항상 같은 표면 값", () => {
    const { params, cells } = demoAInput();
    const f1 = makeSurfaceField(params, cells);
    const f2 = makeSurfaceField(params, cells);
    expect(f1.sample(0.5, 0.5)).toEqual(f2.sample(0.5, 0.5));
  });

  it("획 중심은 주변보다 깊고 kind=STROKE로 분류된다", () => {
    const { params, cells } = demoAInput();
    const field = makeSurfaceField(params, cells);
    // demoA-L1-C1(王)의 bbox 중심을 찾는다
    const cell = cells.find((c) => c.id === "demoA-L1-C1")!;
    const [bx, by, bw, bh] = cell.bbox2d;
    // 王의 세로획 중앙 (자형 좌표 50,50)
    const u = bx + bw * 0.5;
    const v = by + bh * 0.5;
    const onStroke = field.sample(u, v);
    const offStroke = field.sample(bx - 0.03, by - 0.02);
    expect(onStroke.kind).toBe("STROKE");
    expect(onStroke.engrave).toBeGreaterThan(offStroke.engrave);
  });

  it("법선은 단위 벡터이고 평면부에서 +Z를 향한다", () => {
    const { params, cells } = demoAInput();
    const field = makeSurfaceField(params, cells);
    const n = field.normalAt(0.02, 0.02);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
    expect(n[2]).toBeGreaterThan(0.8);
  });

  it("LOD 오차: 저해상 격자일수록 P95 오차가 크다 (정직한 단조성)", () => {
    const { params, cells } = demoAInput();
    const coarse = lodSurfaceError(params, cells, [24, 64], 3000);
    const fine = lodSurfaceError(params, cells, [96, 256], 3000);
    expect(coarse.p95).toBeGreaterThan(fine.p95);
    expect(fine.p95).toBeLessThan(0.004); // bbox 최장변 2m의 0.2% 미만
  });
});

describe("메시 빌더 (순수 TS)", () => {
  it("슬래브 메시: 정점·삼각형 수와 경계가 정확하다", () => {
    const { params, cells } = demoAInput();
    const mesh = buildSlabMesh(params, cells, [48, 128]);
    expect(mesh.vertexCount).toBe(49 * 129 + 20);
    expect(mesh.triangleCount).toBe(48 * 128 * 2 + 10);
    expect(mesh.bounds.max[1]).toBeCloseTo(1.0, 3);
    expect(mesh.bounds.min[2]).toBeCloseTo(-0.2, 3);
    // 전면 정점의 z는 depth/2 이하 (홈은 파이기만 함)
    expect(mesh.bounds.max[2]).toBeLessThanOrEqual(0.2 + 1e-6);
  });

  it("detail patch: 셀 영역 국소 격자, 전역 표면과 동일 수식", () => {
    const { params, cells } = demoAInput();
    const cell = cells.find((c) => c.id === "demoA-L2-C3")!;
    const patch = buildDetailPatchMesh(params, cells, cell, 64);
    expect(patch.triangleCount).toBe(64 * 64 * 2);
    // 패치 경계가 셀 bbox(여백 포함)를 벗어나지 않는다
    const [bx, , bw] = cell.bbox2d;
    const minX = (Math.max(0, bx - bw * 0.15) - 0.5) * params.width;
    expect(patch.bounds.min[0]).toBeGreaterThanOrEqual(minX - 1e-6);
  });

  it("스플랫 샘플: 표시 전용 포인트 + PLY 직렬화", () => {
    const { params, cells } = demoAInput();
    const splat = sampleSplatPoints(params, cells, 500);
    expect(splat.count).toBe(500);
    const ply = splatToAsciiPly(splat);
    expect(ply).toContain("element vertex 500");
    expect(ply).toContain("visualization only");
    expect(ply.split("\n").length).toBeGreaterThan(500);
  });
});

describe("업로드 메시 파서 + 간소화", () => {
  const plyText = [
    "ply", "format ascii 1.0",
    "element vertex 4",
    "property float x", "property float y", "property float z",
    "element face 2",
    "property list uchar int vertex_indices",
    "end_header",
    "0 0 0", "1 0 0", "1 1 0", "0 1 0",
    "3 0 1 2", "3 0 2 3",
  ].join("\n");

  it("ASCII PLY → 메시 배열 (법선 재계산 경고 포함)", () => {
    const parsed = parsePlyToMesh(Buffer.from(plyText, "latin1"))!;
    expect(parsed.arrays.vertexCount).toBe(4);
    expect(parsed.arrays.triangleCount).toBe(2);
    expect(parsed.hadNormals).toBe(false);
    expect(parsed.warnings.join(" ")).toContain("법선");
    // 법선은 +Z
    expect(parsed.arrays.normals[2]).toBeCloseTo(1, 4);
  });

  it("바이너리 STL → 정점 중복 통합", () => {
    const buf = Buffer.alloc(84 + 50 * 2);
    buf.writeUInt32LE(2, 80);
    const tris = [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    ];
    tris.forEach((tri, t) => {
      tri.forEach((v, i) => {
        const off = 84 + t * 50 + 12 + i * 12;
        buf.writeFloatLE(v[0]!, off);
        buf.writeFloatLE(v[1]!, off + 4);
        buf.writeFloatLE(v[2]!, off + 8);
      });
    });
    const parsed = parseStlToMesh(buf)!;
    expect(parsed.arrays.vertexCount).toBe(4); // 6 → 4 (중복 통합)
    expect(parsed.arrays.triangleCount).toBe(2);
  });

  it("정점 클러스터링: 삼각형 수가 목표 수준으로 감소하고 오차 상한을 보고", () => {
    const { params, cells } = demoAInput();
    const mesh = buildSlabMesh(params, cells, [96, 256]);
    const { arrays, cellSize } = vertexClusterDecimate(mesh, 8000);
    expect(arrays.triangleCount).toBeLessThan(mesh.triangleCount);
    expect(arrays.triangleCount).toBeLessThanOrEqual(8000 * 1.3);
    expect(cellSize).toBeGreaterThan(0);
  });
});
