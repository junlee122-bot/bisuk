"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const FORMATS = [
  { id: "json", label: "JSON 번들" },
  { id: "csv", label: "CSV 판독표" },
  { id: "epidoc", label: "EpiDoc XML (TEI)" },
  { id: "report", label: "연구 보고서 (MD)" },
] as const;

export function ExportModal({ setId, onClose }: { setId: string; onClose: () => void }) {
  const [audience, setAudience] = useState<"INTERNAL" | "PUBLIC">("INTERNAL");
  const [blocked, setBlocked] = useState<Array<{ filename: string | null; rightsState: string }> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [epidocTab, setEpidocTab] = useState("");
  const { data: overview } = useQuery({ queryKey: ["set", setId], queryFn: () => api.getSet(setId) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = async (format: string) => {
    setBlocked(null);
    setMessage(null);
    const url = api.exportUrl(setId, format, audience, format === "epidoc" && epidocTab ? epidocTab : undefined);
    const res = await fetch(url, { credentials: "same-origin" });
    if (res.status === 403) {
      const body = (await res.json()) as {
        message: string;
        details: Array<{ filename: string | null; rightsState: string }>;
      };
      setBlocked(body.details);
      setMessage(body.message);
      return;
    }
    if (!res.ok) {
      setMessage(`내보내기 실패 (${res.status}) — 서버 응답을 확인하세요`);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-3"
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
          <button autoFocus onClick={onClose} className="badge badge-neutral">
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
        <label className="mt-2 flex items-center gap-1 text-xs text-ink-2">
          EpiDoc 범위
          <select
            value={epidocTab}
            onChange={(e) => setEpidocTab(e.target.value)}
            className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1 py-0.5"
            data-testid="epidoc-tab"
          >
            <option value="">세트 전체 (teiCorpus)</option>
            {overview?.tabs.map(({ tab }) => (
              <option key={tab.id} value={tab.id}>
                {tab.title} (비석 1건 TEI)
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-[11px] text-ink-3">
          EpiDoc은 연구실 채택 판독을 우선하고, 자동 확정은 기계 판독(resp·cert medium)으로, 판독자별 이견은 apparatus로 기록합니다. CSV는 Excel용 UTF-8 BOM을 포함합니다.
        </p>
        {message && (
          <p className="mt-3 text-xs text-ink-2" data-testid="export-message">
            {message}
          </p>
        )}
        {blocked && (
          <ul className="mt-2 space-y-1 text-xs text-[var(--state-danger)]" data-testid="export-blocked">
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
