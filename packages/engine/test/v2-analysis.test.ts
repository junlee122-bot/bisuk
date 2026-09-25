import { describe, expect, it } from "vitest";
import {
  MIN_CALIBRATION_CASES,
  applyCalibration,
  expectedCalibrationError,
  fitCalibrationProfile,
  fitIsotonic,
  summarizeEvaluation,
  wilsonInterval,
  type LabeledScore,
} from "../src/calibration";
import { canonicalJson } from "../src/canonicalJson";
import { suggestClaims } from "../src/claimSuggest";
import { CharContextModel, MIN_CONTEXT_CORPUS_CHARS } from "../src/contextModel";
import { evaluateJoin, optimizeJoinOffset } from "../src/fragments";
import { strokeComparisonV2, strokeSetSimilarity, strokeSetSimilarityLegacy } from "../src/glyphFeatures";
import { analyzeGlyphCell } from "../src/pipeline";
import { VariantRegistry } from "../src/variants";
import { pipelineInputFor } from "./helpers";

describe("similarity v2", () => {
  it("끝점이 같아도 모양이 다른 획을 구분한다 (v1은 구분 못 함)", () => {
    const straight: Array<Array<[number, number]>> = [[[10, 50], [90, 50]]];
    const bent: Array<Array<[number, number]>> = [[[10, 50], [50, 90], [90, 50]]];
    expect(strokeSetSimilarityLegacy(straight, bent)).toBe(1);
    expect(strokeSetSimilarity(straight, bent)).toBeLessThan(0.5);
  });

  it("부분 관측된 획 조각도 참조 획 위에 있으면 맞춘다", () => {
    const c = strokeComparisonV2([[30, 50], [60, 50]], [[10, 50], [90, 50]]);
    expect(c.score).toBe(1);
    expect(c.coverage).toBeLessThan(0.7);
    expect(c.coverage).toBeGreaterThan(0.3);
  });

  it("셀 경계 오차(작은 평행 이동)를 정합으로 흡수한다", () => {
    const ref: Array<Array<[number, number]>> = [
      [[20, 20], [80, 20]],
      [[50, 20], [50, 90]],
    ];
    const shifted = ref.map((l) => l.map(([x, y]) => [x + 9, y + 9] as [number, number]));
    expect(strokeSetSimilarity(shifted, ref)).toBeGreaterThan(0.85);
    expect(strokeSetSimilarityLegacy(shifted, ref)).toBe(0);
  });
});

describe("pipeline v2 — 선택 입력", () => {
  it("파라미터 스냅샷·파생 축·인용 일치 방식이 결과에 남는다", () => {
    const r = analyzeGlyphCell(pipelineInputFor("demoA-L2-C3"));
    expect(r.parameters.contextMethod).toBe("DEMO_NEIGHBOR_HEURISTIC");
    expect(r.parameters.calibrationKind).toBe("DEMO_HEURISTIC");
    expect(r.derivedAxes).toContain("geometric");
    expect(r.gateResult?.calibration?.kind).toBe("DEMO_HEURISTIC");
    const rules = Object.fromEntries(r.gateResult!.ruleTrace.map((t) => [t.rule, t.status]));
    expect(rules.benchmark_leakage).toBe("PASS");
    expect(rules.strong_chronology_contradiction).toBe("NOT_EVALUATED");
    expect(rules.counter_evidence_not_dominant).toBe("PASS");
    const positional = r.evidence.filter((e) => e.targetSpecificity === "POSITIONAL");
    expect(positional.length).toBeGreaterThanOrEqual(2);
    expect(r.evidence.every((e) => e.citationMatchType !== "NONE" || !e.citationVerified)).toBe(true);
  });

  it("demoMode=false이고 보정 프로파일이 없으면 자동 확정하지 않는다", () => {
    const r = analyzeGlyphCell({ ...pipelineInputFor("demoA-L2-C3"), demoMode: false });
    expect(r.topCandidate?.candidateCharacter).toBe("安");
    expect(r.gateResult?.outcome).not.toBe("AUTO_ACCEPTED");
    expect(r.gateResult?.failedRules).toContain("calibration_available");
  });

  it("연대 증거가 있으면 연대 모순 규칙을 실제로 평가한다", () => {
    const base = pipelineInputFor("demoA-L2-C3");
    const ok = analyzeGlyphCell({ ...base, chronology: { tabYear: 450, earliestYearByChar: { 安: 100 } } });
    expect(ok.gateResult?.ruleTrace.find((t) => t.rule === "strong_chronology_contradiction")?.status).toBe("PASS");
    const bad = analyzeGlyphCell({ ...base, chronology: { tabYear: 450, earliestYearByChar: { 安: 900 } } });
    expect(bad.gateResult?.failedRules).toContain("strong_chronology_contradiction");
    expect(bad.gateResult?.outcome).not.toBe("AUTO_ACCEPTED");
  });

  it("숨김 벤치마크 셀의 판독이 비교에 쓰이면 누출로 판정한다", () => {
    const base = pipelineInputFor("demoA-L2-C3");
    const cellsByTab = new Map(
      [...base.cellsByTab].map(([k, cells]) => [
        k,
        cells.map((c) => (c.id === "demoB-L1-C1" ? { ...c, hiddenBenchmark: true } : c)),
      ])
    );
    const r = analyzeGlyphCell({ ...base, cellsByTab });
    expect(r.gateInput?.benchmarkLeakage).toBe(true);
    expect(r.gateResult?.failedRules).toContain("benchmark_leakage");
  });

  it("누출 문서에서 파생된 문서도 근거에서 제외한다", () => {
    const base = pipelineInputFor("demoA-L2-C3");
    const documents = base.documents.map((d) =>
      d.id === "doc-survey-epsilon" ? { ...d, derivedFromDocumentId: "doc-leak-kappa" } : d
    );
    const r = analyzeGlyphCell({ ...base, documents });
    expect(r.excludedDerivedFromLeakDocumentIds).toContain("doc-survey-epsilon");
    expect(r.independentLineageCount).toBe(1);
    expect(r.gateResult?.outcome).not.toBe("AUTO_ACCEPTED");
  });

  it("등록 표본은 시각 후보를 추가하고 어느 표본이 맞았는지 남긴다", () => {
    const base = pipelineInputFor("demoA-L2-C3");
    const anPrior = base.priors["安"]!.polylines as Array<Array<[number, number]>>;
    const r = analyzeGlyphCell({
      ...base,
      exemplars: { 宀: [{ id: "ex-1", polylines: anPrior.slice(0, 3) }] },
      topK: 8,
    });
    const c = r.candidates.find((x) => x.candidateCharacter === "宀");
    expect(c?.bestExemplar).toBe("ex-1");
  });

  it("이체자는 차순위 경쟁 후보로 보지 않는다", () => {
    const base = pipelineInputFor("demoA-L2-C3");
    const plain = analyzeGlyphCell(base);
    const grouped = analyzeGlyphCell({
      ...base,
      variantRegistry: new VariantRegistry([{ a: "安", b: "守", kind: "test", source: "test" }]),
    });
    expect(grouped.gateInput!.marginToSecondCandidate).toBeGreaterThan(plain.gateInput!.marginToSecondCandidate);
    expect(grouped.candidates.find((c) => c.candidateCharacter === "守")?.variantGroup).toBe("守");
  });

  it("문맥 모델이 충분히 학습되면 후보별 문맥 점수를 쓴다", () => {
    const base = pipelineInputFor("demoA-L2-C3");
    const seq: string[][] = [];
    for (let i = 0; i < 60; i++) seq.push([..."國安王"], [..."大守墓"]);
    const model = new CharContextModel(seq);
    expect(model.totalChars).toBeGreaterThanOrEqual(MIN_CONTEXT_CORPUS_CHARS);
    const r = analyzeGlyphCell({ ...base, contextModel: model });
    expect(r.parameters.contextMethod).toBe("CHAR_NGRAM");
  });

  it("같은 입력이면 결과가 같다 (결정성)", () => {
    const a = analyzeGlyphCell(pipelineInputFor("demoA-L1-C4"));
    const b = analyzeGlyphCell(pipelineInputFor("demoA-L1-C4"));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe("calibration", () => {
  const pts: LabeledScore[] = Array.from({ length: 40 }, (_, i) => ({
    score: i / 39,
    label: (i >= 20 ? 1 : i % 5 === 0 ? 1 : 0) as 0 | 1,
  }));

  it("등위 회귀는 단조 증가한다", () => {
    const steps = fitIsotonic(pts);
    for (let i = 1; i < steps.length; i++) expect(steps[i]![1]!).toBeGreaterThanOrEqual(steps[i - 1]![1]!);
  });

  it("표본이 최소 기준 미만이면 적합을 거부한다", () => {
    expect(() =>
      fitCalibrationProfile(pts.slice(0, MIN_CALIBRATION_CASES - 1), "ISOTONIC", { id: "p", fittedBy: "t", fittedAt: "x" })
    ).toThrow(/최소/);
  });

  it("Platt 보정은 점수가 높을수록 확률이 높다", () => {
    const p = fitCalibrationProfile(pts, "PLATT", { id: "p", fittedBy: "t", fittedAt: "x" });
    expect(applyCalibration(p, 0.9)).toBeGreaterThan(applyCalibration(p, 0.1));
    expect(p.ece).toBeGreaterThanOrEqual(0);
  });

  it("완벽 보정이면 ECE 0", () => {
    expect(expectedCalibrationError([{ p: 1, y: 1 }, { p: 0, y: 0 }])).toBe(0);
  });

  it("Wilson 구간 — 0/5도 상한이 0이 아니다", () => {
    const w = wilsonInterval(0, 5);
    expect(w.point).toBe(0);
    expect(w.upper).toBeGreaterThan(0.4);
  });

  it("평가 요약은 작은 표본·합성 벤치마크를 경고한다", () => {
    const s = summarizeEvaluation([
      { caseId: "a", truthSource: "BENCHMARK", truth: "安", outcome: "AUTO_ACCEPTED", topCandidate: "安", rawScore: 0.8, confidence: 0.86 },
      { caseId: "b", truthSource: "BENCHMARK", truth: "戶", outcome: "UNKNOWN", topCandidate: "戶", rawScore: 0.5, confidence: 0.56 },
    ]);
    expect(s.autoAccepted).toBe(1);
    expect(s.falseAutoAcceptRate.point).toBe(0);
    expect(s.falseAutoAcceptRate.upper).toBeGreaterThan(0.5);
    expect(s.warnings.join(" ")).toContain("합성 벤치마크");
    expect(s.sufficientForCalibration).toBe(false);
  });
});

describe("claim suggestion", () => {
  it("위치 표기와 입장 표현으로 주장을 제안한다", () => {
    const text =
      "서론. 제2행 제3자는 갓머리 아래 획의 흔적으로 보아 安으로 판독함이 타당하다. 그러나 제3행 제5자를 戶로 읽는 것은 신중해야 한다.";
    const cells = [
      { id: "c23", lineIndex: 2, sequenceIndex: 3 },
      { id: "c35", lineIndex: 3, sequenceIndex: 5 },
    ];
    const s = suggestClaims(text, cells);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ targetGlyphCellId: "c23", character: "安", stance: "SUPPORT" });
    expect(s[1]).toMatchObject({ targetGlyphCellId: "c35", character: "戶", stance: "COUNTER" });
    expect(text.slice(s[0]!.offset)).toMatch(/^제2행/);
  });

  it("셀에 없는 위치는 제안하지 않는다", () => {
    expect(suggestClaims("제9행 제9자는 王으로 읽는다.", [{ id: "x", lineIndex: 1, sequenceIndex: 1 }])).toHaveLength(0);
  });
});

describe("join optimizer", () => {
  it("동일 곡선을 어긋나게 놓으면 원래 위치(0)를 찾아낸다", () => {
    const curve: Array<[number, number]> = [[0, 0.1], [0.3, 0.25], [0.6, 0.05], [1, 0.2]];
    const { offset, result } = optimizeJoinOffset(curve, curve);
    expect(Math.abs(offset)).toBeLessThan(0.01);
    expect(result.joinConfidence).toBeGreaterThan(evaluateJoin(curve, curve, 0.2).joinConfidence);
  });
});
