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

const MUSEUM_AZIMUTH = Math.atan2(1.7, 4.55);
const CAMERA_FRAME_MARGIN = 1.3;

function fittedDistance(
  params: SlabParams,
  aspect = 1,
  fovDeg = 32,
  margin = CAMERA_FRAME_MARGIN
): number {
  const safeAspect = Math.max(0.5, aspect);
  const frameHeight = Math.max(params.height, params.width / safeAspect);
  const halfFov = (fovDeg * Math.PI) / 360;
  return (frameHeight / 2 / Math.tan(halfFov)) * margin + params.depth / 2;
}

/** 모델 bounds와 실제 캔버스 비율에 맞춘 박물관 3/4 기본 구도. */
export function museumHeroPose(
  params: SlabParams,
  aspect = 1,
  fovDeg = 32
): BookmarkPose {
  const distance = fittedDistance(params, aspect, fovDeg);
  const targetY = params.height * 0.015;
  return {
    position: [
      Math.sin(MUSEUM_AZIMUTH) * distance,
      targetY - params.height * 0.06,
      Math.cos(MUSEUM_AZIMUTH) * distance,
    ],
    target: [0, targetY, 0],
  };
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
  selectedId: string | null,
  aspect = 1
): BookmarkPose {
  const h = params.height;
  const d = params.depth;
  const fit = fittedDistance(params, aspect);
  const targetY = h * 0.015;
  switch (name) {
    case "HERO_THREE_QUARTER":
      return museumHeroPose(params, aspect);
    case "FRONT_INSCRIPTION":
      return { position: [0, targetY, d / 2 + fit], target: [0, targetY, 0] };
    case "SIDE_DEPTH":
      return {
        position: [Math.sin(1.1) * fit, targetY, Math.cos(1.1) * fit],
        target: [0, targetY, 0],
      };
    case "FULL_ARTIFACT":
      return { position: [fit * 0.12, targetY + h * 0.08, fit * 1.12], target: [0, targetY, 0] };
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
