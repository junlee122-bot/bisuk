"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReadingStatus } from "@seokmun/types";
import { faceLabelFor } from "@seokmun/engine";
import type { TabDetail } from "@/lib/api";
import { DemoBadge, ReadingBadge, RightsBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";

/** 한 번에 그리는 행 묶음 수 — 스크롤하면 더 그린다 (수천 자 비석 대응) */
const LINE_BATCH = 30;

const FILTERS: Array<[string, string, (s: ReadingStatus, adopted: boolean) => boolean]> = [
  ["all", "전체", () => true],
  ["unresolved", "미해결", (s) => ["UNKNOWN", "CONFLICTING", "PARTIALLY_OBSERVED", "ILLEGIBLE"].includes(s)],
  ["conflicting", "상충", (s) => s === "CONFLICTING"],
  ["auto", "자동 확정", (s) => s === "MULTI_SOURCE_AUTOMATIC"],
  ["adopted", "연구실 채택", (_s, a) => a],
  ["observed", "관측", (s) => s === "OBSERVED"],
];

export function GlyphTree({
  detail,
  selectedId,
  onSelect,
}: {
  detail: TabDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [lineQuery, setLineQuery] = useState("");
  const [limit, setLimit] = useState(LINE_BATCH);
  const sentinel = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const pred = FILTERS.find(([k]) => k === filter)?.[2] ?? (() => true);
    const lineNo = Number(lineQuery);
    const lines = new Map<string, { faceId: string; lineIndex: number; cells: typeof detail.glyphCells }>();
    for (const c of detail.glyphCells) {
      if (!pred(c.readingStatus, Boolean(c.adoptedReadingId))) continue;
      if (lineQuery && Number.isFinite(lineNo) && c.lineIndex !== lineNo) continue;
      const key = `${c.faceId}#${c.lineIndex}`;
      const group = lines.get(key) ?? { faceId: c.faceId, lineIndex: c.lineIndex, cells: [] };
      group.cells.push(c);
      lines.set(key, group);
    }
    return [...lines.values()]
      .sort((a, b) => a.faceId.localeCompare(b.faceId) || a.lineIndex - b.lineIndex)
      .map((g) => ({ ...g, cells: [...g.cells].sort((a, b) => a.sequenceIndex - b.sequenceIndex) }));
  }, [detail.glyphCells, filter, lineQuery]);

  // 선택 셀이 아직 그려지지 않은 묶음에 있으면 그 행까지 펼친다
  useEffect(() => {
    if (!selectedId) return;
    const idx = groups.findIndex((g) => g.cells.some((c) => c.id === selectedId));
    if (idx >= limit) setLimit(idx + LINE_BATCH);
  }, [selectedId, groups]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setLimit(LINE_BATCH), [filter, lineQuery, detail.tab.id]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= groups.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + LINE_BATCH);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, groups.length]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="glyph-tree">
      <section className="panel p-2">
        <h3 className="mb-1 text-xs font-semibold text-ink-2">자산</h3>
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
          {detail.assets.length === 0 && <li className="text-ink-3">등록된 자산 없음 (메타데이터 전용)</li>}
        </ul>
      </section>
      {detail.glyphCells.length > 0 && (
        <div className="flex items-center gap-1 text-[11px]">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1 py-0.5"
            aria-label="판독 상태 필터"
            data-testid="glyph-filter"
          >
            {FILTERS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input
            value={lineQuery}
            onChange={(e) => setLineQuery(e.target.value.replace(/\D/g, ""))}
            placeholder="행"
            className="w-12 rounded border border-[var(--panel-border)] bg-transparent px-1 py-0.5"
            aria-label="행 번호로 찾기"
          />
          <span className="ml-auto text-ink-3">{groups.reduce((n, g) => n + g.cells.length, 0)}자</span>
        </div>
      )}
      {groups.slice(0, limit).map(({ faceId, lineIndex, cells }) => (
        <section key={`${faceId}#${lineIndex}`} className="panel p-2">
          <h3 className="mb-1 text-xs font-semibold text-ink-2" title={faceId}>
            {faceLabelFor(faceId)} · {lineIndex}행
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {cells.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className="flex flex-col items-center gap-0.5"
                data-testid={`glyph-cell-${c.id}`}
                aria-label={`문자 셀 ${c.id} 선택`}
              >
                <GlyphPatchSvg cell={c} size={44} selected={c.id === selectedId} />
                <ReadingBadge status={c.readingStatus} />
                {c.adoptedReadingId && <span className="text-[9px] text-[var(--state-success)]">채택</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
      {limit < groups.length && (
        <div ref={sentinel} className="py-2 text-center text-[11px] text-ink-3">
          나머지 {groups.length - limit}행 불러오는 중…
        </div>
      )}
      {detail.glyphCells.length === 0 && (
        <p className="p-2 text-xs text-ink-3">문자 셀 없음 — ‘비석 관리 → 판독문 가져오기’ 또는 ‘셀 추가’로 시작하세요.</p>
      )}
      {detail.glyphCells.length > 0 && groups.length === 0 && <p className="p-2 text-xs text-ink-3">조건에 맞는 셀 없음</p>}
    </div>
  );
}
