import { describe, expect, it } from "vitest";
import { verifyCitation } from "../src/citation";
import { runDecisionGate } from "../src/decisionGate";
import { evaluateJoin } from "../src/fragments";
import {
  buildLineages,
  countIndependentLineages,
  countVerifiedPrimaryOrDirect,
} from "../src/genealogy";
import {
  featureVector,
  jitterPolylines,
  polylinesToSvgPath,
  strokeSetSimilarity,
  strokesMatch,
} from "../src/glyphFeatures";
import { computeFrontierIndex, computeMaturityScore } from "../src/maturity";
import { Bm25Index, expandQueryTokens, tokenize } from "../src/search";
import type { DecisionGateInput } from "@seokmun/types";

describe("glyphFeatures", () => {
  it("동일 획은 허용 오차 내에서 일치한다 (역방향 포함)", () => {
    expect(strokesMatch([[10, 10], [90, 10]], [[12, 12], [88, 8]])).toBe(true);
    expect(strokesMatch([[10, 10], [90, 10]], [[90, 10], [10, 10]])).toBe(true);
    expect(strokesMatch([[10, 10], [90, 10]], [[10, 40], [90, 40]])).toBe(false);
  });

  it("부분 관측 획 집합은 원 자형과 가장 유사하다", () => {
    const full: Array<Array<[number, number]>> = [
      [[50, 6], [50, 14]],
      [[16, 22], [84, 22]],
      [[36, 44], [58, 86]],
    ];
    const observed = full.slice(0, 2);
    const other: Array<Array<[number, number]>> = [
      [[20, 42], [80, 42]],
      [[50, 12], [26, 88]],
      [[50, 12], [76, 88]],
    ];
    expect(strokeSetSimilarity(observed, full)).toBeGreaterThan(
      strokeSetSimilarity(observed, other)
    );
  });

  it("jitter는 결정적이고 좌표 범위를 벗어나지 않는다", () => {
    const lines: Array<Array<[number, number]>> = [[[0, 0], [100, 100]]];
    const a = jitterPolylines(lines, 5, "cell-1");
    const b = jitterPolylines(lines, 5, "cell-1");
    expect(a).toEqual(b);
    for (const line of a) {
      for (const [x, y] of line) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("featureVector와 SVG path는 안정적으로 생성된다", () => {
    const fv = featureVector([[[10, 10], [90, 10]], [[50, 10], [50, 90]]]);
    expect(fv).toHaveLength(9);
    const path = polylinesToSvgPath([[[10, 10], [90, 10]]]);
    expect(path).toContain("M 10.0 10.0");
    expect(path).toContain("L 90.0 10.0");
  });
});

describe("search (BM25 + 이체자 확장)", () => {
  const docs = [
    { id: "d1", title: "안 판독", content: "제2행 제3자는 安으로 판독함이 타당하다" },
    { id: "d2", title: "다른 주제", content: "이 문서는 태왕 관련 太 논의를 담는다" },
    { id: "d3", title: "무관", content: "완전히 무관한 내용" },
  ];
  const index = new Bm25Index(docs);

  it("문자 질의로 문서를 찾는다", () => {
    const hits = index.search("安 판독");
    expect(hits[0]?.id).toBe("d1");
    expect(hits[0]?.snippet).toContain("安");
  });

  it("이체자 확장: 大 질의가 太 문서를 찾는다", () => {
    expect(expandQueryTokens(["大"])).toContain("太");
    const hits = index.search("大");
    expect(hits.map((h) => h.id)).toContain("d2");
  });

  it("CJK unigram + bigram 토큰화", () => {
    const tokens = tokenize("守墓人 연호를 검토");
    expect(tokens).toContain("守");
    expect(tokens).toContain("守墓");
    expect(tokens).toContain("연호를");
  });
});

describe("citation verifier", () => {
  it("본문에 존재하는 인용은 위치·문맥과 함께 검증된다", () => {
    const check = verifyCitation("앞부분. 정확한 인용 문장이다. 뒷부분.", "정확한 인용 문장이다");
    expect(check.verified).toBe(true);
    expect(check.offset).toBe(5);
    expect(check.context).toContain("【정확한 인용 문장이다】");
  });
  it("본문에 없는 인용은 거부된다", () => {
    const check = verifyCitation("본문 내용에 존재하지 않는 다른 문장", "여기에 없는 인용 문장이다");
    expect(check.verified).toBe(false);
    expect(check.offset).toBeNull();
  });
  it("한두 글자짜리 인용은 본문에 있어도 검증 불충분으로 거부된다", () => {
    const check = verifyCitation("此字非安也 — 安이 아니라는 반박문", "安");
    expect(check.verified).toBe(false);
    expect(check.reason).toContain("짧아");
  });
});

describe("genealogy", () => {
  const docs = [
    { id: "a", title: "원탁본", independenceGroup: "G1", derivedFromDocumentId: null, reliabilityTier: 3 },
    { id: "b", title: "논문", independenceGroup: "G1", derivedFromDocumentId: "a", reliabilityTier: 2 },
    { id: "c", title: "기사", independenceGroup: "G1", derivedFromDocumentId: "b", reliabilityTier: 5 },
    { id: "d", title: "책", independenceGroup: "G1", derivedFromDocumentId: "a", reliabilityTier: 4 },
    { id: "e", title: "독립 조사", independenceGroup: "G2", derivedFromDocumentId: null, reliabilityTier: 3 },
  ];
  it("재인용 4건 + 독립 1건 = 계보 2개", () => {
    expect(countIndependentLineages(docs)).toBe(2);
  });
  it("1차/직접 출처는 계보 뿌리이면서 tier<=3", () => {
    expect(countVerifiedPrimaryOrDirect(docs)).toBe(2);
  });
  it("계보 그룹에 뿌리 문서가 기록된다", () => {
    const lineages = buildLineages(docs);
    expect(lineages.find((l) => l.independenceGroup === "G1")?.rootDocumentId).toBe("a");
  });
});

describe("decision gate", () => {
  const base: DecisionGateInput = {
    calibratedConfidence: 0.9,
    marginToSecondCandidate: 0.3,
    verifiedPrimaryOrDirectSourceCount: 1,
    independentLineageCount: 2,
    strongVisualContradiction: false,
    strongChronologyContradiction: false,
    citationVerified: true,
    benchmarkLeakage: false,
    hasCompetingCandidateWithEvidence: false,
    observabilityScore: 0.7,
  };
  it("모든 조건 충족 → AUTO_ACCEPTED", () => {
    const r = runDecisionGate(base);
    expect(r.passed).toBe(true);
    expect(r.outcome).toBe("AUTO_ACCEPTED");
    expect(r.ruleTrace).toHaveLength(8);
  });
  it("신뢰도 미달 → 실패, 규칙 추적 포함", () => {
    const r = runDecisionGate({ ...base, calibratedConfidence: 0.5 });
    expect(r.passed).toBe(false);
    expect(r.failedRules).toContain("calibrated_confidence");
  });
  it("경쟁 근거 존재 → CONFLICTING", () => {
    const r = runDecisionGate({
      ...base,
      marginToSecondCandidate: 0.01,
      hasCompetingCandidateWithEvidence: true,
    });
    expect(r.outcome).toBe("CONFLICTING");
  });
  it("관측 불가 → ILLEGIBLE", () => {
    const r = runDecisionGate({
      ...base,
      calibratedConfidence: 0.2,
      observabilityScore: 0.1,
    });
    expect(r.outcome).toBe("ILLEGIBLE");
  });
  it("시각 근거 없이 문헌 계보만 → TEXTUAL_SUPPLEMENT", () => {
    const r = runDecisionGate(
      { ...base, calibratedConfidence: 0.6, independentLineageCount: 1 },
      { topCandidateVisualScore: 0.1 }
    );
    expect(r.outcome).toBe("TEXTUAL_SUPPLEMENT");
  });
  it("벤치마크 누출 감지 → 자동 채택 금지", () => {
    const r = runDecisionGate({ ...base, benchmarkLeakage: true });
    expect(r.passed).toBe(false);
    expect(r.failedRules).toContain("benchmark_leakage");
  });
});

describe("maturity / frontier index", () => {
  it("가중 성숙도 점수 계산 (PRD §4.2)", () => {
    const all50 = {
      sourceScore: 50, geometryScore: 50, imageScore: 50, transcriptionScore: 50,
      bibliographyScore: 50, independentTeamScore: 50, chronologyConsensusScore: 50,
      purposeConsensusScore: 50, openDataScore: 50, rightsClarityScore: 50,
    };
    expect(computeMaturityScore(all50)).toBeCloseTo(50, 5);
  });
  it("Frontier Index 계산 (PRD §4.3)", () => {
    const idx = computeFrontierIndex({
      unresolvedCharacterRatio: 1, historicalImportance: 1, discoveryRecency: 1,
      missingContextScore: 1, dataScarcity: 1, disagreementScore: 1, crossSteleConnectivity: 1,
    });
    expect(idx).toBeCloseTo(1, 5);
  });
});

describe("fragment join", () => {
  const curve: Array<[number, number]> = [
    [0, 0.52], [0.2, 0.44], [0.42, 0.5], [0.63, 0.38], [0.82, 0.46], [1, 0.4],
  ];
  it("완전 접합 위치에서 높은 신뢰도, 간섭 없음", () => {
    const r = evaluateJoin(curve, curve, 0);
    expect(r.meanGap).toBe(0);
    expect(r.interferenceRatio).toBe(0);
    expect(r.joinConfidence).toBeGreaterThan(0.95);
  });
  it("어긋난 위치에서 낮은 신뢰도", () => {
    const r = evaluateJoin(curve, curve, 0.3);
    expect(r.joinConfidence).toBeLessThan(0.2);
  });
  it("겹침(간섭)이 보고된다", () => {
    const r = evaluateJoin(curve, curve, -0.1);
    expect(r.interferenceRatio).toBeGreaterThan(0.5);
  });
});
