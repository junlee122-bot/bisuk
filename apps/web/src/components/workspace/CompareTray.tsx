"use client";

import Link from "next/link";
import { useState } from "react";
import type { SetOverview } from "@/lib/api";
import { useCompareTray } from "@/lib/store";

export function CompareTray({ overview }: { overview: SetOverview }) {
  const tray = useCompareTray();
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  if (tray.cellIds.length === 0) return null;

  const toggleTab = (id: string) =>
    setSelectedTabs((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id].slice(-6)
    );

  const compareHref = `/sets/${overview.set.id}/compare?cells=${tray.cellIds.join(",")}&tabs=${selectedTabs.join(",")}`;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-[var(--panel-border)] bg-[#1a1a20] px-3 py-2 text-xs"
      data-testid="compare-tray"
      aria-label="비교 트레이"
    >
      <span className="font-semibold text-neutral-400">비교 트레이</span>
      {tray.cellIds.map((id) => (
        <span key={id} className="badge badge-neutral">
          {id}
          <button onClick={() => tray.remove(id)} aria-label={`${id} 제거`} className="ml-1">
            ✕
          </button>
        </span>
      ))}
      <span className="ml-2 text-neutral-500">비교 탭:</span>
      {overview.tabs.map(({ tab }) => (
        <label key={tab.id} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={selectedTabs.includes(tab.id)}
            onChange={() => toggleTab(tab.id)}
            data-testid={`compare-tab-check-${tab.id}`}
          />
          <span className="max-w-24 truncate">{tab.title}</span>
        </label>
      ))}
      <Link
        href={selectedTabs.length >= 2 ? compareHref : "#"}
        aria-disabled={selectedTabs.length < 2}
        className={`badge ${selectedTabs.length >= 2 ? "badge-demo" : "badge-neutral opacity-40"}`}
        data-testid="open-glyph-matrix"
      >
        Glyph Matrix 열기 →
      </Link>
      <button onClick={tray.clear} className="badge badge-neutral" aria-label="트레이 비우기">
        비우기
      </button>
    </div>
  );
}
