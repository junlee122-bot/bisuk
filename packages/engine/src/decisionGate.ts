import type {
  DecisionGateInput,
  DecisionGateResult,
  DecisionOutcome,
  RuleStatus,
} from "@seokmun/types";

/** PRD §14.4 초기 자동 채택 조건 */
export const GATE_THRESHOLDS = {
  minCalibratedConfidence: 0.85,
  minMarginToSecond: 0.15,
  minVerifiedPrimaryOrDirectSources: 1,
  minIndependentLineages: 2,
  illegibleObservabilityBelow: 0.15,
} as const;

interface Rule {
  name: string;
  expected: string;
  actual: (i: DecisionGateInput) => string;
  /** PASS/FAIL/NOT_EVALUATED */
  status: (i: DecisionGateInput) => RuleStatus;
  /**
   * 미평가일 때 자동 채택을 막는가.
   * 연대 증거처럼 연구실 데이터가 없으면 영원히 평가할 수 없는 규칙은 막지 않되,
   * 미평가 사실을 추적표에 그대로 남긴다.
   */
  blocksWhenNotEvaluated: boolean;
}

const pf = (ok: boolean): RuleStatus => (ok ? "PASS" : "FAIL");

const RULES: Rule[] = [
  {
    name: "calibrated_confidence",
    expected: `>= ${GATE_THRESHOLDS.minCalibratedConfidence}`,
    actual: (i) => i.calibratedConfidence.toFixed(3),
    status: (i) => pf(i.calibratedConfidence >= GATE_THRESHOLDS.minCalibratedConfidence),
    blocksWhenNotEvaluated: true,
  },
  {
    name: "margin_to_second_candidate",
    expected: `>= ${GATE_THRESHOLDS.minMarginToSecond}`,
    actual: (i) => i.marginToSecondCandidate.toFixed(3),
    status: (i) => pf(i.marginToSecondCandidate >= GATE_THRESHOLDS.minMarginToSecond),
    blocksWhenNotEvaluated: true,
  },
  {
    name: "verified_primary_or_direct_source_count",
    expected: `>= ${GATE_THRESHOLDS.minVerifiedPrimaryOrDirectSources}`,
    actual: (i) => String(i.verifiedPrimaryOrDirectSourceCount),
    status: (i) =>
      pf(i.verifiedPrimaryOrDirectSourceCount >= GATE_THRESHOLDS.minVerifiedPrimaryOrDirectSources),
    blocksWhenNotEvaluated: true,
  },
  {
    name: "independent_lineage_count",
    expected: `>= ${GATE_THRESHOLDS.minIndependentLineages}`,
    actual: (i) => String(i.independentLineageCount),
    status: (i) => pf(i.independentLineageCount >= GATE_THRESHOLDS.minIndependentLineages),
    blocksWhenNotEvaluated: true,
  },
  {
    name: "strong_visual_contradiction",
    expected: "false",
    actual: (i) => String(i.strongVisualContradiction),
    status: (i) => pf(!i.strongVisualContradiction),
    blocksWhenNotEvaluated: true,
  },
  {
    name: "strong_chronology_contradiction",
    expected: "false",
    actual: (i) => (i.chronologyEvaluated ? String(i.strongChronologyContradiction) : "연대 증거 없음"),
    status: (i) => (i.chronologyEvaluated ? pf(!i.strongChronologyContradiction) : "NOT_EVALUATED"),
    blocksWhenNotEvaluated: false,
  },
  {
    name: "citation_verified",
    expected: "true",
    actual: (i) => String(i.citationVerified),
    status: (i) => pf(i.citationVerified),
    blocksWhenNotEvaluated: true,
  },
  {
    name: "benchmark_leakage",
    expected: "false",
    actual: (i) => (i.benchmarkLeakageEvaluated === false ? "검사 안 함" : String(i.benchmarkLeakage)),
    status: (i) => (i.benchmarkLeakageEvaluated === false ? "NOT_EVALUATED" : pf(!i.benchmarkLeakage)),
    blocksWhenNotEvaluated: true,
  },
  {
    name: "counter_evidence_not_dominant",
    expected: "반대 계보 < 지지 계보",
    actual: (i) =>
      i.counterEvidenceDominant === undefined ? "미평가" : i.counterEvidenceDominant ? "반대 우세·동수" : "지지 우세",
    status: (i) => (i.counterEvidenceDominant === undefined ? "NOT_EVALUATED" : pf(!i.counterEvidenceDominant)),
    blocksWhenNotEvaluated: false,
  },
  {
    name: "calibration_available",
    expected: "평가셋 적합 보정",
    actual: (i) =>
      i.calibrationKind === "FITTED"
        ? "적합 보정"
        : i.calibrationKind === "DEMO_HEURISTIC"
          ? "데모 휴리스틱 (보정 아님)"
          : i.calibrationKind === "UNCALIBRATED"
            ? "보정 없음"
            : "미평가",
    status: (i) =>
      i.calibrationKind === "FITTED"
        ? "PASS"
        : i.calibrationKind === "UNCALIBRATED"
          ? "FAIL"
          : "NOT_EVALUATED",
    blocksWhenNotEvaluated: false,
  },
];

export const GATE_RULE_NAMES = RULES.map((r) => r.name);

/**
 * Decision Gate — 조건을 모두 충족할 때만 자동 채택.
 * 실패 시 CONFLICTING / TEXTUAL_SUPPLEMENT / UNKNOWN / ILLEGIBLE 중 하나로 남긴다.
 * 규칙마다 PASS/FAIL/NOT_EVALUATED 상태를 남기며, 미평가는 '통과'로 표시하지 않는다.
 */
export function runDecisionGate(
  input: DecisionGateInput,
  opts?: { topCandidateVisualScore?: number }
): DecisionGateResult {
  const evaluated = RULES.map((r) => ({ rule: r, status: r.status(input) }));
  const ruleTrace = evaluated.map(({ rule, status }) => ({
    rule: rule.name,
    expected: rule.expected,
    actual: rule.actual(input),
    passed: status === "PASS",
    status,
  }));
  const failedRules = evaluated.filter((e) => e.status === "FAIL").map((e) => e.rule.name);
  const blockingUnevaluated = evaluated.filter(
    (e) => e.status === "NOT_EVALUATED" && e.rule.blocksWhenNotEvaluated
  );
  const passed = failedRules.length === 0 && blockingUnevaluated.length === 0;

  let outcome: DecisionOutcome;
  if (passed) {
    outcome = "AUTO_ACCEPTED";
  } else if (input.hasCompetingCandidateWithEvidence) {
    outcome = "CONFLICTING";
  } else if (input.observabilityScore < GATE_THRESHOLDS.illegibleObservabilityBelow) {
    outcome = "ILLEGIBLE";
  } else if (
    (opts?.topCandidateVisualScore ?? 1) < 0.35 &&
    input.independentLineageCount >= 1 &&
    input.citationVerified
  ) {
    outcome = "TEXTUAL_SUPPLEMENT";
  } else {
    outcome = "UNKNOWN";
  }

  const calibration = input.calibrationKind ? { kind: input.calibrationKind, profileId: null, n: null } : undefined;
  return { outcome, passed, failedRules, ruleTrace, ...(calibration ? { calibration } : {}) };
}
