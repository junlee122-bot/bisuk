/**
 * 판독자별 비교표 — 셀마다 출전(판독자·출판 판독문)별 판독을 나란히 놓고
 * 일치·불일치를 표시한다. 한국 금석문 연구의 기본 산출물.
 */
import type { GlyphCell, Reading } from "@seokmun/types";

export interface ReadingComparisonColumn {
  key: string;
  label: string;
  sourceType: Reading["sourceType"];
}

export interface ReadingComparisonRow {
  cellId: string;
  faceId: string;
  faceLabel: string;
  lineIndex: number;
  sequenceIndex: number;
  /** 열 key → 표기 (예: "安", "[安]", "安?", "□", "[?]") */
  values: Record<string, string>;
  /** 모든 출전이 같은 글자면 그 글자, 아니면 null */
  consensus: string | null;
  disagreement: boolean;
  adoptedReadingId: string | null;
  adopted: string | null;
}

/** Leiden-lite 표기 */
export function formatReadingToken(r: Pick<Reading, "readingKind" | "reading" | "variantForm" | "supplied" | "unclear">): string {
  if (r.readingKind === "LACUNA") return "□";
  if (r.readingKind === "ILLEGIBLE") return "[?]";
  let t = r.reading ?? "?";
  if (r.variantForm && r.variantForm !== r.reading) t = `${t}(${r.variantForm})`;
  if (r.unclear) t = `${t}?`;
  if (r.supplied) t = `[${t}]`;
  return t;
}

function columnKey(r: Reading): string {
  return `${r.sourceType}:${r.sourceLabel || r.authorName}`;
}

export function buildReadingComparison(
  cells: GlyphCell[],
  readings: Reading[],
  opts: { faceLabels?: Record<string, string>; includeRejected?: boolean } = {}
): { columns: ReadingComparisonColumn[]; rows: ReadingComparisonRow[] } {
  const usable = readings.filter(
    (r) => opts.includeRejected || (r.reviewStatus !== "REJECTED" && r.reviewStatus !== "SUPERSEDED" && r.reviewStatus !== "DRAFT")
  );
  const cols = new Map<string, ReadingComparisonColumn>();
  // 출판 판독문 → 연구원 → 자동 분석 순, 같은 유형은 라벨 가나다순
  const typeOrder: Record<string, number> = { PUBLISHED_EDITION: 0, RESEARCHER: 1, AUTO_ANALYSIS: 2 };
  for (const r of usable) {
    const key = columnKey(r);
    if (!cols.has(key)) cols.set(key, { key, label: r.sourceLabel || r.authorName, sourceType: r.sourceType });
  }
  const columns = [...cols.values()].sort(
    (a, b) => (typeOrder[a.sourceType] ?? 9) - (typeOrder[b.sourceType] ?? 9) || a.label.localeCompare(b.label, "ko")
  );
  const byCell = new Map<string, Reading[]>();
  for (const r of usable) {
    const list = byCell.get(r.glyphCellId) ?? [];
    list.push(r);
    byCell.set(r.glyphCellId, list);
  }
  const allById = new Map(readings.map((r) => [r.id, r]));
  const sorted = [...cells].sort(
    (a, b) =>
      a.faceId.localeCompare(b.faceId) || a.lineIndex - b.lineIndex || a.sequenceIndex - b.sequenceIndex
  );
  const rows: ReadingComparisonRow[] = sorted.map((cell) => {
    const rs = byCell.get(cell.id) ?? [];
    const values: Record<string, string> = {};
    // 같은 열에 여러 판독이 있으면 최신 것
    for (const r of [...rs].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))) {
      values[columnKey(r)] = formatReadingToken(r);
    }
    const chars = new Set(
      rs.map((r) => (r.readingKind === "CHARACTER" ? (r.reading ?? "?") : r.readingKind))
    );
    const adopted = cell.adoptedReadingId ? allById.get(cell.adoptedReadingId) : undefined;
    return {
      cellId: cell.id,
      faceId: cell.faceId,
      faceLabel: opts.faceLabels?.[cell.faceId] ?? cell.faceId,
      lineIndex: cell.lineIndex,
      sequenceIndex: cell.sequenceIndex,
      values,
      consensus: chars.size === 1 && rs.length > 0 ? [...chars][0]! : null,
      disagreement: chars.size > 1,
      adoptedReadingId: cell.adoptedReadingId,
      adopted: adopted ? formatReadingToken(adopted) : null,
    };
  });
  return { columns, rows };
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 판독자별 비교표 CSV (UTF-8 BOM — 한국어 Excel 호환) */
export function exportReadingComparisonCsv(table: {
  columns: ReadingComparisonColumn[];
  rows: ReadingComparisonRow[];
}): string {
  const header = ["면", "행", "자", ...table.columns.map((c) => c.label), "일치", "연구실 채택"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of table.rows) {
    lines.push(
      [
        r.faceLabel,
        String(r.lineIndex),
        String(r.sequenceIndex),
        ...table.columns.map((c) => r.values[c.key] ?? ""),
        r.disagreement ? "불일치" : r.consensus ? "일치" : "",
        r.adopted ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
