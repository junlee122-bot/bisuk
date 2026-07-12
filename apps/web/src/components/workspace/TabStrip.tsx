"use client";

import { useState } from "react";
import type { SetOverview } from "@/lib/api";
import { RoleBadges } from "@/components/badges";

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
      className="flex items-center gap-1 overflow-x-auto border-b border-[var(--panel-border)] bg-surface px-2 py-1.5"
      role="tablist"
      aria-label="비석 탭"
    >
      {sorted.map((id) => {
        const entry = overview.tabs.find((t) => t.tab.id === id);
        if (!entry) return null;
        const { tab, badges } = entry;
        const active = id === activeTabId;
        return (
          <div
            key={id}
            className={`group relative flex shrink-0 items-center gap-1.5 rounded-t-lg border px-2 py-1 text-sm ${
              active
                ? "border-line-soft bg-[var(--panel-bg)] shadow-[var(--shadow-xs)] after:absolute after:inset-x-1 after:top-0 after:h-0.5 after:rounded-full after:bg-clay"
                : "border-transparent bg-surface-muted hover:border-line-soft"
            }`}
            data-testid={`tab-${id}`}
            data-active={active}
            data-pinned={pinned.has(id)}
          >
            <button
              role="tab"
              aria-selected={active}
              onClick={() => onActivate(id)}
              className="flex items-center gap-1.5"
              title={tab.canonicalName}
            >
              {pinned.has(id) && <span aria-label="고정됨">📌</span>}
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
            <span className="hidden items-center gap-0.5 text-xs text-ink-3 group-hover:flex group-focus-within:flex">
              <button
                onClick={() => move(id, -1)}
                aria-label={`${tab.title} 왼쪽으로 이동`}
                data-testid={`tab-move-left-${id}`}
              >
                ◀
              </button>
              <button
                onClick={() => move(id, 1)}
                aria-label={`${tab.title} 오른쪽으로 이동`}
                data-testid={`tab-move-right-${id}`}
              >
                ▶
              </button>
              <button
                onClick={() => onPinToggle(id)}
                aria-label={`${tab.title} 고정 전환`}
                data-testid={`tab-pin-${id}`}
              >
                📌
              </button>
              <button
                onClick={() => onClose(id)}
                aria-label={`${tab.title} 닫기(보관)`}
                data-testid={`tab-close-${id}`}
              >
                ✕
              </button>
            </span>
          </div>
        );
      })}
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
            className="w-40 rounded border border-[var(--panel-border)] bg-transparent px-2 py-0.5 text-sm"
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
          className="shrink-0 rounded px-2 py-1 text-sm text-ink-2 hover:text-[var(--accent)]"
          data-testid="tab-add"
        >
          + 탭 추가
        </button>
      )}
    </div>
  );
}
