"use client";

import { useState } from "react";
import type { SetOverview } from "@/lib/api";
import { RoleBadges } from "@/components/badges";
import { Icon } from "@/components/ui/Icon";

export function TabStrip({
  overview,
  activeTabId,
  onActivate,
  onReorder,
  onPinToggle,
  onClose,
  onAddTab,
}: {
  overview: SetOverview;
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onReorder: (order: string[]) => void;
  onPinToggle: (id: string) => void;
  onClose: (id: string) => void;
  onAddTab: (title: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const order = overview.set.activeTabOrder.filter((id) =>
    overview.tabs.some((t) => t.tab.id === id)
  );
  const pinned = new Set(overview.set.pinnedTabIds);
  const sorted = [
    ...order.filter((id) => pinned.has(id)),
    ...order.filter((id) => !pinned.has(id)),
  ];

  const move = (id: string, dir: -1 | 1) => {
    const idx = order.indexOf(id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    next[idx] = next[target]!;
    next[target] = id;
    onReorder(next);
  };

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto border-b border-line-soft bg-surface-2 px-2 py-2"
    >
      <div className="sticky left-0 z-10 mr-1 flex shrink-0 items-center gap-2 border-r border-line-soft bg-surface-2 pr-3 text-xs" role="presentation">
        <span className="font-semibold text-ink-2">연구 대상</span>
        <span className="badge badge-neutral">{sorted.length}</span>
      </div>
      <div className="contents" role="tablist" aria-label="비석 탭">
      {sorted.map((id) => {
        const entry = overview.tabs.find((t) => t.tab.id === id);
        if (!entry) return null;
        const { tab, badges } = entry;
        const active = id === activeTabId;
        return (
          <div
            key={id}
            className={`group relative flex min-h-10 shrink-0 items-center gap-1 rounded-lg border px-1.5 py-1 text-sm transition ${
              active
                ? "border-line-strong bg-surface shadow-[var(--shadow-xs)] after:absolute after:inset-y-2 after:left-0 after:w-0.5 after:rounded-full after:bg-clay"
                : "border-transparent bg-transparent hover:border-line-soft hover:bg-surface"
            }`}
            data-testid={`tab-${id}`}
            data-active={active}
            data-pinned={pinned.has(id)}
          >
            <button
              role="tab"
              aria-selected={active}
              onClick={() => onActivate(id)}
              className="flex min-h-8 items-center gap-1.5 px-1"
              title={tab.canonicalName}
            >
              {pinned.has(id) && <span className="h-1.5 w-1.5 rounded-full bg-clay" aria-label="고정됨" />}
              <svg
                viewBox="0 0 10 14"
                width="10"
                height="14"
                aria-hidden="true"
                className={active ? "text-clay" : "text-ink-3"}
              >
                <path
                  d="M2 13 L2 3 Q2 1 5 1 Q8 1 8 3 L8 13 Z"
                  fill="currentColor"
                  opacity="0.85"
                />
              </svg>
              <span className={`max-w-36 truncate ${active ? "font-medium" : ""}`}>
                {tab.title}
              </span>
              <RoleBadges roles={tab.roles} />
              {badges.has3d && <span className="badge badge-neutral">3D</span>}
              {badges.unresolvedCount > 0 && (
                <span className="badge badge-warn" title="미해결 문자 수">
                  {badges.unresolvedCount}
                </span>
              )}
              {badges.rightsWarning && (
                <span className="badge badge-rights" title="권리 확인 필요">
                  ⚠
                </span>
              )}
              {badges.hasVirtualDemo && (
                <span className="badge badge-demo" title="가상 데모 자산 포함">
                  ◈
                </span>
              )}
            </button>
            <span className={`${active ? "flex" : "hidden"} items-center gap-0.5 text-[10px] text-ink-3 group-hover:flex group-focus-within:flex`}>
              <button
                onClick={() => move(id, -1)}
                aria-label={`${tab.title} 왼쪽으로 이동`}
                data-testid={`tab-move-left-${id}`}
                className="rounded px-1 py-1 hover:bg-surface-muted hover:text-ink"
              >
                ‹
              </button>
              <button
                onClick={() => move(id, 1)}
                aria-label={`${tab.title} 오른쪽으로 이동`}
                data-testid={`tab-move-right-${id}`}
                className="rounded px-1 py-1 hover:bg-surface-muted hover:text-ink"
              >
                ›
              </button>
              <button
                onClick={() => onPinToggle(id)}
                aria-label={`${tab.title} 고정 전환`}
                data-testid={`tab-pin-${id}`}
                className="rounded px-1 py-1 hover:bg-surface-muted hover:text-ink"
              >
                고정
              </button>
              <button
                onClick={() => onClose(id)}
                aria-label={`${tab.title} 닫기(보관)`}
                data-testid={`tab-close-${id}`}
                className="rounded px-1 py-1 hover:bg-[#f7e3e0] hover:text-[var(--state-danger)]"
              >
                ✕
              </button>
            </span>
          </div>
        );
      })}
      </div>
      {adding ? (
        <form
          className="flex shrink-0 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) {
              onAddTab(newTitle.trim());
              setNewTitle("");
              setAdding(false);
            }
          }}
        >
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="비석 이름"
            className="ui-input h-9 min-h-9 w-44 py-1 text-sm"
            aria-label="새 탭 비석 이름"
          />
          <button type="submit" className="badge badge-ok">
            추가
          </button>
          <button type="button" className="badge badge-neutral" onClick={() => setAdding(false)}>
            취소
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="ui-button ui-button-secondary min-h-9 shrink-0 px-2.5 py-1"
          data-testid="tab-add"
        >
          <Icon name="plus" /> 대상 추가
        </button>
      )}
    </div>
  );
}
