import type { GlyphStrokes } from "@seokmun/types";
import { hashString, mulberry32 } from "./random";

export type Polyline = Array<[number, number]>;

/** 마모(eroded) 획을 제외한 관측 가능한 획 목록 */
export function observedPolylines(strokes: GlyphStrokes): Polyline[] {
  const eroded = new Set(strokes.erodedStrokeIndexes ?? []);
  return strokes.polylines.filter((_, i) => !eroded.has(i));
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * 두 획의 근사 일치 여부 — 양 끝점이 허용 오차 안에 있으면 일치.
 * 서체 변형(styleJitter)까지 흡수할 수 있도록 기본 허용 오차 10.
 */
export function strokesMatch(a: Polyline, b: Polyline, tol = 10): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const a0 = a[0]!,
    a1 = a[a.length - 1]!;
  const b0 = b[0]!,
    b1 = b[b.length - 1]!;
  const forward = dist(a0, b0) <= tol && dist(a1, b1) <= tol;
  const reverse = dist(a0, b1) <= tol && dist(a1, b0) <= tol;
  return forward || reverse;
}

/** 두 획의 매칭 거리 — 양 끝점 거리의 최대값(정/역방향 중 작은 쪽) */
function strokeMatchDistance(a: Polyline, b: Polyline): number {
  if (a.length < 2 || b.length < 2) return Infinity;
  const a0 = a[0]!,
    a1 = a[a.length - 1]!;
  const b0 = b[0]!,
    b1 = b[b.length - 1]!;
  const forward = Math.max(dist(a0, b0), dist(a1, b1));
  const reverse = Math.max(dist(a0, b1), dist(a1, b0));
  return Math.min(forward, reverse);
}

/**
 * (v1, 보존용) 획 집합 유사도 — 양 끝점 허용 오차 매칭.
 * observed 쪽 획이 얼마나 설명되는가(0.7)와 후보 자형의 획이
 * 얼마나 관측되는가(0.3)를 함께 반영한다. 매칭은 거리 오름차순
 * 탐욕 배정이라 획 배열 순서와 무관하게 결정적이다.
 */
export function strokeSetSimilarityLegacy(
  observed: Polyline[],
  reference: Polyline[],
  tol = 10
): number {
  if (observed.length === 0 || reference.length === 0) return 0;
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < observed.length; i++) {
    for (let j = 0; j < reference.length; j++) {
      const d = strokeMatchDistance(observed[i]!, reference[j]!);
      if (d <= tol) pairs.push([d, i, j]);
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const usedObs = new Set<number>();
  const usedRef = new Set<number>();
  for (const [, i, j] of pairs) {
    if (usedObs.has(i) || usedRef.has(j)) continue;
    usedObs.add(i);
    usedRef.add(j);
  }
  const observedRatio = usedObs.size / observed.length;
  const referenceRatio = usedRef.size / reference.length;
  return observedRatio * 0.7 + referenceRatio * 0.3;
}

/** v2 유사도 파라미터 — 0~100 좌표계 기준 */
export const SIMILARITY_V2 = {
  /** 획을 호 길이 기준으로 재표본화할 점 수 */
  resamplePoints: 12,
  /** 평균 거리가 이 값 이하이면 획 점수 1 (손 추적 오차 흡수) */
  fullScoreDistance: 4,
  /** 평균 거리가 이 값 이상이면 획 점수 0 */
  zeroScoreDistance: 14,
  /** 참조 획의 점이 관측 획에서 이 거리 안이면 '덮였다'고 본다 */
  coverageRadius: 8,
  /** 위치 맞춤(정합) 탐색 이동량 */
  registrationShifts: [-5, 0, 5] as readonly number[],
  /** 이동 1단위당 감점 — 정합 없이 맞는 경우를 우선 */
  shiftPenaltyPerUnit: 0.004,
} as const;

/** 호 길이 기준 균등 재표본화 */
export function resamplePolyline(line: Polyline, n: number): Polyline {
  if (line.length === 0) return [];
  if (line.length === 1) return Array.from({ length: n }, () => [...line[0]!] as [number, number]);
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const l = dist(line[i - 1]!, line[i]!);
    segLens.push(l);
    total += l;
  }
  if (total === 0) return Array.from({ length: n }, () => [...line[0]!] as [number, number]);
  const out: Polyline = [];
  let seg = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < segLens.length - 1 && acc + segLens[seg]! < target) {
      acc += segLens[seg]!;
      seg++;
    }
    const a = line[seg]!;
    const b = line[seg + 1]!;
    const t = segLens[seg]! > 0 ? Math.min(1, Math.max(0, (target - acc) / segLens[seg]!)) : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function pointSegmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function pointPolylineDistance(p: [number, number], line: Polyline): number {
  if (line.length === 1) return dist(p, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointSegmentDistance(p, line[i - 1]!, line[i]!);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 두 획의 v2 비교 — 관측 획(재표본화)의 각 점에서 참조 획까지의 평균 거리(방향성)와
 * 참조 획이 관측 획에 덮인 비율. 획 조각(부분 관측)도 참조 획 위에 있으면 거리 0이 된다.
 */
export function strokeComparisonV2(
  observed: Polyline,
  reference: Polyline
): { meanDistance: number; coverage: number; score: number } {
  const n = SIMILARITY_V2.resamplePoints;
  if (observed.length === 0 || reference.length === 0) return { meanDistance: Infinity, coverage: 0, score: 0 };
  const obsPts = resamplePolyline(observed, n);
  const refPts = resamplePolyline(reference, n);
  let sum = 0;
  for (const p of obsPts) sum += pointPolylineDistance(p, reference);
  const meanDistance = sum / obsPts.length;
  let covered = 0;
  for (const p of refPts) if (pointPolylineDistance(p, observed) <= SIMILARITY_V2.coverageRadius) covered++;
  const coverage = covered / refPts.length;
  const { fullScoreDistance: lo, zeroScoreDistance: hi } = SIMILARITY_V2;
  const score = meanDistance <= lo ? 1 : meanDistance >= hi ? 0 : 1 - (meanDistance - lo) / (hi - lo);
  return { meanDistance, coverage, score };
}

function shiftPolylines(lines: Polyline[], dx: number, dy: number): Polyline[] {
  if (dx === 0 && dy === 0) return lines;
  return lines.map((l) => l.map(([x, y]) => [x + dx, y + dy] as [number, number]));
}

function similarityAt(observed: Polyline[], reference: Polyline[]): number {
  const pairs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < observed.length; i++) {
    for (let j = 0; j < reference.length; j++) {
      const c = strokeComparisonV2(observed[i]!, reference[j]!);
      if (c.score > 0) pairs.push([c.score, c.coverage, i, j]);
    }
  }
  // 점수 내림차순 탐욕 1:1 배정 — 동점은 인덱스 순서로 결정적
  pairs.sort((p, q) => q[0] - p[0] || q[1] - p[1] || p[2] - q[2] || p[3] - q[3]);
  const usedObs = new Set<number>();
  const usedRef = new Set<number>();
  let obsSum = 0;
  let refSum = 0;
  for (const [score, coverage, i, j] of pairs) {
    if (usedObs.has(i) || usedRef.has(j)) continue;
    usedObs.add(i);
    usedRef.add(j);
    obsSum += score;
    refSum += score * coverage;
  }
  return (obsSum / observed.length) * 0.7 + (refSum / reference.length) * 0.3;
}

/**
 * 획 집합 유사도 (v2).
 * - 끝점만이 아니라 재표본화한 획 전체의 모양을 비교한다 (끝점이 같은 곡선·꺾임 구분).
 * - 관측 획 → 참조 획 방향 거리라 부분 관측된 획 조각도 맞출 수 있다.
 * - 참조 획의 덮인 비율로 '후보 자형이 얼마나 관측되는가'를 잰다.
 * - 작은 위치 이동(정합)을 탐색해 셀 경계 지정 오차를 흡수하고, 이동량만큼 감점한다.
 * 가중치는 v1과 같다: 관측 설명 0.7, 참조 관측 0.3.
 */
export function strokeSetSimilarity(observed: Polyline[], reference: Polyline[]): number {
  if (observed.length === 0 || reference.length === 0) return 0;
  let best = 0;
  for (const dx of SIMILARITY_V2.registrationShifts) {
    for (const dy of SIMILARITY_V2.registrationShifts) {
      const penalty = SIMILARITY_V2.shiftPenaltyPerUnit * Math.hypot(dx, dy);
      const s = similarityAt(shiftPolylines(observed, dx, dy), reference) - penalty;
      if (s > best) best = s;
    }
  }
  return Math.max(0, Math.min(1, best));
}

/** 여러 표본(자형 참조 + 연구실 등록 표본) 중 최고 유사도와 그 표본 번호 */
export function bestExemplarSimilarity(
  observed: Polyline[],
  exemplars: Polyline[][]
): { score: number; index: number } {
  let score = 0;
  let index = -1;
  exemplars.forEach((ex, i) => {
    const s = strokeSetSimilarity(observed, ex);
    if (s > score) {
      score = s;
      index = i;
    }
  });
  return { score, index };
}

/** 방향 히스토그램 기반 9차원 특징 벡터 (교차 비석 거친 유사도용) */
export function featureVector(polylines: Polyline[]): number[] {
  if (polylines.length === 0) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  const hist = [0, 0, 0, 0];
  let cx = 0,
    cy = 0,
    n = 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const line of polylines) {
    for (let i = 0; i < line.length; i++) {
      const p = line[i]!;
      cx += p[0];
      cy += p[1];
      n++;
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
      if (i === 0) continue;
      const q = line[i - 1]!;
      const dx = p[0] - q[0];
      const dy = p[1] - q[1];
      const len = Math.hypot(dx, dy);
      total += len;
      if (Math.abs(dx) >= 2 * Math.abs(dy)) hist[0] = hist[0]! + len;
      else if (Math.abs(dy) >= 2 * Math.abs(dx)) hist[1] = hist[1]! + len;
      else if (dx * dy > 0) hist[2] = hist[2]! + len;
      else hist[3] = hist[3]! + len;
    }
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return [
    Math.min(1, polylines.length / 15),
    Math.min(1, total / 600),
    total > 0 ? hist[0]! / total : 0,
    total > 0 ? hist[1]! / total : 0,
    total > 0 ? hist[2]! / total : 0,
    total > 0 ? hist[3]! / total : 0,
    n > 0 ? cx / n / 100 : 0,
    n > 0 ? cy / n / 100 : 0,
    h / (w + h),
  ];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * 서체 변형 시뮬레이션 — 셀 ID에 결정적으로 종속된 소폭 오프셋.
 * 크기는 jitter 이하로 유지되어 허용 오차 10 매칭을 깨지 않는다.
 */
export function jitterPolylines(
  polylines: Polyline[],
  jitter: number,
  seedKey: string
): Polyline[] {
  if (!jitter) return polylines.map((l) => l.map((p) => [...p] as [number, number]));
  const rand = mulberry32(hashString(seedKey));
  return polylines.map((line) =>
    line.map((p) => {
      const dx = (rand() * 2 - 1) * jitter;
      const dy = (rand() * 2 - 1) * jitter;
      return [
        Math.max(0, Math.min(100, p[0] + dx)),
        Math.max(0, Math.min(100, p[1] + dy)),
      ] as [number, number];
    })
  );
}

/** SVG path 문자열 생성 (0-100 좌표계) */
export function polylinesToSvgPath(polylines: Polyline[]): string {
  return polylines
    .map((line) => {
      if (line.length === 0) return "";
      const [first, ...rest] = line;
      return (
        `M ${first![0].toFixed(1)} ${first![1].toFixed(1)} ` +
        rest.map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")
      );
    })
    .filter(Boolean)
    .join(" ");
}
