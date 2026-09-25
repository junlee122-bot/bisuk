import { describe, expect, it } from "vitest";
import type { GlyphCell, Reading } from "@seokmun/types";
import { buildReadingComparison, exportReadingComparisonCsv, formatReadingToken } from "../src/readingTable";

function cell(id: string, line: number, seq: number, adopted: string | null = null): GlyphCell {
  return {
    id, steleTabId: "t", faceId: "front", lineIndex: line, sequenceIndex: seq,
    bbox2d: [0, 0, 0.1, 0.1], observabilityScore: 0.5, damageGrade: 2, readingStatus: "UNKNOWN",
    acceptedCandidateId: null, publishedReading: null, featureVector: [], strokes: null,
    strokeProvenance: null, adoptedReadingId: adopted, bboxAssetId: null, note: "", version: 1,
  };
}

function rdg(id: string, cellId: string, label: string, reading: string | null, extra: Partial<Reading> = {}): Reading {
  return {
    id, glyphCellId: cellId, steleTabId: "t", readingKind: reading ? "CHARACTER" : "LACUNA", reading,
    variantForm: null, certainty: "PROBABLE", confidence: null, rationale: "", supplied: false, unclear: false,
    sourceType: "PUBLISHED_EDITION", sourceLabel: label, bibliographyId: null, citationLocator: "",
    authorId: "u", authorName: "u", reviewStatus: "ACCEPTED", reviewerId: null, reviewerName: null,
    reviewedAt: null, reviewNote: "", version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...extra,
  };
}

describe("판독자별 비교표", () => {
  it("출전별 열, 일치·불일치, 연구실 채택 표시", () => {
    const cells = [cell("c1", 1, 1), cell("c2", 1, 2, "r5")];
    const readings = [
      rdg("r1", "c1", "갑 1979", "王"),
      rdg("r2", "c1", "을 1985", "王"),
      rdg("r3", "c2", "갑 1979", "安"),
      rdg("r4", "c2", "을 1985", "守", { unclear: true }),
      rdg("r5", "c2", "연구실", "安", { sourceType: "RESEARCHER", supplied: true }),
      rdg("r6", "c2", "기각안", "家", { sourceType: "RESEARCHER", reviewStatus: "REJECTED" }),
    ];
    const t = buildReadingComparison(cells, readings, { faceLabels: { front: "앞면" } });
    expect(t.columns.map((c) => c.label)).toEqual(["갑 1979", "을 1985", "연구실"]);
    expect(t.rows[0]!.consensus).toBe("王");
    expect(t.rows[0]!.disagreement).toBe(false);
    expect(t.rows[1]!.disagreement).toBe(true);
    expect(t.rows[1]!.values["PUBLISHED_EDITION:을 1985"]).toBe("守?");
    expect(t.rows[1]!.adopted).toBe("[安]");
    const csv = exportReadingComparisonCsv(t);
    expect(csv.startsWith("﻿면,행,자,갑 1979,을 1985,연구실,일치,연구실 채택")).toBe(true);
    expect(csv).toContain("앞면,1,2,安,守?,[安],불일치,[安]");
  });

  it("Leiden-lite 토큰", () => {
    expect(formatReadingToken({ readingKind: "LACUNA", reading: null, variantForm: null, supplied: false, unclear: false })).toBe("□");
    expect(formatReadingToken({ readingKind: "ILLEGIBLE", reading: null, variantForm: null, supplied: false, unclear: false })).toBe("[?]");
    expect(formatReadingToken({ readingKind: "CHARACTER", reading: "大", variantForm: "太", supplied: true, unclear: true })).toBe("[大(太)?]");
  });
});
