import { z } from "zod";

/** 탭 역할 — PRD §2.3 */
export const TabRole = z.enum([
  "PRIMARY",
  "BENCHMARK",
  "COMPARATIVE",
  "FRONTIER",
  "REFERENCE_ONLY",
  "FRAGMENT_SET",
  "WATCHLIST",
]);
export type TabRole = z.infer<typeof TabRole>;

/** 자산 모드 — PRD §2.4. 모든 탭에 3D를 요구하지 않는다. */
export const AssetMode = z.enum([
  "MESH_3D",
  "POINT_CLOUD",
  "RTI_SET",
  "IMAGE_SET",
  "RUBBING",
  "ORTHOPHOTO",
  "PDF_ONLY",
  "TRANSCRIPTION_ONLY",
  "METADATA_ONLY",
  "FRAGMENT_SET",
  "MIXED",
]);
export type AssetMode = z.infer<typeof AssetMode>;

/** 자산 파일 유형 */
export const AssetType = z.enum([
  "MESH",
  "POINT_CLOUD",
  "IMAGE",
  "RUBBING",
  "RTI",
  "PDF",
  "TRANSCRIPTION",
  "METADATA",
]);
export type AssetType = z.infer<typeof AssetType>;

/**
 * 자료 실측/가상 구분.
 * VIRTUAL_DEMO 자산은 UI에서 항상 가상 표시를 유지해야 하며
 * 실제 유물 데이터로 표기해서는 안 된다.
 */
export const DataProvenance = z.enum([
  "VIRTUAL_DEMO",
  "REAL_METADATA",
  "REAL_USER_UPLOAD",
]);
export type DataProvenance = z.infer<typeof DataProvenance>;

/** 자산 권리 상태 — PRD §15.3 */
export const RightsState = z.enum([
  "UNKNOWN",
  "VERIFY_REQUIRED",
  "VERIFY_PER_ASSET",
  "METADATA_ONLY",
  "VIEW_ONLY",
  "RESEARCH_ONLY",
  "NONCOMMERCIAL",
  "ATTRIBUTION_REQUIRED",
  "DERIVATIVES_PROHIBITED",
  "OPEN_FOR_REUSE",
  "INTERNAL_RESTRICTED",
  "NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED",
  "KOGL_TYPE_4_OR_ITEM_SPECIFIC",
]);
export type RightsState = z.infer<typeof RightsState>;

/** 문자 판독 상태 — PRD §15.1 */
export const ReadingStatus = z.enum([
  "OBSERVED",
  "PARTIALLY_OBSERVED",
  "VISUAL_RECONSTRUCTION",
  "TEXTUAL_SUPPLEMENT",
  "CROSS_STELE_SUPPORTED",
  "MULTI_SOURCE_AUTOMATIC",
  "CONFLICTING",
  "UNKNOWN",
  "ILLEGIBLE",
]);
export type ReadingStatus = z.infer<typeof ReadingStatus>;

/** 역사 주장 상태 — PRD §15.2 */
export const ClaimStatus = z.enum([
  "PROPOSED",
  "SUPPORTED",
  "STRONGLY_SUPPORTED",
  "CONTESTED",
  "WEAKENED",
  "REJECTED",
  "UNTESTABLE",
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

/** 연구 성숙도 상태 — PRD §4.1 + 매니페스트 initial_status */
export const ResearchMaturityStatus = z.enum([
  "DISCOVERY_REPORT_ONLY",
  "PRELIMINARY_READING",
  "BASIC_REPORT_AVAILABLE",
  "MULTIPLE_READINGS",
  "DIGITAL_DATA_AVAILABLE",
  "PEER_REVIEWED_RESEARCH",
  "MULTI_TEAM_REPLICATION",
  "MATURE_BUT_CONTESTED",
  "MATURE_AND_STABLE",
  "SOURCE_METADATA_READY",
  "METADATA_AND_LITERATURE_READY",
  "INSTITUTION_CONFIRMED",
]);
export type ResearchMaturityStatus = z.infer<typeof ResearchMaturityStatus>;

/** Frontier Watch 상태 전이 — PRD §9.2 */
export const FrontierStatus = z.enum([
  "NEWS_MENTION",
  "INSTITUTION_CONFIRMED",
  "PRELIMINARY_READING",
  "DATA_REQUESTED",
  "BASIC_REPORT",
  "OPEN_DATA_AVAILABLE",
  "MULTIPLE_STUDIES",
  "STABLE_REFERENCE",
  "CONTESTED_REFERENCE",
]);
export type FrontierStatus = z.infer<typeof FrontierStatus>;

/** Decision Gate 결과 */
export const DecisionOutcome = z.enum([
  "AUTO_ACCEPTED",
  "CONFLICTING",
  "TEXTUAL_SUPPLEMENT",
  "UNKNOWN",
  "ILLEGIBLE",
]);
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;

/** 문헌 신뢰 계층 — PRD §8.2 (1이 최상위) */
export const ReliabilityTier = z.number().int().min(1).max(7);
export type ReliabilityTier = z.infer<typeof ReliabilityTier>;

/** Claim Matrix 셀 상태 — PRD §6.4 */
export const ClaimCellState = z.enum([
  "SUPPORTS",
  "WEAKLY_SUPPORTS",
  "NEUTRAL",
  "WEAKLY_CONTRADICTS",
  "CONTRADICTS",
  "NOT_APPLICABLE",
  "UNVERIFIED_CITATION",
]);
export type ClaimCellState = z.infer<typeof ClaimCellState>;

/** 근거 종류 */
export const EvidenceKind = z.enum(["SUPPORT", "COUNTER"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/** 자산 처리 상태 */
export const ProcessingStatus = z.enum([
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;
