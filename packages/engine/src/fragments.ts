/**
 * 가상 비석 조각 접합 — 파단면 곡선 정합 점수.
 * 실제 유물 데이터가 없을 때 가상 조각으로 접합 흐름을 시뮬레이션한다.
 */
export type BreakCurve = Array<[number, number]>;

function sampleCurve(curve: BreakCurve, x: number): number {
  if (curve.length === 0) return 0;
  if (x <= curve[0]![0]) return curve[0]![1];
  const last = curve[curve.length - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 0; i + 1 < curve.length; i++) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    if (x >= a[0] && x <= b[0]) {
      const t = (x - a[0]) / Math.max(1e-9, b[0] - a[0]);
      return a[1] + t * (b[1] - a[1]);
    }
  }
  return last[1];
}

export interface JoinResult {
  meanGap: number;
  /** 파단면이 겹치는(간섭) 샘플 비율 */
  interferenceRatio: number;
  joinConfidence: number;
}

/**
 * offset: 조각 B를 조각 A 쪽으로 이동시킨 수직 오프셋(0이면 완전 접합 위치).
 * 두 곡선이 동일할 때 offset 0에서 gap 0, confidence 1에 수렴한다.
 */
export function evaluateJoin(
  curveA: BreakCurve,
  curveB: BreakCurve,
  offset: number,
  samples = 50
): JoinResult {
  samples = Math.max(2, Math.floor(samples));
  let sum = 0;
  let interference = 0;
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    const ya = sampleCurve(curveA, x);
    const yb = sampleCurve(curveB, x) + offset;
    const gap = yb - ya;
    sum += Math.abs(gap);
    if (gap < -0.005) interference++;
  }
  const meanGap = sum / samples;
  const interferenceRatio = interference / samples;
  const joinConfidence =
    Math.exp(-8 * meanGap) * (1 - Math.min(1, interferenceRatio * 2));
  return {
    meanGap: Math.round(meanGap * 10000) / 10000,
    interferenceRatio: Math.round(interferenceRatio * 1000) / 1000,
    joinConfidence: Math.round(joinConfidence * 1000) / 1000,
  };
}

/**
 * 최적 접합 오프셋 탐색 — 거친 격자 후 황금분할로 좁혀 joinConfidence 최대 위치를 찾는다.
 * 사용자가 슬라이더로 맞추기 전에 자동 제안값으로 쓴다.
 */
export function optimizeJoinOffset(
  curveA: BreakCurve,
  curveB: BreakCurve,
  range: [number, number] = [-0.5, 0.5],
  samples = 50
): { offset: number; result: JoinResult } {
  const score = (o: number) => {
    const r = evaluateJoin(curveA, curveB, o, samples);
    // 동점일 때 간격이 작은 쪽
    return r.joinConfidence - r.meanGap * 1e-3;
  };
  const steps = 40;
  let best = range[0];
  let bestScore = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const o = range[0] + ((range[1] - range[0]) * i) / steps;
    const s = score(o);
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  const h = (range[1] - range[0]) / steps;
  let lo = Math.max(range[0], best - h);
  let hi = Math.min(range[1], best + h);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const m1 = hi - g * (hi - lo);
    const m2 = lo + g * (hi - lo);
    if (score(m1) >= score(m2)) hi = m2;
    else lo = m1;
  }
  const offset = Math.round(((lo + hi) / 2) * 10000) / 10000;
  return { offset, result: evaluateJoin(curveA, curveB, offset, samples) };
}
