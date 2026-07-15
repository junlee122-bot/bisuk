/**
 * 외부 재구성 프로그램 어댑터 레지스트리.
 * 이 컨테이너에는 어떤 외부 3D 바이너리도 설치되어 있지 않으므로
 * 정직하게 UNAVAILABLE 로 보고하고, 앱은 데모 파이프라인으로 전체 흐름이 동작한다.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import type { AdapterStatus } from "@seokmun/types";

const BINARY_PROBE_TIMEOUT_MS = 3_000;
const BINARY_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;

export function matchesAdapterVersionOutput(output: string, versionPattern?: RegExp): boolean {
  const normalized = output.trim();
  if (!normalized) return false;
  return versionPattern ? versionPattern.test(normalized) : true;
}

function probeBinary(bin: string, versionPattern?: RegExp): boolean {
  const result = spawnSync(bin, ["--version"], {
    encoding: "utf8",
    maxBuffer: BINARY_PROBE_MAX_OUTPUT_BYTES,
    shell: false,
    timeout: BINARY_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) return false;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return (
    Buffer.byteLength(output, "utf8") <= BINARY_PROBE_MAX_OUTPUT_BYTES &&
    matchesAdapterVersionOutput(output, versionPattern)
  );
}

function binaryAvailable(bin: string | undefined, versionPattern?: RegExp): boolean {
  if (!bin) return false;
  try {
    if (path.isAbsolute(bin)) {
      accessSync(bin, constants.X_OK);
      if (!statSync(bin).isFile()) return false;
      return probeBinary(bin, versionPattern);
    }
    return probeBinary(bin, versionPattern);
  } catch {
    return false;
  }
}

interface AdapterDef {
  id: string;
  displayName: string;
  apiMode: AdapterStatus["apiMode"];
  licenseClass: AdapterStatus["licenseClass"];
  gpuRequired: boolean;
  envEnabled: () => boolean;
  envBinary: () => string | undefined;
  versionPattern?: RegExp;
  capabilities: Record<string, boolean>;
  licenseWarning: string | null;
}

const DEFS: AdapterDef[] = [
  {
    id: "colmap",
    displayName: "COLMAP (사진측량 정합)",
    apiMode: "CLI",
    licenseClass: "OPEN_SOURCE",
    gpuRequired: false,
    envEnabled: () => true,
    envBinary: () => process.env.COLMAP_BIN ?? "colmap",
    capabilities: { imageReconstruction: true, cameraExport: true, gaussianSplat: false, headless: true },
    licenseWarning: null,
  },
  {
    id: "openmvs",
    displayName: "OpenMVS (dense 재구성)",
    apiMode: "CLI",
    licenseClass: "RESTRICTED",
    gpuRequired: false,
    envEnabled: () => process.env.OPENMVS_ENABLED === "true",
    envBinary: () => process.env.OPENMVS_BIN_DIR,
    capabilities: { imageReconstruction: true, textureGeneration: true, headless: true },
    licenseWarning:
      "AGPL-3.0 — 서버 서비스로 제공 시 소스 공개 의무. 배포 정책 검토 전 기본 비활성.",
  },
  {
    id: "meshroom",
    displayName: "Meshroom / AliceVision",
    apiMode: "CLI",
    licenseClass: "OPEN_SOURCE",
    gpuRequired: true,
    envEnabled: () => true,
    envBinary: () => process.env.MESHROOM_BIN ?? "meshroom_batch",
    capabilities: { imageReconstruction: true, textureGeneration: true, headless: true },
    licenseWarning: null,
  },
  {
    id: "nerfstudio",
    displayName: "Nerfstudio Splatfacto (Gaussian Splat 훈련)",
    apiMode: "CLI",
    licenseClass: "OPEN_SOURCE",
    gpuRequired: true,
    envEnabled: () => process.env.NERFSTUDIO_ENABLED === "true",
    envBinary: () => "ns-train",
    capabilities: { imageReconstruction: true, gaussianSplat: true, headless: true },
    licenseWarning: null,
  },
  {
    id: "blender",
    displayName: "Blender 배치 베이커 (UV/노멀/AO)",
    apiMode: "CLI",
    licenseClass: "OPEN_SOURCE",
    gpuRequired: false,
    envEnabled: () => true,
    envBinary: () => process.env.BLENDER_BIN ?? "blender",
    versionPattern: /\bBlender\b/i,
    capabilities: { meshInput: true, textureGeneration: true, lodExport: true, headless: true },
    licenseWarning: "GPL-3.0 — 별도 프로세스 CLI 호출이므로 앱 라이선스에 비전염. 바이너리 재배포 금지.",
  },
  {
    id: "splat-transform",
    displayName: "PlayCanvas splat-transform (SOG 변환)",
    apiMode: "CLI",
    licenseClass: "OPEN_SOURCE",
    gpuRequired: false,
    envEnabled: () => process.env.SUPERSPLAT_ENABLED !== "false",
    envBinary: () => process.env.SPLAT_TRANSFORM_BIN ?? "splat-transform",
    capabilities: { gaussianSplat: true, headless: true },
    licenseWarning: null,
  },
  {
    id: "realityscan",
    displayName: "RealityScan (상용)",
    apiMode: "CLI",
    licenseClass: "COMMERCIAL",
    gpuRequired: true,
    envEnabled: () => process.env.REALITYSCAN_ENABLED === "true",
    envBinary: () => process.env.REALITYSCAN_BIN,
    capabilities: { imageReconstruction: true, lidarInput: true, textureGeneration: true, lodExport: true },
    licenseWarning: "상용 라이선스 필요. 라이선스 확인 없이 CI에서 실행 금지.",
  },
  {
    id: "metashape",
    displayName: "Agisoft Metashape Professional (상용)",
    apiMode: "PYTHON",
    licenseClass: "COMMERCIAL",
    gpuRequired: true,
    envEnabled: () => process.env.METASHAPE_ENABLED === "true",
    envBinary: () => process.env.METASHAPE_BIN,
    capabilities: { imageReconstruction: true, textureGeneration: true, cameraExport: true },
    licenseWarning: "상용 라이선스 필요. 라이선스 확인 없이 CI에서 실행 금지.",
  },
  {
    id: "sketchfab",
    displayName: "Sketchfab Download API (외부 자산 커넥터)",
    apiMode: "REST",
    licenseClass: "RESTRICTED",
    gpuRequired: false,
    envEnabled: () => process.env.SKETCHFAB_ENABLED === "true",
    envBinary: () => undefined,
    capabilities: { meshInput: true },
    licenseWarning:
      "모델별 CC 라이선스 확인·attribution 필수. 비석과 무관한 모델은 재질·조명 테스트 전용.",
  },
  {
    id: "open-heritage-3d",
    displayName: "Open Heritage 3D (공개 문화유산 메타데이터)",
    apiMode: "REST",
    licenseClass: "RESTRICTED",
    gpuRequired: false,
    envEnabled: () => true,
    envBinary: () => undefined,
    capabilities: { meshInput: true },
    licenseWarning: "데이터셋별 권리 확인 필요 — Source Card 메타데이터 커넥터로만 동작.",
  },
];

export function listAdapters(): AdapterStatus[] {
  return DEFS.map((d) => {
    const enabled = d.envEnabled();
    const bin = d.envBinary();
    const available =
      enabled && (d.apiMode === "REST" ? Boolean(process.env[`${d.id.toUpperCase().replace(/-/g, "_")}_API_TOKEN`]) : binaryAvailable(bin, d.versionPattern));
    return {
      id: d.id,
      displayName: d.displayName,
      apiMode: d.apiMode,
      licenseClass: d.licenseClass,
      gpuRequired: d.gpuRequired,
      enabled,
      available,
      statusNote: !enabled
        ? "DISABLED (환경 변수로 비활성)"
        : available
          ? "AVAILABLE"
          : `UNAVAILABLE (${d.apiMode === "REST" ? "API 토큰 미설정" : `실행 파일 없음: ${bin ?? "미지정"}`})`,
      capabilities: d.capabilities,
      licenseWarning: d.licenseWarning,
    };
  });
}

export function validateAdapter(id: string): AdapterStatus | null {
  return listAdapters().find((a) => a.id === id) ?? null;
}
