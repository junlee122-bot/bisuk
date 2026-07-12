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
 * 획 집합 유사도.
 * observed 쪽 획이 얼마나 설명되는가(0.7)와 후보 자형의 획이
 * 얼마나 관측되는가(0.3)를 함께 반영한다. 매칭은 거리 오름차순
 * 탐욕 배정이라 획 배열 순서와 무관하게 결정적이다.
 */
export function strokeSetSimilarity(
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
