import { z } from "zod";

/**
 * SceneLook — 장면 룩 프리셋 (조명·톤매핑·무대·표현의 재현 가능한 조합).
 * 버전 관리되며 스크린샷 재현에 사용한다 (portfolio-polish §12).
 * 표시 계층 전용 — Evidence 데이터·측정에는 영향을 주지 않는다.
 */
export const ToneMappingChoice = z.enum(["ACES", "AGX", "NEUTRAL"]);
export type ToneMappingChoice = z.infer<typeof ToneMappingChoice>;

export const SceneLook = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  lightingPreset: z.enum([
    "MUSEUM_NEUTRAL",
    "FIELD_DAYLIGHT",
    "LABORATORY_NEUTRAL",
    "RAKING",
    "SWEEP",
    "UNLIT_ALBEDO",
  ]),
  toneMapping: ToneMappingChoice.default("ACES"),
  exposure: z.number().min(0.2).max(3).default(1),
  aoStrength: z.number().min(0).max(2).default(0.6),
  lightAzimuthDeg: z.number().min(0).max(360).default(105),
  lightElevationDeg: z.number().min(0).max(90).default(12),
  representation: z
    .enum(["RESEARCH_EVIDENCE", "PBR_PRESENTATION", "UNLIT_ORIGINAL", "SPLAT", "POINT_CLOUD"])
    .default("PBR_PRESENTATION"),
  stage: z
    .object({
      floor: z.boolean().default(true),
      plinth: z.boolean().default(true),
    })
    .default({ floor: true, plinth: true }),
  /** 내장 프리셋 여부 — 내장은 삭제 불가 */
  builtIn: z.boolean().default(false),
  version: z.number().int().min(1).default(1),
  createdBy: z.string().default("system"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SceneLook = z.infer<typeof SceneLook>;

export const SceneLookCreate = SceneLook.omit({
  id: true,
  builtIn: true,
  version: true,
  createdAt: true,
  updatedAt: true,
}).partial({ description: true, toneMapping: true, exposure: true, aoStrength: true, lightAzimuthDeg: true, lightElevationDeg: true, representation: true, stage: true, createdBy: true });
export type SceneLookCreate = z.infer<typeof SceneLookCreate>;

/** 저장 가능한 카메라 북마크 (portfolio-polish §7.1) */
export const CameraBookmark = z.object({
  id: z.string(),
  name: z.string().min(1),
  projection: z.enum(["perspective", "orthographic"]),
  position: z.tuple([z.number(), z.number(), z.number()]),
  target: z.tuple([z.number(), z.number(), z.number()]),
  up: z.tuple([z.number(), z.number(), z.number()]).default([0, 1, 0]),
  fov: z.number().min(1).max(120).optional(),
  zoom: z.number().positive().optional(),
  near: z.number().positive(),
  far: z.number().positive(),
  /** 어떤 자산 변형 기준의 포즈인지 (재현성) */
  assetVariantId: z.string(),
  selectedGlyphId: z.string().optional(),
  createdBy: z.string().default("user"),
  createdAt: z.string(),
});
export type CameraBookmark = z.infer<typeof CameraBookmark>;

export const CameraBookmarkCreate = CameraBookmark.omit({ id: true, createdAt: true }).partial({
  up: true,
  createdBy: true,
});
export type CameraBookmarkCreate = z.infer<typeof CameraBookmarkCreate>;
