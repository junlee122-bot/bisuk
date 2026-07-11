/**
 * 시드 JSON → 엔터티 변환 (순수 함수 — fs 접근 없음).
 * data/seed/demo-glyphs.json 의 가상 글리프 정의를 GlyphCell 로 변환한다.
 * hidden=true 셀은 벤치마크 대상이며 publishedReading 을 노출하지 않는다.
 */
import type { GlyphCell, GlyphStrokes, ReadingStatus } from "@seokmun/types";
import { featureVector, observedPolylines, type Polyline } from "./glyphFeatures";
import type { PipelineGlyphCell, PipelineTab } from "./pipeline";

export interface SeedGlyphCellJson {
  id: string;
  steleTabId: string;
  faceId: string;
  lineIndex: number;
  sequenceIndex: number;
  char: string;
  hidden?: boolean;
  erodedStrokeIndexes?: number[];
  observabilityScore: number;
  damageGrade: number;
  readingStatus: string;
  styleJitter?: number;
}

export type SeedPriors = Record<string, { polylines: Array<Array<[number, number]>> }>;

/**
 * 세로쓰기 배치 — line은 열(오른쪽→왼쪽), sequence는 행(위→아래).
 * 정규화된 면 좌표 [x, y, w, h] (0~1) 반환.
 */
export function layoutGlyphBBox(
  lineIndex: number,
  sequenceIndex: number,
  maxLines: number,
  maxSeq: number
): [number, number, number, number] {
  const colWidth = 0.8 / Math.max(1, maxLines);
  const rowHeight = 0.86 / Math.max(1, maxSeq);
  const cellW = Math.min(colWidth * 0.82, 0.22);
  const cellH = Math.min(rowHeight * 0.82, 0.13);
  const x = 0.9 - lineIndex * colWidth + (colWidth - cellW) / 2;
  const y = 0.06 + (sequenceIndex - 1) * rowHeight + (rowHeight - cellH) / 2;
  return [
    Math.round(x * 1000) / 1000,
    Math.round(y * 1000) / 1000,
    Math.round(cellW * 1000) / 1000,
    Math.round(cellH * 1000) / 1000,
  ];
}

export function buildGlyphCellEntity(
  json: SeedGlyphCellJson,
  priors: SeedPriors,
  maxLines: number,
  maxSeq: number
): GlyphCell {
  const prior = priors[json.char];
  const strokes: GlyphStrokes | null = prior
    ? {
        polylines: prior.polylines.map((l) => l.map((p) => [...p] as [number, number])),
        erodedStrokeIndexes: json.erodedStrokeIndexes ?? [],
      }
    : null;
  const observed: Polyline[] = strokes ? observedPolylines(strokes) : [];
  return {
    id: json.id,
    steleTabId: json.steleTabId,
    faceId: json.faceId,
    lineIndex: json.lineIndex,
    sequenceIndex: json.sequenceIndex,
    bbox2d: layoutGlyphBBox(json.lineIndex, json.sequenceIndex, maxLines, maxSeq),
    observabilityScore: json.observabilityScore,
    damageGrade: json.damageGrade,
    readingStatus: json.readingStatus as ReadingStatus,
    acceptedCandidateId: null,
    publishedReading: json.hidden ? null : json.char,
    featureVector: featureVector(observed).map((v) => Math.round(v * 10000) / 10000),
    strokes,
    version: 1,
  };
}

export function toPipelineCell(
  entity: GlyphCell,
  styleJitter: number | undefined
): PipelineGlyphCell {
  return {
    id: entity.id,
    steleTabId: entity.steleTabId,
    lineIndex: entity.lineIndex,
    sequenceIndex: entity.sequenceIndex,
    observabilityScore: entity.observabilityScore,
    damageGrade: entity.damageGrade,
    readingStatus: entity.readingStatus,
    publishedReading: entity.publishedReading,
    strokes: entity.strokes,
    ...(styleJitter !== undefined ? { styleJitter } : {}),
  };
}

export function inferScriptFamily(periodEstimate: string): PipelineTab["scriptFamily"] {
  if (periodEstimate.includes("고구려")) return "GOGURYEO";
  if (periodEstimate.includes("신라")) return "SILLA";
  return "OTHER";
}
