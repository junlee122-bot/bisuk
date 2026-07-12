import { z } from "zod";
import {
  AssetMode,
  AssetType,
  ClaimCellState,
  DataProvenance,
  DecisionOutcome,
  EvidenceKind,
  FrontierStatus,
  ProcessingStatus,
  ReadingStatus,
  ResearchMaturityStatus,
  RightsState,
  TabRole,
} from "./enums";

/** 탭별 UI 상태 — 새로고침 후 복원 대상 (PRD §0.3 + 3D 업그레이드 §11.1) */
export const TabUiState = z.object({
  camera: z
    .object({
      position: z.tuple([z.number(), z.number(), z.number()]),
      target: z.tuple([z.number(), z.number(), z.number()]),
    })
    .nullable()
    .default(null),
  activeFaceId: z.string().nullable().default(null),
  activeGlyphCellId: z.string().nullable().default(null),
  renderMode: z
    .enum(["ALBEDO", "RAKING_LIGHT", "NORMAL", "CURVATURE", "DEPTH"])
    .default("ALBEDO"),
  zoomLevel: z.number().default(1),
  selectedCandidateId: z.string().nullable().default(null),
  literatureQuery: z.string().default(""),
  lodLevel: z.enum(["PREVIEW", "MEDIUM", "FULL", "AUTO"]).default("MEDIUM"),
  // ── 3D 업그레이드 렌더 상태 ──
  representation: z
    .enum(["RESEARCH_EVIDENCE", "PBR_PRESENTATION", "UNLIT_ORIGINAL", "SPLAT", "POINT_CLOUD"])
    .default("PBR_PRESENTATION"),
  lightingPreset: z
    .enum(["MUSEUM_NEUTRAL", "FIELD_DAYLIGHT", "LABORATORY_NEUTRAL", "RAKING", "SWEEP", "UNLIT_ALBEDO"])
    .default("MUSEUM_NEUTRAL"),
  lightAzimuthDeg: z.number().default(105),
  lightElevationDeg: z.number().default(12),
  exposure: z.number().default(1),
  aoStrength: z.number().min(0).max(2).default(0.6),
  cameraMode: z
    .enum(["PERSPECTIVE_MUSEUM", "ORTHOGRAPHIC_RESEARCH", "FRONT_ELEVATION", "GLYPH_FOCUS"])
    .default("PERSPECTIVE_MUSEUM"),
  qualityTier: z
    .enum(["AUTO", "ULTRA", "HIGH", "BALANCED", "MOBILE", "BATTERY_SAVER"])
    .default("AUTO"),
  activeVariantId: z.string().nullable().default(null),
  lastSavedAt: z.string().nullable().default(null),
});
export type TabUiState = z.infer<typeof TabUiState>;

export const ResearchSet = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  researchQuestion: z.string().default(""),
  periodRange: z.string().default(""),
  regions: z.array(z.string()).default([]),
  scripts: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  visibility: z.enum(["PRIVATE", "SHARED", "PUBLIC"]).default("PRIVATE"),
  activeTabOrder: z.array(z.string()).default([]),
  activeTabId: z.string().nullable().default(null),
  pinnedTabIds: z.array(z.string()).default([]),
  rightsPolicy: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ResearchSet = z.infer<typeof ResearchSet>;

export const MaturityScores = z.object({
  sourceScore: z.number().min(0).max(100),
  geometryScore: z.number().min(0).max(100),
  imageScore: z.number().min(0).max(100),
  transcriptionScore: z.number().min(0).max(100),
  bibliographyScore: z.number().min(0).max(100),
  independentTeamScore: z.number().min(0).max(100),
  chronologyConsensusScore: z.number().min(0).max(100),
  purposeConsensusScore: z.number().min(0).max(100),
  openDataScore: z.number().min(0).max(100),
  rightsClarityScore: z.number().min(0).max(100),
});
export type MaturityScores = z.infer<typeof MaturityScores>;

export const FrontierSignals = z.object({
  unresolvedCharacterRatio: z.number().min(0).max(1),
  historicalImportance: z.number().min(0).max(1),
  discoveryRecency: z.number().min(0).max(1),
  missingContextScore: z.number().min(0).max(1),
  dataScarcity: z.number().min(0).max(1),
  disagreementScore: z.number().min(0).max(1),
  crossSteleConnectivity: z.number().min(0).max(1),
});
export type FrontierSignals = z.infer<typeof FrontierSignals>;

export const SteleTab = z.object({
  id: z.string(),
  researchSetId: z.string(),
  title: z.string(),
  canonicalName: z.string(),
  alternativeNames: z.array(z.string()).default([]),
  roles: z.array(TabRole).min(1),
  assetMode: AssetMode,
  initialStatus: ResearchMaturityStatus,
  maturityScores: MaturityScores.nullable().default(null),
  frontierSignals: FrontierSignals.nullable().default(null),
  periodEstimate: z.string().default(""),
  location: z.string().default(""),
  material: z.string().default(""),
  scriptType: z.string().default("한문 해서/예서 계열"),
  writingDirection: z.string().default("세로쓰기"),
  rightsState: RightsState,
  sourceQuality: z.number().min(0).max(1).default(0.5),
  questions: z.array(z.string()).default([]),
  knownFacts: z.array(z.string()).default([]),
  restrictions: z.array(z.string()).default([]),
  preliminaryClaims: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  archived: z.boolean().default(false),
  uiState: TabUiState,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SteleTab = z.infer<typeof SteleTab>;

export const SourceRecord = z.object({
  id: z.string(),
  steleTabId: z.string(),
  type: z.string(),
  publisher: z.string(),
  url: z.string(),
  expectedFormats: z.array(z.string()).default([]),
  acquisition: z.string(),
  rightsState: RightsState,
  reliabilityTier: z.number().int().min(1).max(7),
  independenceGroup: z.string().default(""),
  retrievedAt: z.string().nullable().default(null),
  notes: z.string().default(""),
});
export type SourceRecord = z.infer<typeof SourceRecord>;

export const QualityReport = z.object({
  format: z.string(),
  vertexCount: z.number().int().nullable().default(null),
  triangleCount: z.number().int().nullable().default(null),
  pointCount: z.number().int().nullable().default(null),
  hasNormals: z.boolean().nullable().default(null),
  hasColors: z.boolean().nullable().default(null),
  boundingBox: z
    .object({
      min: z.tuple([z.number(), z.number(), z.number()]),
      max: z.tuple([z.number(), z.number(), z.number()]),
    })
    .nullable()
    .default(null),
  unitGuess: z.string().nullable().default(null),
  warnings: z.array(z.string()).default([]),
});
export type QualityReport = z.infer<typeof QualityReport>;

export const SteleAsset = z.object({
  id: z.string(),
  steleTabId: z.string(),
  assetType: AssetType,
  provenance: DataProvenance,
  /** 가상 데모 자산의 표시명 (예: "DEMO-A 고구려계 가상비") */
  demoLabel: z.string().nullable().default(null),
  originalFilename: z.string().nullable().default(null),
  mimeType: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  byteSize: z.number().int().nullable().default(null),
  checksumSha256: z.string().nullable().default(null),
  sourceRecordId: z.string().nullable().default(null),
  licenseType: z.string().nullable().default(null),
  licenseVerifiedAt: z.string().nullable().default(null),
  licenseVerifiedBy: z.string().nullable().default(null),
  usagePurpose: z.string().default(""),
  coordinateSystem: z.string().nullable().default(null),
  unit: z.string().nullable().default(null),
  qualityLevel: z.enum(["PREVIEW", "MEDIUM", "FULL"]).nullable().default(null),
  isOriginal: z.boolean().default(true),
  parentAssetId: z.string().nullable().default(null),
  processingStatus: ProcessingStatus,
  rightsState: RightsState,
  qualityReport: QualityReport.nullable().default(null),
  storageKey: z.string().nullable().default(null),
  /** 가상 데모 메시의 절차 생성 파라미터 (VIRTUAL_DEMO 전용) */
  meshParams: z.record(z.unknown()).nullable().default(null),
  createdAt: z.string(),
});
export type SteleAsset = z.infer<typeof SteleAsset>;

/** 허구/실제 문헌 문서. 허구 코퍼스는 isFictional=true 로 명시. */
export const CorpusDocument = z.object({
  id: z.string(),
  title: z.string(),
  docType: z.enum([
    "PRIMARY_SOURCE",
    "PEER_REVIEWED",
    "SURVEY_REPORT",
    "CONFERENCE",
    "NEWS",
    "INSTITUTION_NOTE",
    "USER_NOTE",
  ]),
  publisher: z.string(),
  publishedAt: z.string(),
  language: z.string().default("ko"),
  isFictional: z.boolean(),
  reliabilityTier: z.number().int().min(1).max(7),
  /** 동일 계보 재인용 판별용 — 같은 그룹은 독립 근거 1개로 계산 */
  independenceGroup: z.string(),
  derivedFromDocumentId: z.string().nullable().default(null),
  relatedTabIds: z.array(z.string()).default([]),
  content: z.string(),
  createdAt: z.string(),
});
export type CorpusDocument = z.infer<typeof CorpusDocument>;

/** 데모 글리프의 획 정보 — SVG 렌더링과 특징 벡터 계산의 원천 */
export const GlyphStrokes = z.object({
  /** 0~100 좌표계 polyline 목록 */
  polylines: z.array(z.array(z.tuple([z.number(), z.number()]))),
  /** 마모로 소실된 획 인덱스 */
  erodedStrokeIndexes: z.array(z.number().int()).default([]),
});
export type GlyphStrokes = z.infer<typeof GlyphStrokes>;

export const GlyphCell = z.object({
  id: z.string(),
  steleTabId: z.string(),
  faceId: z.string(),
  lineIndex: z.number().int(),
  sequenceIndex: z.number().int(),
  bbox2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  observabilityScore: z.number().min(0).max(1),
  damageGrade: z.number().int().min(0).max(5),
  readingStatus: ReadingStatus,
  acceptedCandidateId: z.string().nullable().default(null),
  /**
   * 기존 연구 판독안(공개 판독). 가상 데모에서는 허구 문자.
   * 자동 분석 결과에 정답으로 주입 금지 — 표시 전용.
   */
  publishedReading: z.string().nullable().default(null),
  /** 특징 벡터 (교차 비석 유사도 계산용, 데모에서는 획 기반 파생) */
  featureVector: z.array(z.number()).default([]),
  strokes: GlyphStrokes.nullable().default(null),
  version: z.number().int().default(1),
});
export type GlyphCell = z.infer<typeof GlyphCell>;

export const GlyphCandidate = z.object({
  id: z.string(),
  glyphCellId: z.string(),
  candidateCharacter: z.string(),
  variantForm: z.string().nullable().default(null),
  origin: z.enum(["VISUAL", "INTRA_STELE", "CROSS_STELE", "LITERATURE"]),
  visualScore: z.number().min(0).max(1),
  geometryScore: z.number().min(0).max(1),
  contextScore: z.number().min(0).max(1),
  crossSteleScore: z.number().min(0).max(1),
  textualScore: z.number().min(0).max(1),
  calibratedConfidence: z.number().min(0).max(1),
  createdAt: z.string(),
});
export type GlyphCandidate = z.infer<typeof GlyphCandidate>;

export const HypothesisEvidence = z.object({
  id: z.string(),
  hypothesisId: z.string(),
  kind: EvidenceKind,
  documentId: z.string().nullable().default(null),
  sourceGlyphCellId: z.string().nullable().default(null),
  quote: z.string().default(""),
  quoteOffset: z.number().int().nullable().default(null),
  citationVerified: z.boolean().default(false),
  citationContext: z.string().default(""),
  independenceGroup: z.string().default(""),
  reliabilityTier: z.number().int().min(1).max(7).default(7),
  note: z.string().default(""),
});
export type HypothesisEvidence = z.infer<typeof HypothesisEvidence>;

export const DecisionGateInput = z.object({
  calibratedConfidence: z.number(),
  marginToSecondCandidate: z.number(),
  verifiedPrimaryOrDirectSourceCount: z.number().int(),
  independentLineageCount: z.number().int(),
  strongVisualContradiction: z.boolean(),
  strongChronologyContradiction: z.boolean(),
  citationVerified: z.boolean(),
  benchmarkLeakage: z.boolean(),
  hasCompetingCandidateWithEvidence: z.boolean().default(false),
  observabilityScore: z.number().min(0).max(1).default(0),
});
export type DecisionGateInput = z.infer<typeof DecisionGateInput>;

export const DecisionGateResult = z.object({
  outcome: DecisionOutcome,
  passed: z.boolean(),
  failedRules: z.array(z.string()),
  ruleTrace: z.array(
    z.object({
      rule: z.string(),
      expected: z.string(),
      actual: z.string(),
      passed: z.boolean(),
    })
  ),
});
export type DecisionGateResult = z.infer<typeof DecisionGateResult>;

export const RestorationHypothesis = z.object({
  id: z.string(),
  glyphCellId: z.string(),
  candidateCharacter: z.string(),
  variantForm: z.string().nullable().default(null),
  status: DecisionOutcome,
  visualSupport: z.number().min(0).max(1),
  geometricSupport: z.number().min(0).max(1),
  intraSteleSupport: z.number().min(0).max(1),
  crossSteleSupport: z.number().min(0).max(1),
  textualSupport: z.number().min(0).max(1),
  historicalSupport: z.number().min(0).max(1),
  counterEvidenceStrength: z.number().min(0).max(1),
  calibratedConfidence: z.number().min(0).max(1),
  marginToSecond: z.number(),
  decisionRule: z.string(),
  gateInput: DecisionGateInput.nullable().default(null),
  gateResult: DecisionGateResult.nullable().default(null),
  modelVersion: z.string(),
  corpusVersion: z.string(),
  createdAt: z.string(),
});
export type RestorationHypothesis = z.infer<typeof RestorationHypothesis>;

export const CrossSteleMatch = z.object({
  id: z.string(),
  sourceGlyphCellId: z.string(),
  targetGlyphCellId: z.string(),
  targetSteleTabId: z.string(),
  matchType: z.enum(["SAME_CHARACTER", "SIMILAR_FORM", "CONTEXT_PARALLEL"]),
  visualScore: z.number().min(0).max(1),
  geometryScore: z.number().min(0).max(1),
  strokeScore: z.number().min(0).max(1),
  scriptScore: z.number().min(0).max(1),
  periodScore: z.number().min(0).max(1),
  contextScore: z.number().min(0).max(1),
  combinedScore: z.number().min(0).max(1),
  normalizationMethod: z.string(),
  modelVersion: z.string(),
  createdAt: z.string(),
});
export type CrossSteleMatch = z.infer<typeof CrossSteleMatch>;

export const FrontierWatchItem = z.object({
  id: z.string(),
  provisionalName: z.string(),
  discoveryDate: z.string().nullable().default(null),
  announcementDate: z.string().nullable().default(null),
  locationPrecision: z.string().default(""),
  reportingInstitution: z.string().default(""),
  assetAvailability: z.array(z.string()).default([]),
  rightsState: RightsState,
  status: FrontierStatus,
  preliminaryClaims: z.array(z.string()).default([]),
  unknownQuestions: z.array(z.string()).default([]),
  relatedStelae: z.array(z.string()).default([]),
  nextExpectedEvent: z.string().default(""),
  lastCheckedAt: z.string().nullable().default(null),
  promotedTabId: z.string().nullable().default(null),
  frontierIndex: z.number().min(0).max(1).nullable().default(null),
});
export type FrontierWatchItem = z.infer<typeof FrontierWatchItem>;

export const AuditEvent = z.object({
  id: z.string(),
  ts: z.string(),
  actor: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  payload: z.record(z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const ClaimMatrixCell = z.object({
  claimId: z.string(),
  columnId: z.string(),
  state: ClaimCellState,
  note: z.string().default(""),
});
export type ClaimMatrixCell = z.infer<typeof ClaimMatrixCell>;
