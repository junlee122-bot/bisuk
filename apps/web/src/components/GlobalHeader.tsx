"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useStageMode } from "@/lib/store";

/** 라우트에서 연구 세트 ID 추출 — /sets/:id(/...) 또는 /showcase/:id */
function useRouteSetId(): string | null {
  const pathname = usePathname();
  const m = pathname.match(/^\/(?:sets|showcase)\/([^/]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function GlobalHeader() {
  const setId = useRouteSetId();
  const { mode, setMode } = useStageMode();
  const mutating = useIsMutating();

  const { data: overview } = useQuery({
    queryKey: ["set", setId],
    queryFn: () => api.getSet(setId!),
    enabled: Boolean(setId),
  });

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-line-soft bg-[var(--surface-elevated)] px-4 backdrop-blur"
      data-testid="global-header"
    >
      <Link href="/" className="flex items-baseline gap-2" aria-label="석문 Studio 홈">
        <span className="font-display text-lg font-semibold tracking-tight">석문 Studio</span>
        <span className="hidden text-[11px] text-ink-3 md:inline">
          손상된 비문을, 근거와 함께 다시 읽다
        </span>
      </Link>

      {overview && (
        <nav aria-label="현재 위치" className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="text-ink-3">/</span>
          <span className="truncate font-medium" data-testid="set-title">
            {overview.set.name}
          </span>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span
          className="hidden text-[11px] text-ink-3 sm:inline"
          data-testid="sync-status"
          aria-live="polite"
        >
          {mutating > 0 ? "저장 중…" : "저장됨 · 로컬"}
        </span>
        <div
          className="flex items-center rounded-full border border-line-soft bg-surface p-0.5 text-xs"
          role="group"
          aria-label="무대 모드"
        >
          <button
            onClick={() => setMode("EXHIBITION")}
            aria-pressed={mode === "EXHIBITION"}
            data-testid="mode-toggle-exhibition"
            className={`rounded-full px-2.5 py-1 transition-colors ${
              mode === "EXHIBITION"
                ? "bg-clay text-ink-inverse"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            전시 보기
          </button>
          <button
            onClick={() => setMode("RESEARCH")}
            aria-pressed={mode === "RESEARCH"}
            data-testid="mode-toggle-research"
            className={`rounded-full px-2.5 py-1 transition-colors ${
              mode === "RESEARCH"
                ? "bg-clay text-ink-inverse"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            연구 보기
          </button>
        </div>
      </div>
    </header>
  );
}
