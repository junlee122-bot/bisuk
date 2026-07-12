import { z } from "zod";

/** 증거/표현 분리 — 업그레이드 명세 §1.2 */
export const SourceState = z.enum([
  "MEASURED",
  "DERIVED",
  "PRESENTATION_ENHANCED",
  "GENERATED_VISUAL_ONLY",
]);
export type SourceState = z.infer<typeof SourceState>;

export const VariantType = z.enum([
  "RAW_MESH",
  "RAW_POINT_CLOUD",
  "RAW_IMAGE_SET",
  "RAW_SPLAT",
  "EVIDENCE_MESH_HIGH",
  "EVIDENCE_MESH_MEDIUM",
  "EVIDENCE_MESH_PREVIEW",
  "EVIDENCE_POINT_CLOUD",
  "PBR_MESH_HIGH",
  "PBR_MESH_MEDIUM",
  "PBR_MESH_PREVIEW",
  "GLYPH_DETAIL_PATCH",
  "SURFACE_ANALYSIS_TEXTURES",
  "COLLISION_PROXY",
  "SPLAT_SOURCE_PLY",
  "SPLAT_DELIVERY_SOG",
  "REFERENCE_RENDER",
  "THUMBNAIL",
]);
export type VariantType = z.infer<typeof VariantType>;

export const QualityGrade = z.enum([
  "Q0_METADATA_ONLY",
  "Q1_PREVIEW",
  "Q2_WEB_STANDARD",
  "Q3_RESEARCH_HIGH",
  "Q4_ARCHIVAL_MASTER",
]);
export type QualityGrade = z.infer<typeof QualityGrade>;

export const AssetVariant = z.object({
  id: z.string(),
  steleAssetId: z.string(),
  variantType: VariantType,
  parentVariantIds: z.array(z.string()).default([]),
  sourceState: SourceState,
  format: z.string(),
  mimeType: z.string(),
  storageKey: z.string().nullable().default(null),
  byteSize: z.number().int().nullable().default(null),
  sha256: z.string().nullable().default(null),
  vertexCount: z.number().int().nullable().default(null),
  triangleCount: z.number().int().nullable().default(null),
  pointCount: z.number().int().nullable().default(null),
  splatCount: z.number().int().nullable().default(null),
  coordinateSystem: z.string().default("stele-space(+Y up, +Z 비문면)"),
  unit: z.string().nullable().default(null),
  scaleConfidence: z.enum(["CONFIRMED", "ASSUMED", "UNKNOWN"]).default("UNKNOWN"),
  bounds: z
    .object({
      min: z.tuple([z.number(), z.number(), z.number()]),
      max: z.tuple([z.number(), z.number(), z.number()]),
    })
    .nullable()
    .default(null),
  qualityLevel: QualityGrade,
  /** true면 좌표 선택·측정 기준으로 사용 가능 (Evidence 계열만) */
  measurementAllowed: z.boolean(),
  /** true면 표시 전용 (Splat·표현 보강 레이어) */
  visualizationOnly: z.boolean(),
  licenseState: z.string().default("INHERITED_FROM_ASSET"),
  pipelineName: z.string(),
  pipelineVersion: z.string(),
  pipelineParameters: z.record(z.unknown()).default({}),
  /** 파생 품질 지표 — LOD 표면 오차 등 (정직한 수치만) */
  metrics: z.record(z.unknown()).default({}),
  glyphCellId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type AssetVariant = z.infer<typeof AssetVariant>;

export const ThreeDJobStage = z.enum([
  "QUEUED",
  "VALIDATING",
  "INSPECTING",
  "NORMALIZING",
  "GENERATING_LOD",
  "BAKING",
  "COMPRESSING",
  "GENERATING_SPLAT",
  "ALIGNING",
  "QUALITY_CHECK",
  "READY",
  "FAILED",
  "CANCELLED",
]);
export type ThreeDJobStage = z.infer<typeof ThreeDJobStage>;

export const ThreeDJob = z.object({
  id: z.string(),
  steleAssetId: z.string(),
  kind: z.enum(["UPGRADE_PIPELINE", "DETAIL_PATCHES", "SPLAT_DEMO", "RECONSTRUCTION"]),
  stage: ThreeDJobStage,
  stageLog: z.array(
    z.object({ stage: ThreeDJobStage, at: z.string(), note: z.string().default("") })
  ),
  parameters: z.record(z.unknown()).default({}),
  inputHashes: z.array(z.string()).default([]),
  outputVariantIds: z.array(z.string()).default([]),
  pipelineName: z.string(),
  pipelineVersion: z.string(),
  error: z.string().nullable().default(null),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
});
export type ThreeDJob = z.infer<typeof ThreeDJob>;

export const LightingPreset = z.enum([
  "MUSEUM_NEUTRAL",
  "FIELD_DAYLIGHT",
  "LABORATORY_NEUTRAL",
  "RAKING",
  "SWEEP",
  "UNLIT_ALBEDO",
]);
export type LightingPreset = z.infer<typeof LightingPreset>;

export const CameraMode = z.enum([
  "PERSPECTIVE_MUSEUM",
  "ORTHOGRAPHIC_RESEARCH",
  "FRONT_ELEVATION",
  "GLYPH_FOCUS",
]);
export type CameraMode = z.infer<typeof CameraMode>;

/** 표현 전환 — Evidence(연구) / PBR(실감) / 원본색 / Splat / 점군 */
export const RepresentationMode = z.enum([
  "RESEARCH_EVIDENCE",
  "PBR_PRESENTATION",
  "UNLIT_ORIGINAL",
  "SPLAT",
  "POINT_CLOUD",
]);
export type RepresentationMode = z.infer<typeof RepresentationMode>;

export const QualityTier = z.enum(["AUTO", "ULTRA", "HIGH", "BALANCED", "MOBILE", "BATTERY_SAVER"]);
export type QualityTier = z.infer<typeof QualityTier>;

export const RenderPreset = z.object({
  id: z.string(),
  name: z.string(),
  lightingPreset: LightingPreset,
  exposure: z.number(),
  toneMapping: z.string(),
  aoStrength: z.number(),
  normalStrength: z.number(),
  note: z.string().default(""),
  createdAt: z.string(),
});
export type RenderPreset = z.infer<typeof RenderPreset>;

export const AdapterStatus = z.object({
  id: z.string(),
  displayName: z.string(),
  apiMode: z.enum(["CLI", "REST", "GRPC", "PYTHON", "LOCAL_LIBRARY"]),
  licenseClass: z.enum(["OPEN_SOURCE", "COMMERCIAL", "RESTRICTED", "UNKNOWN"]),
  gpuRequired: z.boolean(),
  enabled: z.boolean(),
  available: z.boolean(),
  statusNote: z.string(),
  capabilities: z.record(z.boolean()).default({}),
  licenseWarning: z.string().nullable().default(null),
});
export type AdapterStatus = z.infer<typeof AdapterStatus>;

/** 품질 보고서 자동 고지문 — 명세 §1.3 */
export const QUALITY_DISCLAIMERS = [
  "원본 기하 정밀도보다 높은 측정 정확도를 보장하지 않음",
  "PRESENTATION_ENHANCED / SPLAT 레이어는 실감형 표시용이며 판독 기준이 아님",
  "가상 데모 자산의 치수는 허구 단위이며 절대 깊이 단위가 확인되지 않음",
  "텍스처가 없는 영역은 보간 또는 중성 재질로 표시됨",
] as const;

export const THREE_D_PIPELINE_VERSION = "seokmun-3d-pipeline-0.2.0";
