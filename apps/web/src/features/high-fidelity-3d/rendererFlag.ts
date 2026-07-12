"use client";

/**
 * NEXT_PUBLIC_3D_RENDERER=webgl|auto|webgpu (기본 webgl).
 * WebGPU 렌더 경로는 아직 구현되지 않았다 — 요청되면 정직하게 UNAVAILABLE을
 * 보고하고 WebGL로 동작한다 (조용한 대체 금지, 상태 배지로 노출).
 */
export type RendererFlag = "webgl" | "auto" | "webgpu";

export type WebGpuStatus =
  | "NOT_REQUESTED"
  | "UNAVAILABLE_NO_DEVICE"
  | "UNAVAILABLE_NOT_IMPLEMENTED";

export function rendererFlag(): RendererFlag {
  const v = process.env.NEXT_PUBLIC_3D_RENDERER;
  return v === "auto" || v === "webgpu" ? v : "webgl";
}

export function resolveRenderer(): {
  requested: RendererFlag;
  active: "webgl";
  webgpuStatus: WebGpuStatus;
  note: string | null;
} {
  const requested = rendererFlag();
  if (requested === "webgl") {
    return { requested, active: "webgl", webgpuStatus: "NOT_REQUESTED", note: null };
  }
  const hasWebGpu =
    typeof navigator !== "undefined" && "gpu" in navigator && Boolean(navigator.gpu);
  if (!hasWebGpu) {
    return {
      requested,
      active: "webgl",
      webgpuStatus: "UNAVAILABLE_NO_DEVICE",
      note: "WebGPU 미지원 브라우저 — WebGL로 렌더 중",
    };
  }
  return {
    requested,
    active: "webgl",
    webgpuStatus: "UNAVAILABLE_NOT_IMPLEMENTED",
    note: "WebGPU 렌더 경로 미구현(UNAVAILABLE) — WebGL로 렌더 중",
  };
}
