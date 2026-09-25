import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BibliographyEntry, GlyphCell, Reading } from "@seokmun/types";
import {
  bibliographyDedupeKey,
  detectBibliographyFormat,
  formatBibliographyList,
  formatCitation,
  parseBibtex,
  parseCslJson,
  parseRis,
  serializeBibtex,
  serializeRis,
  toCslJson,
} from "../src/bibliography";
import { cellLabel, exportCsv, exportEpiDoc, exportReport, faceLabelFor } from "../src/exporters";
import { makeExportInput } from "./exportFixture";

const here = path.dirname(fileURLToPath(import.meta.url));
const RNG = path.join(here, "fixtures/tei-epidoc.rng");

function hasXmllint(): boolean {
  try {
    execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function validate(xml: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "epidoc-"));
  const file = path.join(dir, "out.xml");
  writeFileSync(file, xml);
  let raw: string;
  let ok: boolean;
  try {
    // libxml2는 이 스키마 컴파일 중 "internal error ... notAllowed" 잡음을 stderr로 내지만 판정에는 영향 없다
    raw = execFileSync("xmllint", ["--noout", "--relaxng", RNG, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    ok = true;
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    raw = `${err.stderr ?? ""}${err.stdout ?? ""}`;
    ok = false;
  }
  const output = raw
    .split("\n")
    .filter((l) => l && !l.includes("trying to compile notAllowed"))
    .join("\n");
  return { ok: ok && !/fails to validate/.test(output), output };
}

const now = "2026-09-25T00:00:00Z";
function reading(p: Partial<Reading> & Pick<Reading, "id" | "glyphCellId">): Reading {
  return {
    steleTabId: "tab1",
    readingKind: "CHARACTER",
    reading: null,
    variantForm: null,
    certainty: "PROBABLE",
    confidence: null,
    rationale: "",
    supplied: false,
    unclear: false,
    sourceType: "RESEARCHER",
    sourceLabel: "",
    bibliographyId: null,
    citationLocator: "",
    authorId: "u1",
    authorName: "연구원 갑",
    reviewStatus: "PROPOSED",
    reviewerId: null,
    reviewerName: null,
    reviewedAt: null,
    reviewNote: "",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

const bibEntry: BibliographyEntry = {
  id: "bib1",
  citationKey: "heo1984",
  type: "article-journal",
  title: "충주 고구려비 판독 재검토",
  author: [{ literal: "허흥식" }],
  editor: [],
  issued: { year: 1984 },
  containerTitle: "사학연구",
  volume: "38",
  issue: "",
  page: "12-40",
  publisher: "한국사학회",
  publisherPlace: "",
  genre: "",
  DOI: "",
  URL: "",
  ISBN: "",
  language: "ko",
  note: "",
  createdBy: "t",
  createdAt: now,
  updatedAt: now,
};

function richInput() {
  const input = makeExportInput();
  const cells = input.glyphCells as GlyphCell[];
  // 결락 연속 2자 + 이견 있는 채택 셀 + 이체자 채택
  cells.push(
    { ...cells[2]!, id: "g4", sequenceIndex: 4 },
    { ...cells[0]!, id: "g5", lineIndex: 2, sequenceIndex: 1, readingStatus: "UNKNOWN", publishedReading: null, adoptedReadingId: "r-adopt" },
    { ...cells[0]!, id: "g6", lineIndex: 2, sequenceIndex: 2, readingStatus: "UNKNOWN", publishedReading: null, adoptedReadingId: "r-var" }
  );
  const readings: Reading[] = [
    reading({ id: "r-adopt", glyphCellId: "g5", reading: "守", supplied: true, certainty: "CERTAIN", reviewStatus: "ACCEPTED", sourceType: "PUBLISHED_EDITION", sourceLabel: "허흥식 1984", bibliographyId: "bib1" }),
    reading({ id: "r-other", glyphCellId: "g5", reading: "墓", unclear: true }),
    reading({ id: "r-var", glyphCellId: "g6", reading: "戶", variantForm: "戸", reviewStatus: "ACCEPTED" }),
    reading({ id: "r-rej", glyphCellId: "g6", reading: "尸", reviewStatus: "REJECTED" }),
  ];
  return { ...input, glyphCells: cells, readings, bibliography: [bibEntry] };
}

describe("EpiDoc v2", () => {
  it("구조: 면별 textpart, lb, 결락 병합, 채택 판독·기계 판독 구분, 이견 apparatus", () => {
    const xml = exportEpiDoc(richInput());
    expect(xml).toContain('<div type="edition" subtype="virtual-demo" xml:lang="lzh"');
    expect(xml).toContain('<div type="textpart" subtype="face"');
    expect(xml).toContain('<lb n="1"/>王');
    // g3·g4 연속 판독 불가 → 하나의 gap
    expect(xml).toContain('<gap reason="illegible" quantity="2" unit="character"/>');
    // 기계 자동 확정은 resp=#seokmun-auto, cert medium 이하
    expect(xml).toMatch(/<supplied reason="lost" cert="medium" resp="#auto-tab1">安<\/supplied>/);
    // 사람 채택 복원
    expect(xml).toContain('<supplied reason="lost" cert="high" resp="#lab-tab1">守</supplied>');
    // 이체자
    expect(xml).toContain("<choice><orig>戸</orig><reg>戶</reg></choice>");
    // 이견 apparatus (기각 판독은 제외)
    expect(xml).toContain('<app loc="');
    expect(xml).toMatch(/<lem resp="#rdr-tab1-\d" source="#bib-tab1-bib1">守<\/lem><rdg resp="#rdr-tab1-\d">墓<\/rdg>/);
    expect(xml).not.toContain("尸");
    expect(xml).toContain('<div type="bibliography">');
  });

  it.skipIf(!hasXmllint() || !existsSync(RNG))("EpiDoc 9.8 RELAX NG 스키마로 검증된다 (단일 비석)", () => {
    const r = validate(exportEpiDoc(richInput()));
    expect(r.ok, r.output).toBe(true);
  });

  it.skipIf(!hasXmllint() || !existsSync(RNG))("여러 비석은 teiCorpus로 묶여 검증된다", () => {
    const input = richInput();
    input.tabs = [input.tabs[0]!, { ...input.tabs[0]!, id: "tab2", title: "두 번째 비석" }];
    const xml = exportEpiDoc(input);
    expect(xml).toContain("<teiCorpus");
    const r = validate(xml);
    expect(r.ok, r.output).toBe(true);
  });
});

describe("CSV·보고서 v2", () => {
  it("CSV는 BOM·CRLF이고 면·행·자 라벨, 판독자별 판독을 담는다", () => {
    const csv = exportCsv(richInput());
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("cell_label");
    expect(csv).toContain("1행 1자");
    expect(csv).toContain("허흥식 1984: [守] (채택)");
    expect(csv).toContain("연구원 갑: 墓?");
  });

  it("보고서에 판독문·판독자별 비교·참고문헌이 들어간다", () => {
    const md = exportReport(richInput());
    expect(md).toContain("## 판독문");
    expect(md).toContain(" 1  王[安][?][?]");
    expect(md).toContain("## 판독자별 비교");
    expect(md).toContain("## 참고문헌");
    expect(md).toContain("허흥식, 「충주 고구려비 판독 재검토」, 『사학연구』 38, 한국사학회, 1984, 12-40쪽.");
  });

  it("면 이름 추정", () => {
    expect(faceLabelFor("demoA-front")).toBe("전면");
    expect(faceLabelFor("demoC-frag2")).toBe("조각 2");
    expect(cellLabel({ faceId: "x-back", lineIndex: 3, sequenceIndex: 7 })).toBe("후면 3행 7자");
  });
});

describe("bibliography", () => {
  const bib = `
@string{sh = "사학연구"}
@article{heo1984,
  author = {허흥식 and Kim, Minsu and {국립문화재연구원}},
  title = {충주 {고구려비} 판독 재검토},
  journal = sh,
  volume = 38,
  pages = {12--40},
  year = {1984},
  month = mar,
}
@phdthesis{lee2020, author={이순신}, title={고구려 금석문 연구}, school={서울대학교}, year=2020}
@weird{x, title={Unknown type}}
@book{notitle, author={A}}
`;
  it("BibTeX 가져오기 — 매크로·중첩 괄호·기관명·학위논문·경고", () => {
    const r = parseBibtex(bib);
    expect(r.entries).toHaveLength(3);
    const a = r.entries[0]!;
    expect(a.title).toBe("충주 고구려비 판독 재검토");
    expect(a.containerTitle).toBe("사학연구");
    expect(a.author).toEqual([{ literal: "허흥식" }, { family: "Kim", given: "Minsu" }, { literal: "국립문화재연구원" }]);
    expect(a.page).toBe("12-40");
    expect(a.issued).toEqual({ year: 1984, month: 3 });
    expect(a.language).toBe("ko");
    expect(r.entries[1]!.genre).toBe("박사학위논문");
    expect(r.warnings.some((w) => w.includes("weird"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("notitle"))).toBe(true);
  });

  it("BibTeX·RIS·CSL-JSON 왕복", () => {
    const orig = parseBibtex(bib).entries;
    const again = parseBibtex(serializeBibtex(orig)).entries;
    expect(again.map((e) => [e.title, e.page, e.issued?.year])).toEqual(orig.map((e) => [e.title, e.page, e.issued?.year]));
    const ris = parseRis(serializeRis(orig)).entries;
    expect(ris.map((e) => e.title)).toEqual(orig.map((e) => e.title));
    expect(ris[0]!.author[1]).toEqual({ family: "Kim", given: "Minsu" });
    const full = orig.map((e, i) => ({ ...e, id: `b${i}`, createdBy: "t", createdAt: now, updatedAt: now }));
    const csl = parseCslJson(JSON.stringify(toCslJson(full))).entries;
    expect(csl.map((e) => e.type)).toEqual(orig.map((e) => e.type));
  });

  it("RIS 가져오기 — 여러 줄 값, ER 누락 경고", () => {
    const r = parseRis("TY  - JOUR\nTI  - Stele readings\n  continued title\nAU  - Park, Jiwon\nPY  - 2019/05\nJO  - Epigraphy\nSP  - 3\nEP  - 9\n");
    expect(r.entries[0]!.title).toBe("Stele readings continued title");
    expect(r.entries[0]!.page).toBe("3-9");
    expect(r.entries[0]!.issued).toEqual({ year: 2019, month: 5 });
    expect(r.warnings.join()).toContain("ER");
  });

  it("형식 감지·중복 키", () => {
    expect(detectBibliographyFormat(bib)).toBe("bibtex");
    expect(detectBibliographyFormat("TY  - BOOK\nER  - ")).toBe("ris");
    expect(detectBibliographyFormat("[{}]")).toBe("csl-json");
    expect(bibliographyDedupeKey({ DOI: "https://doi.org/10.1/ABC", title: "", issued: null })).toBe("doi:10.1/abc");
    expect(bibliographyDedupeKey({ DOI: "", title: "충주 고구려비, 판독", issued: { year: 1984 } })).toBe(
      bibliographyDedupeKey({ DOI: "", title: "충주 고구려비 판독", issued: { year: 1984 } })
    );
  });

  it("한국어·서양어 인용 형식과 목록 정렬", () => {
    const entries = parseBibtex(bib).entries;
    expect(formatCitation(entries[1]!)).toBe("이순신, 「고구려 금석문 연구」, 서울대학교 박사학위논문, 2020.");
    const west = { ...entries[0]!, title: "Reading the Chungju Stele", language: "en", author: [{ family: "Kim", given: "Minsu" }], containerTitle: "Korea Journal" };
    expect(formatCitation(west, "15")).toBe('Kim, Minsu. "Reading the Chungju Stele." Korea Journal 38 (1984): 15.');
    const list = formatBibliographyList([west, entries[1]!, entries[0]!]);
    expect(list[list.length - 1]).toContain("Kim, Minsu");
    expect(list[0]).toContain("이순신");
  });
});
