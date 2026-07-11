import type { FrontierSignals, MaturityScores } from "@seokmun/types";

/** PRD §4.2 — 연구 성숙도 종합 점수 (0~100). 진실성 점수가 아니다. */
export const MATURITY_WEIGHTS: Record<keyof MaturityScores, number> = {
  sourceScore: 0.15,
  geometryScore: 0.1,
  imageScore: 0.1,
  transcriptionScore: 0.15,
  bibliographyScore: 0.15,
  independentTeamScore: 0.1,
  chronologyConsensusScore: 0.08,
  purposeConsensusScore: 0.07,
  openDataScore: 0.05,
  rightsClarityScore: 0.05,
};

export function computeMaturityScore(scores: MaturityScores): number {
  let total = 0;
  for (const key of Object.keys(MATURITY_WEIGHTS) as Array<keyof MaturityScores>) {
    total += MATURITY_WEIGHTS[key] * scores[key];
  }
  return Math.round(total * 10) / 10;
}

/** PRD §4.3 — Frontier Index (0~1). 높다고 자동 판독 우선순위가 높은 것은 아니다. */
export const FRONTIER_WEIGHTS: Record<keyof FrontierSignals, number> = {
  unresolvedCharacterRatio: 0.25,
  historicalImportance: 0.2,
  discoveryRecency: 0.15,
  missingContextScore: 0.15,
  dataScarcity: 0.1,
  disagreementScore: 0.1,
  crossSteleConnectivity: 0.05,
};

export function computeFrontierIndex(signals: FrontierSignals): number {
  let total = 0;
  for (const key of Object.keys(FRONTIER_WEIGHTS) as Array<keyof FrontierSignals>) {
    total += FRONTIER_WEIGHTS[key] * signals[key];
  }
  return Math.round(total * 1000) / 1000;
}
