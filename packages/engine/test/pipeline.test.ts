import { describe, expect, it } from "vitest";
import { analyzeGlyphCell } from "../src/pipeline";
import { pipelineInputFor } from "./helpers";

describe("자율 판독 파이프라인 — 시드 시나리오", () => {
  it("demoA-L2-C3: 시각+교차+독립 2계보 문헌 근거 → AUTO_ACCEPTED", () => {
    const result = analyzeGlyphCell(pipelineInputFor("demoA-L2-C3"));
    expect(result.topCandidate?.candidateCharacter).toBe("安");
    expect(result.independentLineageCount).toBeGreaterThanOrEqual(2);
    expect(result.verifiedPrimaryOrDirectSourceCount).toBeGreaterThanOrEqual(1);
    expect(result.gateResult?.passed).toBe(true);
    expect(result.gateResult?.outcome).toBe("AUTO_ACCEPTED");
    // 교차 비석 근거: DEMO-B의 安 관측 셀과 매칭되어야 함
    const crossIds = result.crossSteleMatches.map((m) => m.targetGlyphCellId);
    expect(crossIds).toContain("demoB-L1-C1");
    // 반대 근거(재검토 이설)도 함께 수집돼야 함
    expect(result.evidence.some((e) => e.kind === "COUNTER")).toBe(true);
  });

  it("demoA-L2-C3: 벤치마크 누출 문서는 근거에서 제외된다", () => {
    const result = analyzeGlyphCell(pipelineInputFor("demoA-L2-C3"));
    expect(result.excludedLeakDocumentIds).toContain("doc-leak-kappa");
    expect(result.evidence.every((e) => e.documentId !== "doc-leak-kappa")).toBe(true);
    expect(result.gateInput?.benchmarkLeakage).toBe(false);
  });

  it("demoA-L1-C4: 守/墓 독립 근거 경합 → CONFLICTING", () => {
    const result = analyzeGlyphCell(pipelineInputFor("demoA-L1-C4"));
    expect(result.gateResult?.passed).toBe(false);
    expect(result.gateResult?.outcome).toBe("CONFLICTING");
    const chars = result.candidates.map((c) => c.candidateCharacter);
    expect(chars).toContain("守");
    expect(chars).toContain("墓");
  });

  it("demoA-L3-C5: 시각 근거 약함 + 계보 1개 + 반증 존재 → UNKNOWN", () => {
    const result = analyzeGlyphCell(pipelineInputFor("demoA-L3-C5"));
    expect(result.gateResult?.passed).toBe(false);
    expect(result.gateResult?.outcome).toBe("UNKNOWN");
    expect(result.gateResult?.failedRules).toContain("independent_lineage_count");
    expect(
      result.evidence.some((e) => e.kind === "COUNTER" && e.citationVerified)
    ).toBe(true);
  });

  it("demoC2-L2-C3: 관측 불가 수준 마모 → ILLEGIBLE", () => {
    const result = analyzeGlyphCell(pipelineInputFor("demoC2-L2-C3"));
    expect(result.gateResult?.passed).toBe(false);
    expect(result.gateResult?.outcome).toBe("ILLEGIBLE");
  });

  it("독립 분석: 후보 생성은 다른 비석 판독 주입 없이 시각·문헌 근거로만 이뤄진다", () => {
    const input = pipelineInputFor("demoA-L2-C3");
    // 다른 탭 셀 제거 후에도 시각 후보 순위는 동일해야 함 (독립성)
    const isolated = {
      ...input,
      cellsByTab: new Map([[input.tab.id, input.cellsByTab.get(input.tab.id)!]]),
      allTabs: [input.tab],
    };
    const result = analyzeGlyphCell(isolated);
    expect(result.topCandidate?.candidateCharacter).toBe("安");
    expect(result.crossSteleMatches).toHaveLength(0);
  });

  it("인용 검증: 모든 채택 근거 인용문은 실제 본문 위치가 확인된다", () => {
    const result = analyzeGlyphCell(pipelineInputFor("demoA-L2-C3"));
    const supports = result.evidence.filter(
      (e) => e.kind === "SUPPORT" && e.candidateCharacter === "安"
    );
    expect(supports.length).toBeGreaterThanOrEqual(2);
    for (const ev of supports) {
      expect(ev.citationVerified).toBe(true);
      expect(ev.quoteOffset).not.toBeNull();
      expect(ev.citationContext).toContain(ev.quote);
    }
  });

  it("출처 계보: 재인용 문서(기사·개설서)는 독립 계보로 세지 않는다", () => {
    const result = analyzeGlyphCell(pipelineInputFor("demoA-L2-C3"));
    // G1 계보에는 원 탁본 + 논문 + 기사 + 개설서 4개 문서가 있으나 계보는 1개
    const g1 = result.lineages.find((l) => l.independenceGroup === "G1-rubbing-alpha");
    expect(g1).toBeDefined();
    expect(g1!.documentIds.length).toBeGreaterThanOrEqual(3);
    expect(result.independentLineageCount).toBe(2);
  });
});
