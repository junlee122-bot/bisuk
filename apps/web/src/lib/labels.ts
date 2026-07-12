import type { AssetMode, RightsState } from "@seokmun/types";

/**
 * 상태 라벨 인간화 — 화면에는 사람이 읽는 한국어를 앞세우고,
 * 원문 enum은 괄호·툴팁으로 보존한다 (감사·테스트·API 대조용).
 */

export const RIGHTS_LABEL: Record<RightsState, string> = {
  UNKNOWN: "권리 미상",
  VERIFY_REQUIRED: "출처 확인 필요",
  VERIFY_PER_ASSET: "항목별 확인 필요",
  METADATA_ONLY: "메타데이터만",
  VIEW_ONLY: "열람 전용",
  RESEARCH_ONLY: "연구 이용 한정",
  NONCOMMERCIAL: "비상업 한정",
  ATTRIBUTION_REQUIRED: "출처 표기 필요",
  DERIVATIVES_PROHIBITED: "2차 가공 금지",
  OPEN_FOR_REUSE: "재사용 허용",
  INTERNAL_RESTRICTED: "내부 열람 한정",
  NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED: "확인 전 이미지 재배포 금지",
  KOGL_TYPE_4_OR_ITEM_SPECIFIC: "공공누리 4유형·항목별 조건",
};

export const ASSET_MODE_LABEL: Record<AssetMode, string> = {
  MESH_3D: "3D 메시",
  POINT_CLOUD: "점군",
  RTI_SET: "RTI 세트",
  IMAGE_SET: "이미지 세트",
  RUBBING: "탁본",
  ORTHOPHOTO: "정사 영상",
  PDF_ONLY: "PDF만",
  TRANSCRIPTION_ONLY: "판독문만",
  METADATA_ONLY: "메타데이터만",
  FRAGMENT_SET: "조각 모음",
  MIXED: "혼합",
};

/** 파생 계층 라벨 (portfolio-polish §1.1) */
export const PROVENANCE_LABEL: Record<string, string> = {
  MEASURED: "측정 가능",
  DERIVED: "원본 기반 파생",
  PRESENTATION_ENHANCED: "전시 표현 보강",
  GENERATED_VISUAL_ONLY: "표시 전용(생성)",
  PRESENTATION_STAGE_ONLY: "무대 연출 전용",
};

export function rightsLabel(state: RightsState): string {
  return RIGHTS_LABEL[state] ?? state;
}
