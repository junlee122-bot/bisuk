"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const FORMATS = [
  { id: "json", label: "JSON 번들" },
  { id: "csv", label: "CSV 판독표" },
  { id: "epidoc", label: "EpiDoc XML" },
  { id: "report", label: "연구 보고서 (MD)" },
] as const;

export function ExportModal({ setId, onClose }: { setId: string; onClose: () => void }) {
  const [audience, setAudience] = useState<"INTERNAL" | "PUBLIC">("INTERNAL");
  const [blocked, setBlocked] = useState<Array<{ filename: string | null; rightsState: string }> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const download = async (format: string) => {
    setBlocked(null);
    setMessage(null);
    const url = api.exportUrl(setId, format, audience);
    const res = await fetch(url);
    if (res.status === 403) {
      const body = (await res.json()) as {
        message: string;
        details: Array<{ filename: string | null; rightsState: string }>;
      };
      setBlocked(body.details);
      setMessage(body.message);
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `seokmun-${setId}.${format === "epidoc" ? "xml" : format === "report" ? "md" : format}`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage(`${format} 내보내기 완료 — 출처·권리·모델 버전 manifest 포함`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="내보내기"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-md p-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="export-modal"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">내보내기</h2>
          <button onClick={onClose} className="badge badge-neutral">
            닫기 ✕
          </button>
        </div>
        <div className="mt-3 flex gap-2 text-xs">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={audience === "INTERNAL"}
              onChange={() => setAudience("INTERNAL")}
            />
            내부 연구용
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={audience === "PUBLIC"}
              onChange={() => setAudience("PUBLIC")}
              data-testid="audience-public"
            />
            외부 공개용 (권리 게이트 적용)
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => void download(f.id)}
              className="panel p-2 text-sm hover:border-[var(--accent)]"
              data-testid={`export-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {message && (
          <p className="mt-3 text-xs text-neutral-300" data-testid="export-message">
            {message}
          </p>
        )}
        {blocked && (
          <ul className="mt-2 space-y-1 text-xs text-red-300" data-testid="export-blocked">
            {blocked.map((b, i) => (
              <li key={i}>
                ⚠ {b.filename ?? "자산"} — {b.rightsState}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
