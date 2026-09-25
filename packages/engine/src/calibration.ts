/**
 * 신뢰도 보정·평가 통계.
 * - 등위 회귀(isotonic, PAV)와 Platt(로지스틱) 보정 적합
 * - 기대 보정 오차(ECE), 신뢰도 구간표
 * - 비율의 Wilson 신뢰구간 (표본이 작을 때 '0%' 같은 점추정을 그대로 믿지 않도록)
 * 표본이 MIN_CALIBRATION_CASES 미만이면 적합을 거부한다.
 */
import type { CalibrationProfile } from "@seokmun/types";

export const MIN_CALIBRATION_CASES = 30;

export interface LabeledScore {
  /** 보정 전 점수 (0~1) */
  score: number;
  /** 1 = 1위 후보가 정답, 0 = 오답 */
  label: 0 | 1;
}

export class CalibrationSampleTooSmallError extends Error {
  constructor(readonly n: number) {
    super(`보정 적합에는 최소 ${MIN_CALIBRATION_CASES}건의 평가 사례가 필요합니다 (현재 ${n}건)`);
  }
}

/** 등위 회귀 — Pool Adjacent Violators. 반환: [[점수 상한, 보정값], ...] 오름차순 */
export function fitIsotonic(points: LabeledScore[]): number[][] {
  const sorted = [...points].sort((a, b) => a.score - b.score);
  const blocks: Array<{ sum: number; n: number; max: number }> = [];
  for (const p of sorted) {
    blocks.push({ sum: p.label, n: 1, max: p.score });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n, max: b.max });
    }
  }
  return blocks.map((b) => [b.max, Math.round((b.sum / b.n) * 10000) / 10000]);
}

/** Platt 보정 — p = 1/(1+exp(a*s+b)), 뉴턴법 (Platt 2000의 목표값 평활 포함) */
export function fitPlatt(points: LabeledScore[]): [number, number] {
  const pos = points.filter((p) => p.label === 1).length;
  const neg = points.length - pos;
  const hi = (pos + 1) / (pos + 2);
  const lo = 1 / (neg + 2);
  const t = points.map((p) => (p.label === 1 ? hi : lo));
  let a = 0;
  let b = Math.log((neg + 1) / (pos + 1));
  for (let iter = 0; iter < 100; iter++) {
    let g1 = 0, g2 = 0, h11 = 1e-12, h22 = 1e-12, h21 = 0;
    points.forEach((p, i) => {
      const f = a * p.score + b;
      const q = f >= 0 ? Math.exp(-f) / (1 + Math.exp(-f)) : 1 / (1 + Math.exp(f));
      const d1 = t[i]! - q;
      const d2 = q * (1 - q);
      g1 += p.score * d1;
      g2 += d1;
      h11 += p.score * p.score * d2;
      h22 += d2;
      h21 += p.score * d2;
    });
    const det = h11 * h22 - h21 * h21;
    if (Math.abs(det) < 1e-15) break;
    const da = -(h22 * g1 - h21 * g2) / det;
    const db = -(-h21 * g1 + h11 * g2) / det;
    a += da;
    b += db;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
  }
  return [a, b];
}

export function applyCalibration(profile: Pick<CalibrationProfile, "method" | "params">, raw: number): number {
  if (profile.method === "PLATT") {
    const [a, b] = [profile.params[0]?.[0] ?? 0, profile.params[0]?.[1] ?? 0];
    return 1 / (1 + Math.exp(a * raw + b));
  }
  const steps = profile.params;
  if (steps.length === 0) return raw;
  for (const [upper, value] of steps) if (raw <= upper!) return value!;
  return steps[steps.length - 1]![1]!;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  n: number;
  meanConfidence: number;
  accuracy: number;
}

export function reliabilityBins(preds: Array<{ p: number; y: 0 | 1 }>, bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let k = 0; k < bins; k++) {
    const lower = k / bins;
    const upper = (k + 1) / bins;
    const inBin = preds.filter((x) => (k === bins - 1 ? x.p >= lower && x.p <= upper : x.p >= lower && x.p < upper));
    out.push({
      lower,
      upper,
      n: inBin.length,
      meanConfidence: inBin.length ? inBin.reduce((s, x) => s + x.p, 0) / inBin.length : 0,
      accuracy: inBin.length ? inBin.reduce((s, x) => s + x.y, 0) / inBin.length : 0,
    });
  }
  return out;
}

/** 기대 보정 오차 (Expected Calibration Error) */
export function expectedCalibrationError(preds: Array<{ p: number; y: 0 | 1 }>, bins = 10): number {
  if (preds.length === 0) return 0;
  const total = preds.length;
  return reliabilityBins(preds, bins).reduce(
    (s, b) => s + (b.n / total) * Math.abs(b.accuracy - b.meanConfidence),
    0
  );
}

/** 비율의 Wilson 점수 신뢰구간 (기본 95%) */
export function wilsonInterval(k: number, n: number, z = 1.96): { point: number; lower: number; upper: number } {
  if (n === 0) return { point: 0, lower: 0, upper: 1 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { point: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

export function fitCalibrationProfile(
  points: LabeledScore[],
  method: CalibrationProfile["method"],
  meta: { id: string; fittedBy: string; fittedAt: string; note?: string }
): CalibrationProfile {
  if (points.length < MIN_CALIBRATION_CASES) throw new CalibrationSampleTooSmallError(points.length);
  const params = method === "PLATT" ? [fitPlatt(points)] : fitIsotonic(points);
  const profile = { method, params };
  const ece = expectedCalibrationError(points.map((p) => ({ p: applyCalibration(profile, p.score), y: p.label })));
  return {
    id: meta.id,
    method,
    n: points.length,
    ece: Math.round(ece * 10000) / 10000,
    params,
    fittedAt: meta.fittedAt,
    fittedBy: meta.fittedBy,
    note: meta.note ?? "",
  };
}

export interface EvaluationCase {
  caseId: string;
  /** 정답 출처 — 벤치마크 숨김 정답 / 사람이 채택한 판독 */
  truthSource: "BENCHMARK" | "ADOPTED_READING";
  truth: string;
  outcome: string;
  topCandidate: string | null;
  /** 1위 후보 보정 전 점수 */
  rawScore: number;
  /** 게이트에 들어간 (보정) 신뢰도 */
  confidence: number;
}

export interface EvaluationSummary {
  n: number;
  bySource: Record<string, number>;
  top1Accuracy: ReturnType<typeof wilsonInterval>;
  autoAccepted: number;
  /** 자동 확정 중 오답 비율 — 표본이 작으면 구간이 넓다 */
  falseAutoAcceptRate: ReturnType<typeof wilsonInterval>;
  /** 자동 확정된 비율 */
  coverage: ReturnType<typeof wilsonInterval>;
  ece: number;
  reliability: ReliabilityBin[];
  sufficientForCalibration: boolean;
  warnings: string[];
}

export function summarizeEvaluation(cases: EvaluationCase[]): EvaluationSummary {
  const n = cases.length;
  const bySource: Record<string, number> = {};
  for (const c of cases) bySource[c.truthSource] = (bySource[c.truthSource] ?? 0) + 1;
  const correct = cases.filter((c) => c.topCandidate === c.truth).length;
  const auto = cases.filter((c) => c.outcome === "AUTO_ACCEPTED");
  const autoWrong = auto.filter((c) => c.topCandidate !== c.truth).length;
  const preds = cases.map((c) => ({ p: c.confidence, y: (c.topCandidate === c.truth ? 1 : 0) as 0 | 1 }));
  const warnings: string[] = [];
  if (n < MIN_CALIBRATION_CASES) {
    warnings.push(
      `평가 사례 ${n}건 — 보정·오류율 추정에 최소 ${MIN_CALIBRATION_CASES}건이 필요합니다. 아래 비율은 신뢰구간과 함께 읽으십시오.`
    );
  }
  if (auto.length === 0) warnings.push("자동 확정 사례가 없어 오확정률을 추정할 수 없습니다.");
  if ((bySource["BENCHMARK"] ?? 0) === n && n > 0) {
    warnings.push("모든 사례가 합성 벤치마크입니다 — 실제 판독 성능을 뜻하지 않습니다.");
  }
  return {
    n,
    bySource,
    top1Accuracy: wilsonInterval(correct, n),
    autoAccepted: auto.length,
    falseAutoAcceptRate: wilsonInterval(autoWrong, auto.length),
    coverage: wilsonInterval(auto.length, n),
    ece: Math.round(expectedCalibrationError(preds) * 10000) / 10000,
    reliability: reliabilityBins(preds),
    sufficientForCalibration: n >= MIN_CALIBRATION_CASES,
    warnings,
  };
}
