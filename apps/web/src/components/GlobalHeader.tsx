"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, authApi, labApi } from "@/lib/api";
import { useStageMode } from "@/lib/store";
import { ROLE_LABEL, useSession } from "@/lib/session";
import { SearchPalette } from "./SearchPalette";

function UserMenu() {
  const { user, status } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: queue } = useQuery({
    queryKey: ["review-queue"],
    queryFn: labApi.reviewQueue,
    enabled: user?.role === "PI",
    refetchInterval: 60_000,
  });
  if (!user) {
    return status?.mode === "local" ? (
      <Link href="/login" className="badge badge-neutral" data-testid="login-link">
        로그인
      </Link>
    ) : null;
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-line-soft px-2.5 py-1 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="user-menu"
      >
        <span className="font-medium">{user.displayName}</span>
        <span className="text-ink-3">{ROLE_LABEL[user.role]}</span>
        {user.role === "PI" && (queue?.length ?? 0) > 0 && (
          <span className="badge badge-warn" data-testid="review-count">
            검토 {queue!.length}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="panel absolute right-0 z-40 mt-1 w-52 bg-[var(--panel-bg)] p-1 text-sm shadow-lg"
          onClick={() => setOpen(false)}
        >
          <Link role="menuitem" href="/review" className="block rounded px-2 py-1.5 hover:bg-surface-2" data-testid="nav-review">
            판독 검토 대기열
          </Link>
          <Link role="menuitem" href="/library" className="block rounded px-2 py-1.5 hover:bg-surface-2" data-testid="nav-library">
            자료실 (서지·문헌·표본)
          </Link>
          <Link role="menuitem" href="/evaluation" className="block rounded px-2 py-1.5 hover:bg-surface-2">
            평가·보정
          </Link>
          {user.role === "PI" && (
            <Link role="menuitem" href="/admin" className="block rounded px-2 py-1.5 hover:bg-surface-2" data-testid="nav-admin">
              연구실 관리
            </Link>
          )}
          <Link role="menuitem" href="/account" className="block rounded px-2 py-1.5 hover:bg-surface-2">
            내 계정
          </Link>
          {status?.mode !== "dev" && (
            <button
              role="menuitem"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-surface-2"
              onClick={() =>
                void authApi.logout().then(async () => {
                  await qc.invalidateQueries();
                  router.replace("/login");
                })
              }
              data-testid="logout"
            >
              로그아웃
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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

  const { user } = useSession();
  const { data: overview } = useQuery({
    queryKey: ["set", setId],
    queryFn: () => api.getSet(setId!),
    enabled: Boolean(setId) && Boolean(user),
  });

  return (
    <header
      className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line-soft bg-[var(--surface-elevated)] px-4 backdrop-blur"
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
          {mutating > 0 ? "저장 중…" : "저장됨"}
        </span>
        {user && <SearchPalette setId={setId} />}
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
        <UserMenu />
      </div>
    </header>
  );
}
