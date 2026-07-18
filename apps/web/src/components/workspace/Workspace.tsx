"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TabUiState } from "@seokmun/types";
import { api } from "@/lib/api";
import { useMobilePanel } from "@/lib/store";
import { TabStrip } from "./TabStrip";
import { GlyphTree } from "./GlyphTree";
import { Workbench } from "./Workbench";
import { EvidencePanel } from "./EvidencePanel";
import { CompareTray } from "./CompareTray";
import { ExportModal } from "./ExportModal";
import { Icon } from "@/components/ui/Icon";

export function Workspace({ setId }: { setId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mobile = useMobilePanel();
  const [exportOpen, setExportOpen] = useState(false);

  const { data: overview } = useQuery({
    queryKey: ["set", setId],
    queryFn: () => api.getSet(setId),
  });

  const urlTab = searchParams.get("tab");
  const activeTabId = useMemo(() => {
    if (!overview) return null;
    const valid = new Set(overview.tabs.map((t) => t.tab.id));
    if (urlTab && valid.has(urlTab)) return urlTab;
    if (overview.set.activeTabId && valid.has(overview.set.activeTabId)) {
      return overview.set.activeTabId;
    }
    return overview.tabs[0]?.tab.id ?? null;
  }, [overview, urlTab]);

  const { data: detail } = useQuery({
    queryKey: ["tab", activeTabId],
    queryFn: () => api.getTab(activeTabId!),
    enabled: Boolean(activeTabId),
  });

  const [selectedGlyph, setSelectedGlyph] = useState<string | null>(null);
  useEffect(() => {
    if (detail) {
      setSelectedGlyph(detail.tab.uiState.activeGlyphCellId);
    }
  }, [detail?.tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderMutation = useMutation({
    // 부분 PATCH — 각 조작이 자기 필드만 저장해 stale 상태로 다른 필드를 되돌리지 않는다
    mutationFn: (body: {
      activeTabOrder?: string[];
      activeTabId?: string | null;
      pinnedTabIds?: string[];
    }) => api.saveTabOrder(setId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["set", setId] }),
  });

  const uiStateMutation = useMutation({
    mutationFn: ({ tabId, patch }: { tabId: string; patch: Partial<TabUiState> }) =>
      api.saveUiState(tabId, patch),
    onSuccess: (uiState, { tabId }) => {
      // 탭 캐시를 서버 반환값으로 동기화 — 재방문 시 stale uiState 복원 방지
      qc.setQueryData(["tab", tabId], (old: unknown) =>
        old ? { ...(old as object), tab: { ...(old as { tab: object }).tab, uiState } } : old
      );
    },
  });

  const activate = useCallback(
    (id: string) => {
      router.replace(`/sets/${setId}?tab=${id}`, { scroll: false });
      orderMutation.mutate({ activeTabId: id });
    },
    [router, setId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selectGlyph = useCallback(
    (id: string) => {
      setSelectedGlyph(id);
      if (activeTabId) {
        uiStateMutation.mutate({ tabId: activeTabId, patch: { activeGlyphCellId: id } });
      }
    },
    [activeTabId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const changeUiState = useCallback(
    (patch: Partial<TabUiState>) => {
      if (!activeTabId) return;
      uiStateMutation.mutate({ tabId: activeTabId, patch });
    },
    [activeTabId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!overview) {
    return <p className="p-8 text-sm text-ink-2">연구 세트 불러오는 중…</p>;
  }

  return (
    <div className="flex h-full flex-col bg-surface-2/40">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-line-soft bg-surface px-3 py-2 shadow-[var(--shadow-xs)] sm:px-4">
        <Link href="/" className="ui-button ui-button-ghost min-h-8 px-2 py-1">
          <Icon name="arrow-left" />
          <span className="hidden sm:inline">대시보드</span>
        </Link>
        <span className="hidden h-6 w-px bg-line-soft sm:block" aria-hidden="true" />
        <div className="hidden min-w-0 sm:block">
          <p className="section-label">Research workflow</p>
          <p className="truncate text-xs font-semibold text-ink-2">대상 선택 → 표면 관찰 → 근거 검토</p>
        </div>
        <div className="ml-auto hidden items-center gap-1.5 md:flex" aria-label="검토 현황">
          <span className={`badge ${overview.stats.unresolvedGlyphs > 0 ? "badge-warn" : "badge-ok"}`}>
            미해결 {overview.stats.unresolvedGlyphs}
          </span>
          <span className={`badge ${overview.stats.rightsWarnings > 0 ? "badge-rights" : "badge-ok"}`}>
            권리 확인 {overview.stats.rightsWarnings}
          </span>
        </div>
        <nav className="ml-auto flex items-center gap-1 text-xs md:ml-0">
          <Link href="/frontier" className="ui-button ui-button-ghost min-h-8 px-2 py-1">
            <Icon name="compass" />
            <span className="hidden xl:inline">발견 동향</span>
          </Link>
          <Link href={`/sets/${setId}/audit`} className="ui-button ui-button-ghost min-h-8 px-2 py-1">
            <Icon name="clock" />
            <span className="hidden xl:inline">감사 기록</span>
          </Link>
          <button
            onClick={() => setExportOpen(true)}
            className="ui-button ui-button-primary min-h-8 px-2.5 py-1"
            data-testid="open-export"
          >
            <Icon name="download" />
            내보내기
          </button>
        </nav>
      </header>

      <TabStrip
        overview={overview}
        activeTabId={activeTabId}
        onActivate={activate}
        onReorder={(order) => orderMutation.mutate({ activeTabOrder: order })}
        onPinToggle={(id) => {
          const pinned = overview.set.pinnedTabIds.includes(id)
            ? overview.set.pinnedTabIds.filter((p) => p !== id)
            : [...overview.set.pinnedTabIds, id];
          orderMutation.mutate({ pinnedTabIds: pinned });
        }}
        onClose={(id) => {
          // 서버 archive가 세트 순서·고정·활성탭 정리를 함께 수행한다
          void api.archiveTab(id).then(() => {
            if (activeTabId === id) router.replace(`/sets/${setId}`, { scroll: false });
            void qc.invalidateQueries({ queryKey: ["set", setId] });
          });
        }}
        onAddTab={(title) => {
          void api
            .createTab(setId, {
              title,
              roles: ["COMPARATIVE"],
              assetMode: "METADATA_ONLY",
            })
            .then(() => void qc.invalidateQueries({ queryKey: ["set", setId] }));
        }}
      />

      <div className="grid grid-cols-3 border-b border-line-soft bg-surface p-1.5 lg:hidden" aria-label="연구 단계">
        {(
          [
            ["tree", "1", "대상"],
            ["workbench", "2", "관찰"],
            ["evidence", "3", "근거"],
          ] as const
        ).map(([key, step, label]) => (
          <button
            key={key}
            onClick={() => mobile.setPanel(key)}
            aria-pressed={mobile.panel === key}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-md text-xs font-semibold transition ${
              mobile.panel === key
                ? "bg-clay text-ink-inverse shadow-[var(--shadow-xs)]"
                : "text-ink-2 hover:bg-surface-muted"
            }`}
            data-testid={`mobile-panel-${key}`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${mobile.panel === key ? "bg-white/15" : "bg-surface-muted"}`}>
              {step}
            </span>
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)_22rem]">
        <aside
          className={`min-h-0 border-r border-[var(--panel-border)] ${mobile.panel === "tree" ? "block" : "hidden"} lg:block`}
          aria-label="자산·행·자 트리"
        >
          {detail ? (
            <GlyphTree detail={detail} selectedId={selectedGlyph} onSelect={selectGlyph} />
          ) : (
            <p className="p-3 text-xs text-ink-3">탭 불러오는 중…</p>
          )}
        </aside>
        <main
          className={`min-h-0 ${mobile.panel === "workbench" ? "block" : "hidden"} lg:block`}
        >
          {detail ? (
            <Workbench
              key={detail.tab.id}
              detail={detail}
              selectedId={selectedGlyph}
              onSelect={selectGlyph}
              onUiStateChange={changeUiState}
            />
          ) : (
            <p className="p-6 text-sm text-ink-3">탭 불러오는 중…</p>
          )}
        </main>
        <aside
          className={`min-h-0 border-l border-[var(--panel-border)] ${mobile.panel === "evidence" ? "block" : "hidden"} lg:block`}
          aria-label="후보·근거·반증 패널"
        >
          {detail && <EvidencePanel detail={detail} selectedId={selectedGlyph} />}
        </aside>
      </div>

      <CompareTray overview={overview} />
      {exportOpen && <ExportModal setId={setId} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
