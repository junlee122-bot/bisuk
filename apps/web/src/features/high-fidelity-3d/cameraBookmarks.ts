"use client";

import type { GlyphCell } from "@seokmun/types";
import type { SlabParams } from "./geometryClient";

export type BookmarkName =
  | "HERO_THREE_QUARTER"
  | "FRONT_INSCRIPTION"
  | "SIDE_DEPTH"
  | "DETAIL_SELECTED_GLYPH"
  | "FULL_ARTIFACT";

export interface BookmarkPose {
  position: [number, number, number];
  target: [number, number, number];
}

export const BOOKMARK_LABEL: Record<BookmarkName, string> = {
  HERO_THREE_QUARTER: "전체 보기",
  FRONT_INSCRIPTION: "정면 보기",
  SIDE_DEPTH: "측면 깊이",
  DETAIL_SELECTED_GLYPH: "선택 글자",
  FULL_ARTIFACT: "유물 전신",
};

export const BOOKMARK_ORDER: BookmarkName[] = [
  "HERO_THREE_QUARTER",
  "FRONT_INSCRIPTION",
  "SIDE_DEPTH",
  "DETAIL_SELECTED_GLYPH",
  "FULL_ARTIFACT",
];

/**
 * 프레젠테이션 카메라 북마크 — 모델 파라미터에서 결정적으로 계산.
 * 모두 near plane 여유(≥0.4)와 모델 비관통을 만족하는 외부 시점.
 */
export function bookmarkPose(
  name: BookmarkName,
  params: SlabParams,
  cells: GlyphCell[],
  selectedId: string | null
): BookmarkPose {
  const h = params.height;
  const d = params.depth;
  switch (name) {
    case "HERO_THREE_QUARTER":
      return { position: [1.7, -0.12, 4.55], target: [0, 0.05, 0] };
    case "FRONT_INSCRIPTION":
      return { position: [0, 0, d / 2 + 4.1], target: [0, 0, 0] };
    case "SIDE_DEPTH":
      return { position: [3.3, 0.2, 1.15], target: [0, 0, 0] };
    case "FULL_ARTIFACT":
      return { position: [0.7, 0.55, h * 2.9], target: [0, 0, 0] };
    case "DETAIL_SELECTED_GLYPH": {
      const cell = cells.find((c) => c.id === selectedId) ?? cells[0];
      if (!cell) return { position: [0.2, 0.2, 1.2], target: [0, 0.2, 0] };
      const [bx, by, bw, bh] = cell.bbox2d;
      const cx = (bx + bw / 2 - 0.5) * params.width;
      const cy = (0.5 - (by + bh / 2)) * params.height;
      const cz = d / 2;
      const dist = Math.max(0.45, Math.max(bw * params.width, bh * params.height) * 2.6);
      return {
        position: [cx + dist * 0.25, cy + dist * 0.1, cz + dist],
        target: [cx, cy, cz],
      };
    }
  }
}
