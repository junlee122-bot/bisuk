/**
 * 순수 TS 메시 빌더 — 서버 파이프라인(GLB 파생 자산)과 클라이언트 뷰어가 공유.
 * three.js 의존 없음. 모든 산출물은 VIRTUAL_DEMO 절차 생성물이다.
 */
import type { GlyphCell } from "@seokmun/types";
import { makeSurfaceField, type SlabParams } from "./heightfield";
import { hashString, mulberry32 } from "./random";

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  vertexCount: number;
  triangleCount: number;
}

function computeBounds(positions: Float32Array): MeshArrays["bounds"] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * 전면 고밀도 격자 + 단순 측면/후면 슬래브.
 * 전면(비문면)은 높이장 변위 + 해석적 법선, 나머지 면은 평면.
 */
export function buildSlabMesh(
  params: SlabParams,
  cells: GlyphCell[],
  grid: [number, number],
  opts: { cavityStrength?: number } = {}
): MeshArrays {
  const [gx, gy] = grid;
  const field = makeSurfaceField(params, cells);
  const w = params.width;
  const h = params.height;
  const d = params.depth;
  const cavity = opts.cavityStrength ?? 0.6;

  const frontVerts = (gx + 1) * (gy + 1);
  // 측면·후면: 상자 5개 면 × 4정점
  const sideVerts = 5 * 4;
  const vertexCount = frontVerts + sideVerts;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  let p = 0;
  for (let iy = 0; iy <= gy; iy++) {
    for (let ix = 0; ix <= gx; ix++) {
      const u = ix / gx;
      const v = iy / gy;
      const s = field.sample(u, v);
      const n = field.normalAt(u, v);
      const c = field.albedoAt(u, v, cavity);
      positions[p * 3] = (u - 0.5) * w;
      positions[p * 3 + 1] = (0.5 - v) * h;
      positions[p * 3 + 2] = d / 2 - s.engrave;
      normals[p * 3] = n[0];
      normals[p * 3 + 1] = n[1];
      normals[p * 3 + 2] = n[2];
      colors[p * 3] = c[0];
      colors[p * 3 + 1] = c[1];
      colors[p * 3 + 2] = c[2];
      p++;
    }
  }

  // 측면/후면 (평면, 중성 색)
  const sideColor: [number, number, number] = [0.52, 0.5, 0.455];
  const quads: Array<{
    verts: Array<[number, number, number]>;
    normal: [number, number, number];
  }> = [
    { verts: [[-w/2, h/2, -d/2], [w/2, h/2, -d/2], [w/2, -h/2, -d/2], [-w/2, -h/2, -d/2]], normal: [0, 0, -1] },
    { verts: [[-w/2, h/2, -d/2], [-w/2, h/2, d/2], [w/2, h/2, d/2], [w/2, h/2, -d/2]], normal: [0, 1, 0] },
    { verts: [[-w/2, -h/2, d/2], [-w/2, -h/2, -d/2], [w/2, -h/2, -d/2], [w/2, -h/2, d/2]], normal: [0, -1, 0] },
    { verts: [[-w/2, h/2, -d/2], [-w/2, -h/2, -d/2], [-w/2, -h/2, d/2], [-w/2, h/2, d/2]], normal: [-1, 0, 0] },
    { verts: [[w/2, h/2, d/2], [w/2, -h/2, d/2], [w/2, -h/2, -d/2], [w/2, h/2, -d/2]], normal: [1, 0, 0] },
  ];
  const sideBase = frontVerts;
  let sv = 0;
  for (const q of quads) {
    for (const vert of q.verts) {
      const idx = sideBase + sv;
      positions[idx * 3] = vert[0];
      positions[idx * 3 + 1] = vert[1];
      positions[idx * 3 + 2] = vert[2];
      normals[idx * 3] = q.normal[0];
      normals[idx * 3 + 1] = q.normal[1];
      normals[idx * 3 + 2] = q.normal[2];
      colors[idx * 3] = sideColor[0];
      colors[idx * 3 + 1] = sideColor[1];
      colors[idx * 3 + 2] = sideColor[2];
      sv++;
    }
  }

  const frontTris = gx * gy * 2;
  const indices = new Uint32Array((frontTris + 10) * 3);
  let t = 0;
  for (let iy = 0; iy < gy; iy++) {
    for (let ix = 0; ix < gx; ix++) {
      const a = iy * (gx + 1) + ix;
      const b = a + 1;
      const c = a + (gx + 1);
      const e = c + 1;
      indices[t++] = a; indices[t++] = c; indices[t++] = b;
      indices[t++] = b; indices[t++] = c; indices[t++] = e;
    }
  }
  for (let q = 0; q < 5; q++) {
    const base = sideBase + q * 4;
    indices[t++] = base; indices[t++] = base + 1; indices[t++] = base + 2;
    indices[t++] = base; indices[t++] = base + 2; indices[t++] = base + 3;
  }

  return {
    positions,
    normals,
    colors,
    indices,
    bounds: computeBounds(positions),
    vertexCount,
    triangleCount: frontTris + 10,
  };
}

/**
 * 글자 detail patch — 셀 bbox(+여백)를 고해상 국소 격자로 재샘플.
 * 표면 위치는 전역 높이장과 동일 (seam 방지: 동일 수식 + depth bias는 렌더러에서).
 */
export function buildDetailPatchMesh(
  params: SlabParams,
  cells: GlyphCell[],
  cell: GlyphCell,
  resolution = 96,
  opts: { cavityStrength?: number } = {}
): MeshArrays {
  const field = makeSurfaceField(params, cells);
  const [bx, by, bw, bh] = cell.bbox2d;
  const margin = 0.15;
  const u0 = Math.max(0, bx - bw * margin);
  const u1 = Math.min(1, bx + bw * (1 + margin));
  const v0 = Math.max(0, by - bh * margin);
  const v1 = Math.min(1, by + bh * (1 + margin));
  const res = Math.max(16, Math.floor(resolution));
  const cavity = opts.cavityStrength ?? 0.6;

  const vertexCount = (res + 1) * (res + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  let p = 0;
  for (let iy = 0; iy <= res; iy++) {
    for (let ix = 0; ix <= res; ix++) {
      const u = u0 + (ix / res) * (u1 - u0);
      const v = v0 + (iy / res) * (v1 - v0);
      const s = field.sample(u, v);
      const n = field.normalAt(u, v);
      const c = field.albedoAt(u, v, cavity);
      positions[p * 3] = (u - 0.5) * params.width;
      positions[p * 3 + 1] = (0.5 - v) * params.height;
      positions[p * 3 + 2] = params.depth / 2 - s.engrave;
      normals[p * 3] = n[0];
      normals[p * 3 + 1] = n[1];
      normals[p * 3 + 2] = n[2];
      colors[p * 3] = c[0];
      colors[p * 3 + 1] = c[1];
      colors[p * 3 + 2] = c[2];
      p++;
    }
  }
  const indices = new Uint32Array(res * res * 6);
  let t = 0;
  for (let iy = 0; iy < res; iy++) {
    for (let ix = 0; ix < res; ix++) {
      const a = iy * (res + 1) + ix;
      const b = a + 1;
      const c = a + (res + 1);
      const e = c + 1;
      indices[t++] = a; indices[t++] = c; indices[t++] = b;
      indices[t++] = b; indices[t++] = c; indices[t++] = e;
    }
  }
  return {
    positions,
    normals,
    colors,
    indices,
    bounds: computeBounds(positions),
    vertexCount,
    triangleCount: res * res * 2,
  };
}

export interface SplatPoints {
  /** xyz */
  positions: Float32Array;
  /** rgb 0..1 */
  colors: Float32Array;
  /** 월드 단위 반지름 */
  sizes: Float32Array;
  count: number;
}

/**
 * 표면 point-splat 샘플 — 실감 표시 전용(visualization_only).
 * 측정·판독 기준이 아니며 Evidence Mesh를 대체하지 않는다.
 */
export function sampleSplatPoints(
  params: SlabParams,
  cells: GlyphCell[],
  count = 60000
): SplatPoints {
  const field = makeSurfaceField(params, cells);
  const rand = mulberry32(hashString(`splat-${params.noiseSeed}-${count}`));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const spacing = Math.sqrt((params.width * params.height) / count);
  for (let i = 0; i < count; i++) {
    const u = rand();
    const v = rand();
    const s = field.sample(u, v);
    const n = field.normalAt(u, v);
    const c = field.albedoAt(u, v, 0.8);
    // 약한 헤미스피어 음영을 색에 베이크 (splat 특유의 사진같은 인상)
    const sky = 0.75 + 0.25 * n[1];
    const jitter = (rand() - 0.5) * 0.03;
    positions[i * 3] = (u - 0.5) * params.width;
    positions[i * 3 + 1] = (0.5 - v) * params.height;
    positions[i * 3 + 2] = params.depth / 2 - s.engrave;
    colors[i * 3] = Math.max(0, Math.min(1, c[0] * sky + jitter));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, c[1] * sky + jitter));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, c[2] * sky + jitter));
    sizes[i] = spacing * (1.6 + rand() * 0.9);
  }
  return { positions, colors, sizes, count };
}

/** SPLAT_SOURCE_PLY 직렬화 (ASCII PLY, radius 커스텀 속성 포함) */
export function splatToAsciiPly(splat: SplatPoints): string {
  const lines = [
    "ply",
    "format ascii 1.0",
    "comment seokmun virtual demo point splat - visualization only, not a measurement",
    `element vertex ${splat.count}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "property float radius",
    "end_header",
  ];
  for (let i = 0; i < splat.count; i++) {
    lines.push(
      `${splat.positions[i * 3]!.toFixed(5)} ${splat.positions[i * 3 + 1]!.toFixed(5)} ${splat.positions[i * 3 + 2]!.toFixed(5)} ` +
        `${Math.round(splat.colors[i * 3]! * 255)} ${Math.round(splat.colors[i * 3 + 1]! * 255)} ${Math.round(splat.colors[i * 3 + 2]! * 255)} ` +
        `${splat.sizes[i]!.toFixed(5)}`
    );
  }
  return lines.join("\n");
}
