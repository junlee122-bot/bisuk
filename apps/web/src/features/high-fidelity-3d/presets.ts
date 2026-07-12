"use client";

import type { LightingPreset, QualityTier } from "@seokmun/types";

export interface LightingConfig {
  label: string;
  /** 환경광(IBL) 강도 */
  envIntensity: number;
  background: string;
  exposure: number;
  key: { intensity: number; color: string; castShadow: boolean } | null;
  fill: { intensity: number; position: [number, number, number] } | null;
  /** 사광 모드: 방위각·고도 사용 */
  raking: boolean;
  note: string;
}

export const LIGHTING_PRESETS: Record<LightingPreset, LightingConfig> = {
  MUSEUM_NEUTRAL: {
    label: "박물관 중성광",
    envIntensity: 0.42,
    background: "#1a1a1e",
    exposure: 1.0,
    key: { intensity: 1.55, color: "#fff2df", castShadow: true },
    fill: { intensity: 0.3, position: [-2.5, 0.5, 2.0] },
    raking: false,
    note: "중성 환경광 + 부드러운 키 라이트 — 일반 감상 기본값",
  },
  FIELD_DAYLIGHT: {
    label: "현장 흐린빛",
    envIntensity: 0.85,
    background: "#26292c",
    exposure: 1.05,
    key: { intensity: 1.15, color: "#f2f4f5", castShadow: true },
    fill: { intensity: 0.35, position: [-1.5, 2.5, 1.5] },
    raking: false,
    note: "흐린 낮 야외 관찰 근사 (실제 촬영지 재현 아님)",
  },
  LABORATORY_NEUTRAL: {
    label: "실험실 중성광",
    envIntensity: 1.0,
    background: "#2b2b2e",
    exposure: 1.0,
    key: { intensity: 0.5, color: "#ffffff", castShadow: false },
    fill: { intensity: 0.5, position: [0, -1, 3] },
    raking: false,
    note: "균일 중성광 — 판독·문헌 비교 기본값 (과장 없음)",
  },
  RAKING: {
    label: "사광",
    envIntensity: 0.12,
    background: "#101013",
    exposure: 1.15,
    key: { intensity: 3.2, color: "#fff1dc", castShadow: true },
    fill: null,
    raking: true,
    note: "표면과 거의 평행한 방향광 — 방위각·고도 조절",
  },
  SWEEP: {
    label: "회전 사광",
    envIntensity: 0.12,
    background: "#101013",
    exposure: 1.15,
    key: { intensity: 3.2, color: "#fff1dc", castShadow: true },
    fill: null,
    raking: true,
    note: "빛이 표면을 회전 — 획 음영 변화 관찰",
  },
  UNLIT_ALBEDO: {
    label: "무조명",
    envIntensity: 0,
    background: "#222226",
    exposure: 1.0,
    key: null,
    fill: null,
    raking: false,
    note: "조명 없는 원본 색",
  },
};

export interface QualityConfig {
  label: string;
  dpr: [number, number];
  shadowMapSize: number;
  maxDetailPatches: number;
  splatFraction: number;
}

export const QUALITY_TIERS: Record<Exclude<QualityTier, "AUTO">, QualityConfig> = {
  ULTRA: { label: "최고", dpr: [1, 2], shadowMapSize: 2048, maxDetailPatches: 6, splatFraction: 1 },
  HIGH: { label: "높음", dpr: [1, 1.75], shadowMapSize: 1024, maxDetailPatches: 4, splatFraction: 1 },
  BALANCED: { label: "중간", dpr: [1, 1.25], shadowMapSize: 1024, maxDetailPatches: 2, splatFraction: 0.6 },
  MOBILE: { label: "낮음", dpr: [0.8, 1], shadowMapSize: 512, maxDetailPatches: 1, splatFraction: 0.35 },
  BATTERY_SAVER: { label: "절전", dpr: [0.6, 0.8], shadowMapSize: 0, maxDetailPatches: 0, splatFraction: 0.2 },
};

/** 기기 성능 근사 감지 — 사용자 변경 가능 */
export function detectQualityTier(): Exclude<QualityTier, "AUTO"> {
  if (typeof navigator === "undefined") return "BALANCED";
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
  if (mobile) return mem >= 6 ? "MOBILE" : "BATTERY_SAVER";
  if (mem >= 8 && cores >= 8) return "HIGH";
  if (mem >= 4 && cores >= 4) return "BALANCED";
  return "MOBILE";
}

export function azimuthElevationToDirection(
  azimuthDeg: number,
  elevationDeg: number,
  distance = 4
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [
    Math.cos(el) * Math.sin(az) * distance,
    Math.sin(el) * distance,
    Math.cos(el) * Math.cos(az) * distance,
  ];
}
