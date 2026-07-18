"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useStageMode } from "@/lib/store";
import { Icon } from "@/components/ui/Icon";

/** 라우트에서 연구 세트 ID 추출 — /sets/:id(/...) 또는 /showcase/:id */
function routeSetId(pathname: string): string | null {
  const m = pathname.match(/^\/(?:sets|showcase)\/([^/]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function GlobalHeader() {
  const pathname = usePathname();
  const setId = routeSetId(pathname);
  const { mode, setMode } = useStageMode();
  const mutating = useIsMutating();

  const { data: overview } = useQuery({
    queryKey: ["set", setId],
    queryFn: () => api.getSet(setId!),
    enabled: Boolean(setId),
  });

  return (
    <header
      className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line-soft bg-[var(--surface-elevated)] px-3 shadow-[var(--shadow-xs)] backdrop-blur-xl sm:px-5"
      data-testid="global-header"
    >
      <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="석문 Studio 홈">
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-line-soft bg-surface font-display text-base font-bold text-clay shadow-[var(--shadow-xs)]">
          石
        </span>
        <span className={`${setId ? "hidden sm:block" : "block"} leading-tight`}>
          <span className="block font-display text-base font-semibold tracking-tight sm:text-lg">
            석문 Studio
          </span>
          <span className="hidden text-[10px] font-medium tracking-wide text-ink-3 xl:block">
            INSCRIPTION RESEARCH WORKSPACE
          </span>
        </span>
      </Link>

      {overview && (
        <nav aria-label="현재 위치" className="flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden h-6 w-px bg-line-soft sm:block" aria-hidden="true" />
          <Icon name="arrow-right" className="h-3.5 w-3.5 shrink-0 text-ink-3 sm:hidden" />
          <span className="truncate font-semibold" data-testid="set-title">
            {overview.set.name}
          </span>
        </nav>
      )}

      {!setId && (
        <nav className="ml-3 hidden items-center gap-1 lg:flex" aria-label="주요 메뉴">
          <Link
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
            className={`ui-button min-h-8 px-2.5 py-1 ${pathname === "/" ? "bg-surface-muted text-ink" : "ui-button-ghost"}`}
          >
            연구 세트
          </Link>
          <Link
            href="/frontier"
            aria-current={pathname === "/frontier" ? "page" : undefined}
            className={`ui-button min-h-8 px-2.5 py-1 ${pathname === "/frontier" ? "bg-surface-muted text-ink" : "ui-button-ghost"}`}
          >
            발견 동향
          </Link>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span
          className={`hidden items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${
            mutating > 0
              ? "border-[#e1d3a6] bg-[#f4edd6] text-[var(--state-warning)]"
              : "border-line-soft bg-surface text-[var(--state-success)]"
          }`}
          data-testid="sync-status"
          aria-live="polite"
        >
          <span className="status-dot" aria-hidden="true" />
          {mutating > 0 ? "변경사항 저장 중" : "저장됨 · 세션 저장소"}
        </span>
        {setId && (
          <div className="toolbar-group shrink-0 whitespace-nowrap text-xs" role="group" aria-label="무대 모드">
            <button
              onClick={() => setMode("EXHIBITION")}
              aria-pressed={mode === "EXHIBITION"}
              data-testid="mode-toggle-exhibition"
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 font-semibold transition-colors ${
                mode === "EXHIBITION"
                  ? "bg-clay text-ink-inverse shadow-[var(--shadow-xs)]"
                  : "text-ink-2 hover:bg-surface-muted hover:text-ink"
              }`}
            >
              전시
            </button>
            <button
              onClick={() => setMode("RESEARCH")}
              aria-pressed={mode === "RESEARCH"}
              data-testid="mode-toggle-research"
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 font-semibold transition-colors ${
                mode === "RESEARCH"
                  ? "bg-clay text-ink-inverse shadow-[var(--shadow-xs)]"
                  : "text-ink-2 hover:bg-surface-muted hover:text-ink"
              }`}
            >
              연구
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
