/**
 * 가상 비석 표면 높이장 — 클라이언트 뷰어와 서버 파이프라인이 공유하는 단일 수식.
 * (동일 파라미터 → 동일 표면. Evidence/PBR/패치/스플랫/LOD 오차가 모두 이 함수 기준)
 *
 * 이 표면은 절차 생성 가상 데모이며 실제 유물 계측이 아니다.
 */
import type { GlyphCell } from "@seokmun/types";
import { hashString, mulberry32 } from "./random";

export interface SlabParams {
  width: number;
  height: number;
  depth: number;
  noiseSeed: number;
  noiseAmp: number;
  crack?: {
    from: [number, number];
    to: [number, number];
    depth: number;
    widthFrac: number;
  } | null;
  lodGrids?: Record<string, [number, number]>;
}

export interface SurfaceSample {
  /** 표면에서 파인 깊이 (모델 단위, +값이 안쪽) */
  engrave: number;
  kind: "PLAIN" | "STROKE" | "ERODED" | "CRACK";
}

export interface SurfaceField {
  sample: (u: number, v: number) => SurfaceSample;
  /** 중앙차분 기울기 → 전면 법선 (모델 단위) */
  normalAt: (u: number, v: number) => [number, number, number];
  albedoAt: (u: number, v: number, cavityStrength?: number) => [number, number, number];
}

function distToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeValueNoise(seed: number, gu: number, gv: number) {
  const cache = new Map<string, number>();
  const lattice = (ix: number, iy: number): number => {
    const key = `${ix},${iy}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = mulberry32(hashString(`${seed}:${key}`))();
      cache.set(key, v);
    }
    return v;
  };
  return (u: number, v: number): number => {
    const x = u * gu;
    const y = v * gv;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const a = lattice(ix, iy);
    const b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1);
    const d = lattice(ix + 1, iy + 1);
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return (top + (bottom - top) * fy) * 2 - 1;
  };
}

const BASE_COLOR: [number, number, number] = [0.561, 0.541, 0.49]; // #8f8a7d
const STROKE_COLOR: [number, number, number] = [0.333, 0.314, 0.247];
const CRACK_COLOR: [number, number, number] = [0.235, 0.22, 0.173];

export function makeSurfaceField(params: SlabParams, cells: GlyphCell[]): SurfaceField {
  const coarse = makeValueNoise(params.noiseSeed, 14, 40);
  // 미세 옥타브 — 석재 입자감 (가상 표면의 해상도 강화, 클로즈업 품질)
  const fine = makeValueNoise(params.noiseSeed + 7, 110, 300);
  const tint = makeValueNoise(params.noiseSeed + 13, 6, 16);

  const cellStrokes = cells
    .filter((c) => c.strokes)
    .map((c) => ({
      bbox: c.bbox2d,
      observed: c.strokes!.polylines.filter(
        (_, i) => !c.strokes!.erodedStrokeIndexes.includes(i)
      ),
      eroded: c.strokes!.polylines.filter((_, i) =>
        c.strokes!.erodedStrokeIndexes.includes(i)
      ),
    }));

  const sample = (u: number, v: number): SurfaceSample => {
    let engrave = Math.max(0, coarse(u, v)) * params.noiseAmp;
    engrave += (fine(u, v) * 0.5 + 0.5) * params.noiseAmp * 0.35;
    let kind: SurfaceSample["kind"] = "PLAIN";

    for (const cs of cellStrokes) {
      const [bx, by, bw, bh] = cs.bbox;
      if (u < bx - 0.01 || u > bx + bw + 0.01 || v < by - 0.01 || v > by + bh + 0.01) {
        continue;
      }
      const lx = ((u - bx) / bw) * 100;
      const ly = ((v - by) / bh) * 100;
      let minD = Infinity;
      let erodedD = Infinity;
      for (const line of cs.observed) {
        for (let s = 0; s + 1 < line.length; s++) {
          minD = Math.min(
            minD,
            distToSegment(lx, ly, line[s]![0], line[s]![1], line[s + 1]![0], line[s + 1]![1])
          );
        }
      }
      for (const line of cs.eroded) {
        for (let s = 0; s + 1 < line.length; s++) {
          erodedD = Math.min(
            erodedD,
            distToSegment(lx, ly, line[s]![0], line[s]![1], line[s + 1]![0], line[s + 1]![1])
          );
        }
      }
      // smoothstep 프로파일 — V형 계단 대신 부드러운 홈 벽 (5 = 홈 반폭)
      if (minD < 5) {
        engrave += 0.02 * (1 - smoothstep(0, 5, minD));
        if (minD < 3.8) kind = "STROKE";
      } else if (erodedD < 5) {
        engrave += 0.006 * (1 - smoothstep(0, 5, erodedD));
        if (erodedD < 3.8 && kind === "PLAIN") kind = "ERODED";
      }
    }

    if (params.crack) {
      const d = distToSegment(
        u, v,
        params.crack.from[0], params.crack.from[1],
        params.crack.to[0], params.crack.to[1]
      );
      if (d < params.crack.widthFrac) {
        engrave += params.crack.depth * (1 - smoothstep(0, params.crack.widthFrac, d));
        if (d < params.crack.widthFrac * 0.7) kind = "CRACK";
      }
    }
    return { engrave, kind };
  };

  const normalAt = (u: number, v: number): [number, number, number] => {
    const eps = 0.0015;
    const hL = sample(Math.max(0, u - eps), v).engrave;
    const hR = sample(Math.min(1, u + eps), v).engrave;
    const hU = sample(u, Math.max(0, v - eps)).engrave;
    const hD = sample(u, Math.min(1, v + eps)).engrave;
    // z = depth/2 - engrave(u,v); x = (u-0.5)*width; y = (0.5-v)*height
    const dzdx = -(hR - hL) / (2 * eps * params.width);
    const dzdy = (hD - hU) / (2 * eps * params.height);
    const len = Math.hypot(dzdx, dzdy, 1);
    return [-dzdx / len, -dzdy / len, 1 / len];
  };

  const albedoAt = (
    u: number,
    v: number,
    cavityStrength = 0.6
  ): [number, number, number] => {
    const s = sample(u, v);
    let base: [number, number, number];
    if (s.kind === "CRACK") base = CRACK_COLOR;
    else if (s.kind === "STROKE") base = STROKE_COLOR;
    else base = BASE_COLOR;
    // 색 변조 — 풍화 얼룩(저주파) + 입자(고주파)
    const t = tint(u, v) * 0.06 + fine(u, v) * 0.035;
    // cavity: 파인 깊이에 비례해 어둡게 (강도 조절 가능, 연구 모드 약함)
    const cav = 1 - Math.min(0.5, (s.engrave / 0.03) * 0.35 * cavityStrength);
    return [
      Math.max(0, Math.min(1, (base[0] + t) * cav)),
      Math.max(0, Math.min(1, (base[1] + t * 0.9) * cav)),
      Math.max(0, Math.min(1, (base[2] + t * 0.7) * cav)),
    ];
  };

  return { sample, normalAt, albedoAt };
}

/** LOD 격자 이산화 오차 — 밀집 샘플 대비 저해상 격자 이중선형 보간의 높이 오차 (모델 단위) */
export function lodSurfaceError(
  params: SlabParams,
  cells: GlyphCell[],
  grid: [number, number],
  denseSamples = 8000
): { p95: number; max: number; mean: number } {
  const field = makeSurfaceField(params, cells);
  const [gx, gy] = grid;
  const lowGrid: number[][] = [];
  for (let iy = 0; iy <= gy; iy++) {
    const row: number[] = [];
    for (let ix = 0; ix <= gx; ix++) {
      row.push(field.sample(ix / gx, iy / gy).engrave);
    }
    lowGrid.push(row);
  }
  const interp = (u: number, v: number): number => {
    const x = u * gx;
    const y = v * gy;
    const ix = Math.min(gx - 1, Math.floor(x));
    const iy = Math.min(gy - 1, Math.floor(y));
    const fx = x - ix;
    const fy = y - iy;
    const a = lowGrid[iy]![ix]!;
    const b = lowGrid[iy]![ix + 1]!;
    const c = lowGrid[iy + 1]![ix]!;
    const d = lowGrid[iy + 1]![ix + 1]!;
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };
  const rand = mulberry32(hashString(`lod-error-${params.noiseSeed}-${gx}x${gy}`));
  const errors: number[] = [];
  let sum = 0;
  let max = 0;
  for (let i = 0; i < denseSamples; i++) {
    const u = rand();
    const v = rand();
    const e = Math.abs(field.sample(u, v).engrave - interp(u, v));
    errors.push(e);
    sum += e;
    if (e > max) max = e;
  }
  errors.sort((a, b) => a - b);
  const p95 = errors[Math.floor(errors.length * 0.95)]!;
  return {
    p95: Math.round(p95 * 1e6) / 1e6,
    max: Math.round(max * 1e6) / 1e6,
    mean: Math.round((sum / denseSamples) * 1e6) / 1e6,
  };
}
