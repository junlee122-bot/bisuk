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
