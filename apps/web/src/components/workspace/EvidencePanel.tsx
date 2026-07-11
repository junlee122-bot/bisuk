"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalyzeGlyphResponse } from "@seokmun/types";
import { api, type TabDetail } from "@/lib/api";
import { ReadingBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { useCompareTray } from "@/lib/store";
import { DossierModal } from "./DossierModal";

function LiteratureSearch({ tabId }: { tabId: string }) {
  const [q, setQ] = useState("");
  const [stance, setStance] = useState<"ALL" | "SUPPORT" | "COUNTER">("ALL");
  const [submitted, setSubmitted] = useState("");
  const { data: hits, isFetching } = useQuery({
    queryKey: ["literature", submitted, stance],
    queryFn: () => api.searchLiterature(submitted, stance),
    enabled: submitted.length > 0,
  });
  return (
    <section className="panel p-2" data-testid="literature-search">
      <h3 className="text-xs font-semibold text-neutral-400">문헌 검색 (BM25 + 이체자)</h3>
      <form
        className="mt-1 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: 安 판독"
          className="min-w-0 flex-1 rounded border border-[var(--panel-border)] bg-transparent px-2 py-1 text-xs"
          aria-label="문헌 검색어"
          data-testid="literature-query"
        />
        <select
          value={stance}
          onChange={(e) => setStance(e.target.value as typeof stance)}
          className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1 py-1 text-xs"
          aria-label="근거 유형"
          data-testid="literature-stance"
        >
          <option value="ALL">전체</option>
          <option value="SUPPORT">지지</option>
          <option value="COUNTER">반증</option>
        </select>
        <button type="submit" className="badge badge-neutral" data-testid="literature-submit">
          검색
        </button>
      </form>
      {isFetching && <p className="mt-1 text-xs text-neutral-500">검색 중…</p>}
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
        {hits?.map((h) => (
          <li key={h.document.id} className="rounded bg-[#26262e] p-2 text-xs" data-testid="literature-hit">
            <div className="flex flex-wrap items-center gap-1">
              <strong className="text-neutral-200">{h.document.title}</strong>
              {h.document.isFictional && <span className="badge badge-demo">허구 문헌</span>}
              {h.benchmarkLeak && (
                <span className="badge badge-rights">누출 위험 — 근거 사용 금지</span>
              )}
              <span className="badge badge-neutral">tier {h.document.reliabilityTier}</span>
            </div>
            <p className="mt-1 text-neutral-400">…{h.snippet}…</p>
            {h.claims.length > 0 && (
              <p className="mt-1 text-neutral-500">
                주장:{" "}
                {h.claims
                  .map((c) => `${c.character} ${c.stance === "SUPPORT" ? "지지" : "반대"}`)
                  .join(", ")}
              </p>
            )}
          </li>
        ))}
        {hits && hits.length === 0 && (
          <li className="text-xs text-neutral-500">결과 없음</li>
        )}
      </ul>
      <p className="sr-only">{tabId}</p>
    </section>
  );
}

export function EvidencePanel({
  detail,
  selectedId,
}: {
  detail: TabDetail;
  selectedId: string | null;
}) {
  const qc = useQueryClient();
  const tray = useCompareTray();
  const [dossierOpen, setDossierOpen] = useState(false);
  const [result, setResult] = useState<AnalyzeGlyphResponse | null>(null);
  const cell = detail.glyphCells.find((c) => c.id === selectedId) ?? null;

  const analyzeMutation = useMutation({
    mutationFn: (id: string) => api.analyzeGlyph(id),
    onSuccess: (data) => {
      setResult(data);
      void qc.invalidateQueries({ queryKey: ["tab", detail.tab.id] });
      void qc.invalidateQueries({ queryKey: ["dossier", data.glyphCell.id] });
    },
  });

  const shownResult = result && result.glyphCell.id === selectedId ? result : null;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="evidence-panel">
      {!cell && (
        <p className="p-3 text-xs text-neutral-500">
          작업대나 트리에서 문자 셀을 선택하면 후보·근거·반증이 표시됩니다.
        </p>
      )}
      {cell && (
        <>
          <section className="panel flex items-center gap-3 p-2">
            <GlyphPatchSvg cell={cell} size={64} />
            <div className="text-xs">
              <p className="font-semibold">{cell.id}</p>
              <p className="mt-0.5 flex flex-wrap gap-1">
                <ReadingBadge status={cell.readingStatus} />
                <span className="badge badge-neutral">관측도 {cell.observabilityScore}</span>
                <span className="badge badge-neutral">손상 {cell.damageGrade}</span>
              </p>
              {cell.publishedReading && (
                <p className="mt-0.5 text-neutral-400">
                  기존 판독(공개): {cell.publishedReading}
                </p>
              )}
            </div>
          </section>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => analyzeMutation.mutate(cell.id)}
              disabled={analyzeMutation.isPending}
              className="badge badge-demo disabled:opacity-40"
              data-testid="analyze-button"
            >
              {analyzeMutation.isPending ? "분석 중…" : "▶ 독립 분석 실행"}
            </button>
            <button
              onClick={() => setDossierOpen(true)}
              className="badge badge-neutral"
              data-testid="open-dossier"
            >
              Evidence Dossier
            </button>
            <button
              onClick={() => tray.add(cell.id)}
              className="badge badge-frontier"
              data-testid="add-to-compare"
            >
              + 비교 트레이
            </button>
          </div>

          {shownResult && (
            <>
              <section className="panel p-2" data-testid="analysis-result">
                <h3 className="text-xs font-semibold text-neutral-400">
                  결정{" "}
                  <span
                    className={`badge ${
                      shownResult.decision?.outcome === "AUTO_ACCEPTED"
                        ? "badge-ok"
                        : shownResult.decision?.outcome === "CONFLICTING"
                          ? "badge-rights"
                          : "badge-warn"
                    }`}
                    data-testid="decision-outcome"
                  >
                    {shownResult.decision?.outcome ?? "결정 없음"}
                  </span>
                </h3>
                {shownResult.decision && !shownResult.decision.passed && (
                  <p className="mt-1 text-[11px] text-amber-200" data-testid="failed-rules">
                    게이트 실패: {shownResult.decision.failedRules.join(", ")}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-neutral-500">
                  독립 계보 {shownResult.independentLineageCount}개 · 실행 {shownResult.runId}
                </p>
              </section>

              <section className="panel p-2" data-testid="candidates">
                <h3 className="text-xs font-semibold text-neutral-400">후보 (독립 생성)</h3>
                <table className="mt-1 w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th>후보</th>
                      <th>출처</th>
                      <th className="text-right">시각</th>
                      <th className="text-right">교차</th>
                      <th className="text-right">문헌</th>
                      <th className="text-right">신뢰도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownResult.candidates.map((c) => (
                      <tr
                        key={c.id}
                        className="border-t border-[var(--panel-border)]"
                        data-testid={`candidate-${c.candidateCharacter}`}
                      >
                        <td className="py-1 text-base">{c.candidateCharacter}</td>
                        <td className="text-neutral-500">{c.origin}</td>
                        <td className="text-right tabular-nums">{c.visualScore}</td>
                        <td className="text-right tabular-nums">{c.crossSteleScore}</td>
                        <td className="text-right tabular-nums">{c.textualScore}</td>
                        <td className="text-right font-semibold tabular-nums">
                          {c.calibratedConfidence}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="panel p-2" data-testid="evidence-list">
                <h3 className="text-xs font-semibold text-neutral-400">근거 · 반증</h3>
                <ul className="mt-1 max-h-64 space-y-1.5 overflow-y-auto">
                  {shownResult.evidence.map((e) => (
                    <li key={e.id} className="rounded bg-[#26262e] p-2 text-[11px]">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`badge ${e.kind === "SUPPORT" ? "badge-ok" : "badge-rights"}`}
                        >
                          {e.kind === "SUPPORT" ? "지지" : "반대"}
                        </span>
                        <span
                          className={`badge ${e.citationVerified ? "badge-ok" : "badge-warn"}`}
                        >
                          {e.citationVerified ? "인용 검증" : "미검증"}
                        </span>
                        <span className="badge badge-neutral">{e.independenceGroup}</span>
                      </div>
                      <p className="mt-1 text-neutral-300">{e.note}</p>
                      <blockquote className="mt-0.5 border-l-2 border-[var(--accent)] pl-1.5 text-neutral-400">
                        {e.quote}
                      </blockquote>
                    </li>
                  ))}
                  {shownResult.evidence.length === 0 && (
                    <li className="text-neutral-500">문헌 근거 없음</li>
                  )}
                </ul>
              </section>
            </>
          )}
        </>
      )}
      <LiteratureSearch tabId={detail.tab.id} />
      {dossierOpen && cell && (
        <DossierModal glyphCellId={cell.id} onClose={() => setDossierOpen(false)} />
      )}
    </div>
  );
}
