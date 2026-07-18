"use client";

import { useState } from "react";
import type { TabDetail } from "@/lib/api";
import { DemoBadge, ReadingBadge, RightsBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { Icon } from "@/components/ui/Icon";

export function GlyphTree({
  detail,
  selectedId,
  onSelect,
}: {
  detail: TabDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ko");
  const visibleCells = normalizedQuery
    ? detail.glyphCells.filter((cell) =>
        [cell.id, cell.publishedReading, cell.faceId, String(cell.lineIndex)]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("ko").includes(normalizedQuery))
      )
    : detail.glyphCells;
  const lines = new Map<string, { faceId: string; lineIndex: number; cells: typeof detail.glyphCells }>();
  for (const c of visibleCells) {
    const key = `${c.faceId}#${c.lineIndex}`;
    const group = lines.get(key) ?? { faceId: c.faceId, lineIndex: c.lineIndex, cells: [] };
    group.cells.push(c);
    lines.set(key, group);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface" data-testid="glyph-tree">
      <header className="sticky top-0 z-10 border-b border-line-soft bg-[var(--surface-elevated)] p-3 backdrop-blur">
        <p className="section-label">Step 1 · Target</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">대상 선택</h2>
            <p className="text-[11px] text-ink-3">자산·행·문자 영역을 탐색합니다.</p>
          </div>
          <span className="badge badge-neutral">문자 {detail.glyphCells.length}</span>
        </div>
        {detail.glyphCells.length > 0 && (
          <label className="relative mt-3 block">
            <span className="sr-only">문자 셀 검색</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="문자 ID·판독 검색"
              className="ui-input min-h-9 w-full py-1.5 pl-8 text-xs"
            />
          </label>
        )}
      </header>
      <div className="space-y-2 p-2.5">
      <section className="panel p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-ink-2">연결 자산</h3>
          <span className="text-[10px] tabular-nums text-ink-3">{detail.assets.length}건</span>
        </div>
        <ul className="space-y-1 text-xs">
          {detail.assets.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-1">
              <span className="badge badge-neutral">{a.assetType}</span>
              {a.provenance === "VIRTUAL_DEMO" ? (
                <DemoBadge label={a.demoLabel ?? "가상"} />
              ) : (
                <>
                  <span className="truncate">{a.originalFilename}</span>
                  <RightsBadge state={a.rightsState} />
                </>
              )}
            </li>
          ))}
          {detail.assets.length === 0 && (
            <li className="text-ink-3">등록된 자산 없음 (메타데이터 전용)</li>
          )}
        </ul>
      </section>
      {[...lines.values()]
        .sort((a, b) => a.faceId.localeCompare(b.faceId) || a.lineIndex - b.lineIndex)
        .map(({ faceId, lineIndex, cells }) => (
          <section key={`${faceId}#${lineIndex}`} className="panel p-2.5">
            <h3 className="mb-1 text-xs font-semibold text-ink-2">
              {faceId} · {lineIndex}행
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {cells
                .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className="flex flex-col items-center gap-0.5"
                    data-testid={`glyph-cell-${c.id}`}
                    aria-label={`문자 셀 ${c.id} 선택`}
                  >
                    <GlyphPatchSvg cell={c} size={44} selected={c.id === selectedId} />
                    <ReadingBadge status={c.readingStatus} />
                  </button>
                ))}
            </div>
          </section>
        ))}
      {detail.glyphCells.length === 0 && (
        <p className="p-2 text-xs text-ink-3">
          문자 셀 없음 — 이 탭은 문헌·메타데이터 전용입니다.
        </p>
      )}
      {detail.glyphCells.length > 0 && visibleCells.length === 0 && (
        <div className="rounded-lg border border-dashed border-line-strong p-4 text-center">
          <Icon name="search" className="mx-auto h-5 w-5 text-ink-3" />
          <p className="mt-2 text-xs font-medium">일치하는 문자가 없습니다.</p>
          <button type="button" onClick={() => setQuery("")} className="mt-2 text-xs font-semibold text-clay hover:underline">
            검색 초기화
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
