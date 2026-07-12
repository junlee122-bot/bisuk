/**
 * 자동 LOD 선택 — 화면 공간 크기(screen-space size) + 히스테리시스.
 * 순수 함수: 렌더러·three.js 의존 없음 (단위 테스트 대상).
 *
 * 원칙 (portfolio-polish P1):
 * - 카메라가 가까워질수록 LOD가 낮아지는 일은 없다 (화면 크기 단조성).
 * - 경계에서 진동하지 않도록 승급/강등 임계값을 분리한다(히스테리시스 밴드).
 * - 정사영은 zoom(px per world unit) 기준으로 동일 규칙을 적용한다.
 * - 선택 글자에 접근(글자 포커스)한 경우 FULL을 우선한다.
 */

export type LodLevel = "PREVIEW" | "MEDIUM" | "FULL";

export interface AutoLodInput {
  /** 현재 적용 중인 LOD — 히스테리시스 기준점 */
  currentLod: LodLevel;
  projection: "perspective" | "orthographic";
  /** 카메라→모델 중심 거리 (world) — perspective에서 사용 */
  distance: number;
  /** 수직 fov(deg) — perspective에서 사용 */
  fovDeg: number;
  /** 뷰포트 높이(px) */
  viewportHeightPx: number;
  /** 모델 높이 (world) */
  modelHeight: number;
  /** 정사영 zoom (px per world unit) — orthographic에서 사용 */
  orthoZoom?: number;
  /** 선택 글자 포커스 중 — FULL 우선 */
  glyphFocused?: boolean;
}

/** 모델이 화면에서 차지하는 세로 픽셀 수 (근사) */
export function screenSpaceHeightPx(input: AutoLodInput): number {
  if (input.projection === "orthographic") {
    return input.modelHeight * Math.max(0, input.orthoZoom ?? 0);
  }
  const dist = Math.max(1e-6, input.distance);
  const halfFov = (Math.max(1, input.fovDeg) * Math.PI) / 360;
  const visibleWorldHeight = 2 * dist * Math.tan(halfFov);
  return (input.modelHeight / visibleWorldHeight) * input.viewportHeightPx;
}

/** 승급(enter) 임계값 — 이 픽셀 크기를 넘으면 해당 LOD로 올라간다 */
export const LOD_ENTER_PX: Record<Exclude<LodLevel, "PREVIEW">, number> = {
  MEDIUM: 420,
  FULL: 1250,
};
/** 강등(exit) 임계값 — 이 아래로 내려가야 해당 LOD를 떠난다 (enter보다 낮음) */
export const LOD_EXIT_PX: Record<Exclude<LodLevel, "PREVIEW">, number> = {
  MEDIUM: 320,
  FULL: 980,
};

const RANK: Record<LodLevel, number> = { PREVIEW: 0, MEDIUM: 1, FULL: 2 };

/**
 * 다음 LOD 결정.
 * - 목표 LOD(임계값 기준)가 현재보다 높으면 즉시 승급.
 * - 낮으면 exit 임계값 아래로 내려갔을 때만 강등 (히스테리시스).
 */
export function chooseLodLevel(input: AutoLodInput): LodLevel {
  if (input.glyphFocused) return "FULL";
  const px = screenSpaceHeightPx(input);

  // enter 기준 목표 LOD
  const target: LodLevel =
    px >= LOD_ENTER_PX.FULL ? "FULL" : px >= LOD_ENTER_PX.MEDIUM ? "MEDIUM" : "PREVIEW";

  if (RANK[target] >= RANK[input.currentLod]) return target;

  // 강등 후보 — exit 임계값으로만 판단
  if (input.currentLod === "FULL") {
    if (px >= LOD_EXIT_PX.FULL) return "FULL";
    return px >= LOD_ENTER_PX.MEDIUM ? "MEDIUM" : px >= LOD_EXIT_PX.MEDIUM ? "MEDIUM" : "PREVIEW";
  }
  if (input.currentLod === "MEDIUM") {
    return px >= LOD_EXIT_PX.MEDIUM ? "MEDIUM" : "PREVIEW";
  }
  return "PREVIEW";
}
