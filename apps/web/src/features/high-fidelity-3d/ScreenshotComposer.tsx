"use client";

import { useState } from "react";

export interface CaptureMeta {
  steleName: string;
  assetId: string;
  lod: string;
  representation: string;
  lightingPreset: string;
  renderMode: string;
  toneMapping: string;
  measurementAllowed: boolean;
  source: string;
  camera: unknown;
}

type Frame = "원본" | "16:9" | "4:3" | "1:1";
const FRAME_RATIO: Record<Exclude<Frame, "원본">, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
};

/**
 * 포트폴리오 스크린샷 컴포저 — 무대만 캡처 / 투명 배경 / 고정 프레임 / 메타데이터 sidecar.
 * 캡처는 단발성 안전 경로(요청 시 1회 렌더 직후 toDataURL) —
 * preserveDrawingBuffer 상시 활성화로 성능을 희생하지 않는다.
 */
export function ScreenshotComposer({
  onClose,
  captureRaw,
  stage,
  meta,
}: {
  onClose: () => void;
  /** 1회 렌더 후 투명 배경 PNG dataURL 반환 */
  captureRaw: () => string;
  stage: { top: string; bottom: string };
  meta: CaptureMeta;
}) {
  const [transparent, setTransparent] = useState(false);
  const [frame, setFrame] = useState<Frame>("원본");
  const [sidecar, setSidecar] = useState(true);
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    setBusy(true);
    try {
      const raw = captureRaw();
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("capture decode failed"));
        img.src = raw;
      });
      // 프레임 크롭 (중앙 기준)
      let sw = img.width;
      let sh = img.height;
      if (frame !== "원본") {
        const r = FRAME_RATIO[frame];
        if (sw / sh > r) sw = Math.round(sh * r);
        else sh = Math.round(sw / r);
      }
      const sx = Math.round((img.width - sw) / 2);
      const sy = Math.round((img.height - sh) / 2);
      const out = document.createElement("canvas");
      out.width = sw;
      out.height = sh;
      const ctx = out.getContext("2d")!;
      if (!transparent) {
        const g = ctx.createLinearGradient(0, 0, 0, sh);
        g.addColorStop(0, stage.top);
        g.addColorStop(1, stage.bottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, sw, sh);
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const base = `seokmun-${meta.assetId}-${ts}`;
      const a = document.createElement("a");
      a.href = out.toDataURL("image/png");
      a.download = `${base}.png`;
      a.click();
      if (sidecar) {
        const blob = new Blob(
          [JSON.stringify({ ...meta, frame, transparentBackground: transparent, createdAt: new Date().toISOString() }, null, 2)],
          { type: "application/json" }
        );
        const b = document.createElement("a");
        b.href = URL.createObjectURL(blob);
        b.download = `${base}.json`;
        b.click();
        URL.revokeObjectURL(b.href);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute right-2 top-10 z-20 w-64 rounded-xl border border-line-soft bg-[var(--surface-elevated)] p-3 text-xs shadow-[var(--shadow-sm)]"
      data-testid="screenshot-composer"
    >
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">촬영 — 무대만 캡처</h4>
        <button onClick={onClose} aria-label="컴포저 닫기" data-testid="composer-close">
          ✕
        </button>
      </div>
      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={transparent}
          onChange={(e) => setTransparent(e.target.checked)}
          data-testid="composer-transparent"
        />
        투명 배경 (무대 그라데이션 제외)
      </label>
      <div className="mt-2 flex items-center gap-1">
        <span className="text-ink-3">프레임</span>
        {(["원본", "16:9", "4:3", "1:1"] as Frame[]).map((f) => (
          <button
            key={f}
            onClick={() => setFrame(f)}
            aria-pressed={frame === f}
            className={`badge ${frame === f ? "badge-demo" : "badge-neutral"}`}
          >
            {f}
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={sidecar} onChange={(e) => setSidecar(e.target.checked)} />
        메타데이터 JSON 함께 저장
      </label>
      <p className="mt-2 text-[10px] text-ink-3">
        측정 가능 여부·출처·조명이 메타데이터에 기록됩니다. 표시 보강은 측정 정확도를
        높이지 않습니다.
      </p>
      <button
        onClick={() => void capture()}
        disabled={busy}
        className="badge badge-ok mt-2 w-full justify-center"
        data-testid="composer-capture"
      >
        {busy ? "캡처 중…" : "PNG 저장"}
      </button>
    </div>
  );
}
