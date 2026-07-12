"use client";

import type { TabDetail } from "@/lib/api";
import { DemoBadge, ReadingBadge, RightsBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";

export function GlyphTree({
  detail,
  selectedId,
  onSelect,
}: {
  detail: TabDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const lines = new Map<string, { faceId: string; lineIndex: number; cells: typeof detail.glyphCells }>();
  for (const c of detail.glyphCells) {
    const key = `${c.faceId}#${c.lineIndex}`;
    const group = lines.get(key) ?? { faceId: c.faceId, lineIndex: c.lineIndex, cells: [] };
    group.cells.push(c);
    lines.set(key, group);
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="glyph-tree">
      <section className="panel p-2">
        <h3 className="mb-1 text-xs font-semibold text-neutral-400">자산</h3>
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
            <li className="text-neutral-500">등록된 자산 없음 (메타데이터 전용)</li>
          )}
        </ul>
      </section>
      {[...lines.values()]
        .sort((a, b) => a.faceId.localeCompare(b.faceId) || a.lineIndex - b.lineIndex)
        .map(({ faceId, lineIndex, cells }) => (
          <section key={`${faceId}#${lineIndex}`} className="panel p-2">
            <h3 className="mb-1 text-xs font-semibold text-neutral-400">
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
        <p className="p-2 text-xs text-neutral-500">
          문자 셀 없음 — 이 탭은 문헌·메타데이터 전용입니다.
        </p>
      )}
    </div>
  );
}
