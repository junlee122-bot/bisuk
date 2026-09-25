import { describe, expect, it } from "vitest";
import { extractPositionalRefs, normalizeForCitation, verifyCitation } from "../src/citation";
import { buildLineages, countIndependentLineages } from "../src/genealogy";
import { Bm25Index, expandQueryTokensWeighted, tokenize } from "../src/search";
import { DEFAULT_VARIANT_PAIRS, VariantRegistry, parseUnihanVariants } from "../src/variants";

describe("VariantRegistry", () => {
  it("쌍을 동치류로 묶고 대표자는 코드포인트 최소값이다", () => {
    const r = new VariantRegistry(DEFAULT_VARIANT_PAIRS);
    expect(r.areVariants("戶", "尸")).toBe(true);
    expect(r.areVariants("戸", "尸")).toBe(true); // 추이적
    expect(r.areVariants("大", "戶")).toBe(false);
    expect(r.classOf("戸")).toEqual(["尸", "戶", "戸"].sort());
    expect(r.representative("太")).toBe("大");
    expect(r.representative("安")).toBe("安");
    expect(r.fold("太王")).toBe("大王");
    expect(r.expand("大")).toEqual(["太"]);
  });

  it("Unihan_Variants 형식을 파싱하고 소스 태그·주석을 무시한다", () => {
    const text = [
      "# Unihan_Variants.txt",
      "",
      "U+5927\tkSemanticVariant\tU+592A<kMatthews",
      "U+6236\tkZVariant\tU+6238",
      "U+842C\tkSimplifiedVariant\tU+4E07",
      "U+4E00\tkUnknownField\tU+4E01",
      "garbage line",
      "U+20000\tkSemanticVariant\tU+20001<kFenn U+20002",
    ].join("\n");
    const { pairs, skipped } = parseUnihanVariants(text);
    expect(pairs).toContainEqual({ a: "大", b: "太", kind: "kSemanticVariant", source: "Unihan" });
    expect(pairs).toContainEqual({ a: "戶", b: "戸", kind: "kZVariant", source: "Unihan" });
    expect(pairs.some((p) => p.a === "萬" && p.b === "万")).toBe(true);
    expect(pairs.filter((p) => p.a === "\u{20000}")).toHaveLength(2);
    expect(skipped).toBe(2);
  });
});

describe("citation v2", () => {
  const content = "갑본을 보면, 제2행 제3자는  安 으로\n판독함이 타당하다. 한편 太王이라는 표현도 보인다.";

  it("공백·줄바꿈·구두점 차이는 정규화 일치로 검증되고 원문 위치를 돌려준다", () => {
    const c = verifyCitation(content, "제2행 제3자는 安으로 판독함이 타당하다");
    expect(c.verified).toBe(true);
    expect(c.matchType).toBe("NORMALIZED");
    expect(content.slice(c.offset!, c.offset! + c.length!)).toBe("제2행 제3자는  安 으로\n판독함이 타당하다");
  });

  it("전각·호환 문자도 NFKC로 맞춘다", () => {
    const c = verifyCitation("제２행 제３자는 安으로 읽는다", "제2행 제3자는 安으로 읽는다");
    expect(c.verified).toBe(true);
    expect(c.matchType).toBe("NORMALIZED");
  });

  it("이체자 접기는 레지스트리가 있을 때만, 별도 matchType으로 표시한다", () => {
    const q = "한편 大王이라는 표현도 보인다";
    expect(verifyCitation(content, q).verified).toBe(false);
    const c = verifyCitation(content, q, { registry: new VariantRegistry() });
    expect(c.verified).toBe(true);
    expect(c.matchType).toBe("VARIANT_FOLDED");
    expect(c.reason).toContain("이체자");
  });

  it("공백·구두점을 빼고 8자 미만이면 거부한다", () => {
    const c = verifyCitation("가 나 다 라 마 바 사 아", "가 나 다 라 마 바 사");
    expect(c.verified).toBe(false);
    expect(c.reason).toContain("짧아");
  });

  it("대상 위치를 명시한 인용은 POSITIONAL, 글자만 있으면 CHARACTER, 둘 다 없으면 NONE", () => {
    const target = { character: "安", lineIndex: 2, sequenceIndex: 3 };
    expect(verifyCitation(content, "제2행 제3자는 安으로 판독함이 타당하다", { target }).targetSpecificity).toBe("POSITIONAL");
    const other = "연구진은 문제의 글자를 安으로 판독했다고 밝혔다";
    expect(verifyCitation(other, other, { target }).targetSpecificity).toBe("CHARACTER");
    const none = "이 비석의 건립 연대는 아직 확정되지 않았다";
    expect(verifyCitation(none, none, { target }).targetSpecificity).toBe("NONE");
    // 다른 위치를 가리키면 POSITIONAL이 아니다
    const wrong = "제3행 제5자는 安으로 판독함이 타당하다";
    expect(verifyCitation(wrong, wrong, { target }).targetSpecificity).toBe("CHARACTER");
  });

  it("위치 표기 추출 — 한글·한문·L-C 표기", () => {
    expect(extractPositionalRefs("제2행 제3자")).toEqual([{ line: 2, seq: 3, index: 0 }]);
    expect(extractPositionalRefs("第二行 第十一字").map((r) => [r.line, r.seq])).toEqual([[2, 11]]);
    expect(extractPositionalRefs("L4-C12 참조").map((r) => [r.line, r.seq])).toEqual([[4, 12]]);
  });

  it("정규화 매핑은 보조 평면 한자도 원문 위치를 유지한다", () => {
    const n = normalizeForCitation("a \u{20000}b");
    expect(n.text).toBe("a\u{20000}b");
    expect(n.orig[1]).toBe(2);
  });
});

describe("genealogy v2", () => {
  it("다른 그룹명이 붙었어도 derivedFrom으로 이어지면 하나의 계보다", () => {
    const docs = [
      { id: "a", title: "원탁본", independenceGroup: "G1", derivedFromDocumentId: null, reliabilityTier: 3 },
      { id: "b", title: "재인용 논문", independenceGroup: "G5", derivedFromDocumentId: "a", reliabilityTier: 2 },
      { id: "c", title: "독립 조사", independenceGroup: "G2", derivedFromDocumentId: null, reliabilityTier: 3 },
    ];
    expect(countIndependentLineages(docs)).toBe(2);
    const g = buildLineages(docs).find((l) => l.documentIds.includes("b"))!;
    expect(g.mergedGroups).toEqual(["G1", "G5"]);
    expect(g.rootDocumentId).toBe("a");
  });

  it("조상 문서가 지지 목록 밖이어도 universe로 추적한다", () => {
    const universe = [
      { id: "root", title: "원자료", independenceGroup: "G0", derivedFromDocumentId: null, reliabilityTier: 1 },
    ];
    const support = [
      { id: "x", title: "X", independenceGroup: "GX", derivedFromDocumentId: "root", reliabilityTier: 2 },
      { id: "y", title: "Y", independenceGroup: "GY", derivedFromDocumentId: "root", reliabilityTier: 2 },
    ];
    expect(countIndependentLineages(support, [...universe, ...support])).toBe(1);
  });
});

describe("search v2", () => {
  it("확장 B 한자(보조 평면)를 한자로 토큰화한다", () => {
    const t = tokenize("\u{20000}\u{20001} 비문");
    expect(t).toContain("\u{20000}");
    expect(t).toContain("\u{20000}\u{20001}");
    expect(t).toContain("비문");
  });

  it("이체자 확장 토큰은 가중치가 낮아 정확 일치 문서가 먼저 나온다", () => {
    const w = expandQueryTokensWeighted(["大王"]);
    expect(w.find((x) => x.token === "太王")?.weight).toBeLessThan(1);
    const idx = new Bm25Index([
      { id: "exact", title: "", content: "大王의 비문" },
      { id: "variant", title: "", content: "太王의 비문" },
    ]);
    const hits = idx.search("大王");
    expect(hits.map((h) => h.id)).toEqual(["exact", "variant"]);
  });

  it("레지스트리를 주입하면 사용자 등록 이체자로 확장한다", () => {
    const idx = new Bm25Index(
      [{ id: "d", title: "", content: "萬年을 기원" }],
      new VariantRegistry([{ a: "万", b: "萬", kind: "user", source: "user" }])
    );
    expect(idx.search("万").map((h) => h.id)).toEqual(["d"]);
  });
});
