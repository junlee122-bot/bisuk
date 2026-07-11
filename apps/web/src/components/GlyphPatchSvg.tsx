"use client";

import type { GlyphCell } from "@seokmun/types";
import { jitterPolylines, polylinesToSvgPath } from "@seokmun/engine";

/**
 * 가상 글리프 패치 렌더러 — 관측 획은 실선, 마모 획은 점선 유령획으로 표시해
 * 관측과 추정을 시각적으로 구분한다.
 */
export function GlyphPatchSvg({
  cell,
  size = 64,
  styleJitter = 0,
  selected = false,
}: {
  cell: GlyphCell;
  size?: number;
  styleJitter?: number;
  selected?: boolean;
}) {
  if (!cell.strokes) {
    return (
      <div
        className="panel flex items-center justify-center text-lg"
        style={{ width: size, height: size }}
        title="획 정보 없음 — 판독문 문자"
      >
        {cell.publishedReading ?? "?"}
      </div>
    );
  }
  const eroded = new Set(cell.strokes.erodedStrokeIndexes);
  const observed = cell.strokes.polylines.filter((_, i) => !eroded.has(i));
  const erodedLines = cell.strokes.polylines.filter((_, i) => eroded.has(i));
  const observedPath = polylinesToSvgPath(
    jitterPolylines(observed, styleJitter, cell.id)
  );
  const erodedPath = polylinesToSvgPath(
    jitterPolylines(erodedLines, styleJitter, cell.id)
  );
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={`문자 셀 ${cell.id} (가상 데모 자형)`}
      style={{
        background: "#26262e",
        borderRadius: 6,
        border: selected ? "2px solid var(--accent)" : "1px solid #3a3a44",
      }}
    >
      <rect x="0" y="0" width="100" height="100" fill="#2b2b33" rx="6" />
      {cell.damageGrade >= 3 && (
        <rect x="0" y="0" width="100" height="100" fill="#1c1c22" opacity="0.5" rx="6" />
      )}
      {erodedPath && (
        <path
          d={erodedPath}
          stroke="#6d6152"
          strokeWidth="4"
          strokeDasharray="5 6"
          fill="none"
          strokeLinecap="round"
          opacity="0.55"
        />
      )}
      {observedPath && (
        <path
          d={observedPath}
          stroke="#e8e0d0"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
