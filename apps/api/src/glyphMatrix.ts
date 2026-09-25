import { MODEL_VERSION, type GlyphMatrixResponse } from "@seokmun/types";
import { jitterPolylines, observedPolylines, strokeSetSimilarity } from "@seokmun/engine";
import type { Db } from "./db";
import { glyphCells, steleTabs } from "./repo";
import { sanitizeCell } from "./sanitize";

/**
 * Glyph Matrix — 선택 셀마다, 비교 탭에서 관측 획이 가장 비슷한 셀 1개를 찾는다.
 * 호출 전에 셀·탭 존재와 접근 권한을 확인해야 한다.
 */
export function computeGlyphMatrix(
  db: Db,
  glyphCellIds: string[],
  tabIds: string[]
): { rows: GlyphMatrixResponse["rows"]; researchSetId: string } {
  const rows: GlyphMatrixResponse["rows"] = [];
  let researchSetId = "";
  for (const cellId of glyphCellIds) {
    const stored = glyphCells.get(db, cellId);
    if (!stored) continue;
    const sourceTab = steleTabs.get(db, stored.entity.steleTabId);
    if (!sourceTab) continue;
    researchSetId = sourceTab.researchSetId;
    const sourceObserved = stored.entity.strokes
      ? jitterPolylines(
          observedPolylines(stored.entity.strokes),
          stored.extra.styleJitter ?? 0,
          stored.entity.id
        )
      : [];
    const columns: GlyphMatrixResponse["rows"][number]["columns"] = [];
    for (const tabId of tabIds) {
      const tab = steleTabs.get(db, tabId);
      if (!tab) continue;
      const tabCells = glyphCells.listByTab(db, tabId);
      if (tabId === stored.entity.steleTabId) {
        columns.push({
          tab,
          cells: [
            {
              glyphCell: sanitizeCell(stored),
              match: null,
              publishedReading: stored.entity.publishedReading,
              dataProvenance: stored.extra.seedKey ? "VIRTUAL_DEMO" : "REAL_USER_UPLOAD",
            },
          ],
        });
        continue;
      }
      let best: { cell: (typeof tabCells)[number]; score: number } | null = null;
      for (const candidate of tabCells) {
        if (!candidate.entity.strokes) continue;
        const candObserved = jitterPolylines(
          observedPolylines(candidate.entity.strokes),
          candidate.extra.styleJitter ?? 0,
          candidate.entity.id
        );
        if (sourceObserved.length === 0 || candObserved.length === 0) continue;
        const score = strokeSetSimilarity(sourceObserved, candObserved);
        if (!best || score > best.score) best = { cell: candidate, score };
      }
      if (!best || best.score < 0.2) {
        columns.push({
          tab,
          cells: [{ glyphCell: null, match: null, publishedReading: null, dataProvenance: "NONE" }],
        });
        continue;
      }
      columns.push({
        tab,
        cells: [
          {
            glyphCell: sanitizeCell(best.cell),
            match: {
              id: `mx-${cellId}-${best.cell.entity.id}`,
              sourceGlyphCellId: cellId,
              targetGlyphCellId: best.cell.entity.id,
              targetSteleTabId: tabId,
              matchType: "SIMILAR_FORM",
              visualScore: Math.round(best.score * 1000) / 1000,
              geometryScore: 0,
              strokeScore: 0,
              scriptScore: 0,
              periodScore: 0,
              contextScore: 0,
              combinedScore: Math.round(best.score * 1000) / 1000,
              normalizationMethod: "stroke-set-similarity",
              modelVersion: MODEL_VERSION,
              createdAt: new Date().toISOString(),
            },
            publishedReading: best.cell.entity.publishedReading,
            dataProvenance: best.cell.extra.seedKey ? "VIRTUAL_DEMO" : "REAL_USER_UPLOAD",
          },
        ],
      });
    }
    rows.push({ sourceGlyphCell: sanitizeCell(stored), sourceTab, columns });
  }
  return { rows, researchSetId };
}
