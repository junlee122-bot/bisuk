import type {
  DecisionGateInput,
  DecisionGateResult,
  DecisionOutcome,
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
  passed: (i: DecisionGateInput) => boolean;
}

const RULES: Rule[] = [
  {
    name: "calibrated_confidence",
    expected: `>= ${GATE_THRESHOLDS.minCalibratedConfidence}`,
    actual: (i) => i.calibratedConfidence.toFixed(3),
    passed: (i) =>
      i.calibratedConfidence >= GATE_THRESHOLDS.minCalibratedConfidence,
  },
  {
    name: "margin_to_second_candidate",
    expected: `>= ${GATE_THRESHOLDS.minMarginToSecond}`,
    actual: (i) => i.marginToSecondCandidate.toFixed(3),
    passed: (i) =>
      i.marginToSecondCandidate >= GATE_THRESHOLDS.minMarginToSecond,
  },
  {
    name: "verified_primary_or_direct_source_count",
    expected: `>= ${GATE_THRESHOLDS.minVerifiedPrimaryOrDirectSources}`,
    actual: (i) => String(i.verifiedPrimaryOrDirectSourceCount),
    passed: (i) =>
      i.verifiedPrimaryOrDirectSourceCount >=
      GATE_THRESHOLDS.minVerifiedPrimaryOrDirectSources,
  },
  {
    name: "independent_lineage_count",
    expected: `>= ${GATE_THRESHOLDS.minIndependentLineages}`,
    actual: (i) => String(i.independentLineageCount),
    passed: (i) =>
      i.independentLineageCount >= GATE_THRESHOLDS.minIndependentLineages,
  },
  {
    name: "strong_visual_contradiction",
    expected: "false",
    actual: (i) => String(i.strongVisualContradiction),
    passed: (i) => !i.strongVisualContradiction,
  },
  {
    name: "strong_chronology_contradiction",
    expected: "false",
    actual: (i) => String(i.strongChronologyContradiction),
    passed: (i) => !i.strongChronologyContradiction,
  },
  {
    name: "citation_verified",
    expected: "true",
    actual: (i) => String(i.citationVerified),
    passed: (i) => i.citationVerified,
  },
  {
    name: "benchmark_leakage",
    expected: "false",
    actual: (i) => String(i.benchmarkLeakage),
    passed: (i) => !i.benchmarkLeakage,
  },
];

/**
 * Decision Gate — 조건을 모두 충족할 때만 자동 채택.
 * 실패 시 CONFLICTING / TEXTUAL_SUPPLEMENT / UNKNOWN / ILLEGIBLE 중 하나로 남긴다.
 */
export function runDecisionGate(
  input: DecisionGateInput,
  opts?: { topCandidateVisualScore?: number }
): DecisionGateResult {
  const ruleTrace = RULES.map((r) => ({
    rule: r.name,
    expected: r.expected,
    actual: r.actual(input),
    passed: r.passed(input),
  }));
  const failedRules = ruleTrace.filter((r) => !r.passed).map((r) => r.rule);
  const passed = failedRules.length === 0;

  let outcome: DecisionOutcome;
  if (passed) {
    outcome = "AUTO_ACCEPTED";
  } else if (input.hasCompetingCandidateWithEvidence) {
    outcome = "CONFLICTING";
  } else if (
    input.observabilityScore < GATE_THRESHOLDS.illegibleObservabilityBelow
  ) {
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

  return { outcome, passed, failedRules, ruleTrace };
}
