"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DemoBadge, ReadingBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { DossierModal } from "@/components/workspace/DossierModal";

function RowCandidates({ cellId }: { cellId: string }) {
  const [error, setError] = useState<string | null>(null);
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["dossier", cellId],
    queryFn: () => api.getDossier(cellId),
  });
  const hasRun = Boolean(data?.conclusion);
  return (
    <div className="mt-1 text-[11px]" data-testid={`row-candidates-${cellId}`}>
      {hasRun ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="badge badge-demo">
            현재 후보 {data!.conclusion!.candidateCharacter} ·{" "}
            {data!.conclusion!.calibratedConfidence}
          </span>
          {data!.alternates.slice(0, 2).map((a) => (
            <span key={a.id} className="badge badge-neutral">
              {a.candidateCharacter} {a.calibratedConfidence}
            </span>
          ))}
        </div>
      ) : (
        <button
          onClick={() => {
            setError(null);
            api
              .analyzeGlyph(cellId)
              .then(() => refetch())
              .catch((e: Error) => setError(e.message));
          }}
          className="badge badge-neutral"
          disabled={isFetching}
          data-testid={`row-analyze-${cellId}`}
        >
          분석 실행
        </button>
      )}
      {error && <p className="mt-0.5 text-red-400">분석 실패: {error}</p>}
    </div>
  );
}

export function CompareScreen({ setId }: { setId: string }) {
  const searchParams = useSearchParams();
  const cells = (searchParams.get("cells") ?? "").split(",").filter(Boolean);
  const tabs = (searchParams.get("tabs") ?? "").split(",").filter(Boolean);
  const [dossierCell, setDossierCell] = useState<string | null>(null);

  const { data: matrix, error } = useQuery({
    queryKey: ["matrix", cells.join(","), tabs.join(",")],
    queryFn: () => api.compareGlyphs({ glyphCellIds: cells, tabIds: tabs }),
    enabled: cells.length > 0 && tabs.length >= 2,
  });

  return (
    <main className="min-h-screen p-3 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/sets/${setId}`}
          className="text-sm text-neutral-400 hover:text-[var(--accent)]"
        >
          ← 워크스페이스
        </Link>
        <h1 className="text-lg font-semibold">Glyph Matrix 비교</h1>
        <DemoBadge label="가상 데모 자형 비교 — 실제 판독 아님" />
      </header>

      {(cells.length === 0 || tabs.length < 2) && (
        <p className="text-sm text-neutral-400">
          비교하려면 문자 셀 1개 이상과 비석 탭 2개 이상을 선택하세요. (워크스페이스 →
          비교 트레이)
        </p>
      )}
      {error && <p className="text-sm text-red-400">{(error as Error).message}</p>}

      {matrix && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse" data-testid="glyph-matrix">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs text-neutral-500">선택 글자</th>
                {matrix.rows[0]?.columns.map((col) => (
                  <th key={col.tab.id} className="p-2 text-left text-xs text-neutral-400">
                    {col.tab.title}
                    <span className="ml-1 text-neutral-600">
                      ({col.tab.roles.join("/")})
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr
                  key={row.sourceGlyphCell.id}
                  className="border-t border-[var(--panel-border)] align-top"
                  data-testid={`matrix-row-${row.sourceGlyphCell.id}`}
                >
                  <td className="p-2">
                    <div className="flex items-start gap-2">
                      <GlyphPatchSvg cell={row.sourceGlyphCell} size={64} />
                      <div className="text-xs">
                        <p className="font-semibold">{row.sourceGlyphCell.id}</p>
                        <p className="text-neutral-500">{row.sourceTab.title}</p>
                        <ReadingBadge status={row.sourceGlyphCell.readingStatus} />
                        <RowCandidates cellId={row.sourceGlyphCell.id} />
                        <button
                          onClick={() => setDossierCell(row.sourceGlyphCell.id)}
                          className="badge badge-frontier mt-1"
                          data-testid={`open-evidence-${row.sourceGlyphCell.id}`}
                        >
                          근거 열기
                        </button>
                      </div>
                    </div>
                  </td>
                  {row.columns.map((col) => {
                    const cell = col.cells[0];
                    return (
                      <td key={col.tab.id} className="p-2" data-testid={`matrix-cell-${row.sourceGlyphCell.id}-${col.tab.id}`}>
                        {cell?.glyphCell ? (
                          <div className="flex items-start gap-2">
                            <GlyphPatchSvg cell={cell.glyphCell} size={64} />
                            <div className="text-[11px]">
                              {cell.publishedReading && (
                                <p>
                                  기존 판독:{" "}
                                  <span className="text-base">{cell.publishedReading}</span>
                                </p>
                              )}
                              {cell.match && (
                                <p className="text-neutral-400">
                                  유사도{" "}
                                  <span className="font-semibold text-neutral-200">
                                    {cell.match.combinedScore}
                                  </span>
                                </p>
                              )}
                              <ReadingBadge status={cell.glyphCell.readingStatus} />
                              <p className="mt-0.5">
                                <span className="badge badge-demo">가상</span>
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-600">
                            유사 글자 없음 / 자산 없음
                          </p>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dossierCell && (
        <DossierModal glyphCellId={dossierCell} onClose={() => setDossierCell(null)} />
      )}
    </main>
  );
}
