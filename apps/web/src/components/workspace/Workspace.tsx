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
    mutationFn: (body: {
      activeTabOrder: string[];
      activeTabId?: string | null;
      pinnedTabIds?: string[];
    }) => api.saveTabOrder(setId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["set", setId] }),
  });

  const uiStateMutation = useMutation({
    mutationFn: ({ tabId, patch }: { tabId: string; patch: Partial<TabUiState> }) =>
      api.saveUiState(tabId, patch),
  });

  const activate = useCallback(
    (id: string) => {
      router.replace(`/sets/${setId}?tab=${id}`, { scroll: false });
      if (overview) {
        orderMutation.mutate({
          activeTabOrder: overview.set.activeTabOrder,
          activeTabId: id,
        });
      }
    },
    [router, setId, overview] // eslint-disable-line react-hooks/exhaustive-deps
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
      uiStateMutation.mutate(
        { tabId: activeTabId, patch },
        {
          onSuccess: () => {
            if (patch.renderMode || patch.lodLevel) {
              void qc.invalidateQueries({ queryKey: ["tab", activeTabId] });
            }
          },
        }
      );
    },
    [activeTabId, qc] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!overview) {
    return <p className="p-8 text-sm text-neutral-400">연구 세트 불러오는 중…</p>;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--panel-border)] bg-[#1a1a20] px-3 py-2">
        <Link href="/" className="text-sm text-neutral-400 hover:text-[var(--accent)]">
          ← 대시보드
        </Link>
        <h1 className="text-sm font-semibold sm:text-base" data-testid="set-title">
          {overview.set.name}
        </h1>
        <span className="badge badge-neutral hidden sm:inline-flex">
          미해결 {overview.stats.unresolvedGlyphs}
        </span>
        <span className="badge badge-rights hidden sm:inline-flex">
          권리 확인 {overview.stats.rightsWarnings}
        </span>
        <nav className="ml-auto flex items-center gap-2 text-xs">
          <Link href="/frontier" className="badge badge-frontier">
            Frontier
          </Link>
          <Link href={`/sets/${setId}/audit`} className="badge badge-neutral">
            감사 로그
          </Link>
          <button
            onClick={() => setExportOpen(true)}
            className="badge badge-demo"
            data-testid="open-export"
          >
            내보내기
          </button>
        </nav>
      </header>

      <TabStrip
        overview={overview}
        activeTabId={activeTabId}
        onActivate={activate}
        onReorder={(order) =>
          orderMutation.mutate({ activeTabOrder: order, activeTabId })
        }
        onPinToggle={(id) => {
          const pinned = overview.set.pinnedTabIds.includes(id)
            ? overview.set.pinnedTabIds.filter((p) => p !== id)
            : [...overview.set.pinnedTabIds, id];
          orderMutation.mutate({
            activeTabOrder: overview.set.activeTabOrder,
            activeTabId,
            pinnedTabIds: pinned,
          });
        }}
        onClose={(id) => {
          void api.archiveTab(id).then(() => {
            const remaining = overview.set.activeTabOrder.filter((t) => t !== id);
            orderMutation.mutate({
              activeTabOrder: remaining,
              activeTabId: activeTabId === id ? (remaining[0] ?? null) : activeTabId,
            });
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

      <div className="flex gap-1 border-b border-[var(--panel-border)] bg-[#1a1a20] px-2 py-1 lg:hidden">
        {(
          [
            ["tree", "트리"],
            ["workbench", "작업대"],
            ["evidence", "근거"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => mobile.setPanel(key)}
            className={`badge ${mobile.panel === key ? "badge-demo" : "badge-neutral"}`}
            data-testid={`mobile-panel-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <aside
          className={`min-h-0 border-r border-[var(--panel-border)] ${mobile.panel === "tree" ? "block" : "hidden"} lg:block`}
          aria-label="자산·행·자 트리"
        >
          {detail ? (
            <GlyphTree detail={detail} selectedId={selectedGlyph} onSelect={selectGlyph} />
          ) : (
            <p className="p-3 text-xs text-neutral-500">탭 불러오는 중…</p>
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
            <p className="p-6 text-sm text-neutral-500">탭 불러오는 중…</p>
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
