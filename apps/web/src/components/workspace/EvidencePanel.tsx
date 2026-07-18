"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalyzeGlyphResponse } from "@seokmun/types";
import { api, type TabDetail } from "@/lib/api";
import { ReadingBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { useCompareTray } from "@/lib/store";
import { DossierModal } from "./DossierModal";
import { Icon } from "@/components/ui/Icon";

function DocumentUpload({ tabId }: { tabId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api.uploadDocument({ title, content, docType: "USER_NOTE", relatedTabIds: [tabId] }),
    onSuccess: () => {
      setDone(`'${title}' 색인 완료 — 검색에서 즉시 조회 가능`);
      setTitle("");
      setContent("");
      // 같은 검색어의 캐시 결과를 무효화해 새 문헌이 바로 보이게 한다
      void qc.invalidateQueries({ queryKey: ["literature"] });
    },
  });
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="badge badge-neutral mt-1"
        data-testid="doc-upload-toggle"
      >
        + 문헌 추가 (TXT 붙여넣기)
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-1"
      data-testid="doc-upload-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && content.trim().length >= 10) mutation.mutate();
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="문헌 제목"
        className="w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="문헌 제목"
        data-testid="doc-title"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="본문 텍스트 (10자 이상) — 색인 후 BM25 검색과 인용 검증에 사용"
        rows={3}
        className="w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="문헌 본문"
        data-testid="doc-content"
      />
      <div className="flex gap-1">
        <button type="submit" className="badge badge-ok" disabled={mutation.isPending} data-testid="doc-submit">
          색인
        </button>
        <button type="button" className="badge badge-neutral" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      {done && <p className="text-[11px] text-[var(--state-success)]" data-testid="doc-done">{done}</p>}
    </form>
  );
}

function LiteratureSearch({
  tabId,
  initialQuery,
}: {
  tabId: string;
  initialQuery: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [stance, setStance] = useState<"ALL" | "SUPPORT" | "COUNTER">("ALL");
  const [submitted, setSubmitted] = useState("");
  const { data: hits, isFetching } = useQuery({
    queryKey: ["literature", submitted, stance],
    queryFn: () => api.searchLiterature(submitted, stance),
    enabled: submitted.length > 0,
  });
  return (
    <section className="panel p-2" data-testid="literature-search">
      <h3 className="text-xs font-semibold text-ink-2">문헌 검색 (BM25 + 이체자)</h3>
      <form
        className="mt-1 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q);
          // 새로고침 복원 대상 — 탭 UI 상태에 검색어 저장 (실패해도 검색은 진행)
          void api.saveUiState(tabId, { literatureQuery: q }).catch(() => undefined);
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
      {isFetching && <p className="mt-1 text-xs text-ink-3">검색 중…</p>}
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
        {hits?.map((h) => (
          <li key={h.document.id} className="rounded bg-surface-2 p-2 text-xs" data-testid="literature-hit">
            <div className="flex flex-wrap items-center gap-1">
              <strong className="text-ink">{h.document.title}</strong>
              {h.document.isFictional && <span className="badge badge-demo">허구 문헌</span>}
              {h.benchmarkLeak && (
                <span className="badge badge-rights">누출 위험 — 근거 사용 금지</span>
              )}
              <span className="badge badge-neutral">tier {h.document.reliabilityTier}</span>
            </div>
            <p className="mt-1 text-ink-2">…{h.snippet}…</p>
            {h.claims.length > 0 && (
              <p className="mt-1 text-ink-3">
                주장:{" "}
                {h.claims
                  .map((c) => `${c.character} ${c.stance === "SUPPORT" ? "지지" : "반대"}`)
                  .join(", ")}
              </p>
            )}
          </li>
        ))}
        {hits && hits.length === 0 && (
          <li className="text-xs text-ink-3">결과 없음</li>
        )}
      </ul>
      <DocumentUpload tabId={tabId} />
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
    <div className="flex h-full flex-col overflow-y-auto bg-surface" data-testid="evidence-panel">
      <header className="sticky top-0 z-10 border-b border-line-soft bg-[var(--surface-elevated)] p-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="section-label">Step 3 · Evidence</p>
            <h2 className="mt-0.5 text-sm font-bold">근거 검토</h2>
            <p className="text-[11px] text-ink-3">후보·지지·반증·인용 상태를 함께 판단합니다.</p>
          </div>
          <span className={`badge ${cell ? "badge-ok" : "badge-neutral"}`}>
            {cell ? "문자 선택됨" : "선택 대기"}
          </span>
        </div>
      </header>
      <div className="space-y-2 p-2.5">
      {!cell && (
        <section className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-jade-soft text-jade">
            <Icon name="search" />
          </span>
          <h3 className="mt-3 text-sm font-bold">검토할 문자를 선택하세요</h3>
          <p className="mt-1 text-xs leading-5 text-ink-2">
            왼쪽 대상 목록이나 중앙 3D 표면에서 문자 영역을 선택하면 분석 도구가 활성화됩니다.
          </p>
          <ol className="mt-3 space-y-2 text-[11px] text-ink-3">
            <li className="flex gap-2"><span className="font-bold text-clay">1</span> 관측도와 손상 등급 확인</li>
            <li className="flex gap-2"><span className="font-bold text-clay">2</span> 독립 후보 분석 실행</li>
            <li className="flex gap-2"><span className="font-bold text-clay">3</span> 지지·반증 문헌과 인용 검증</li>
          </ol>
        </section>
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
                <p className="mt-0.5 text-ink-2">
                  기존 판독(공개): {cell.publishedReading}
                </p>
              )}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => analyzeMutation.mutate(cell.id)}
              disabled={analyzeMutation.isPending}
              className="ui-button ui-button-primary col-span-2 min-h-9"
              data-testid="analyze-button"
            >
              <Icon name="spark" />
              {analyzeMutation.isPending ? "독립 분석 실행 중" : "독립 후보 분석"}
            </button>
            <button
              onClick={() => setDossierOpen(true)}
              className="ui-button ui-button-secondary min-h-9 px-2"
              data-testid="open-dossier"
            >
              <Icon name="document" /> 근거철
            </button>
            <button
              onClick={() => tray.add(cell.id)}
              className="ui-button ui-button-secondary min-h-9 px-2"
              data-testid="add-to-compare"
            >
              <Icon name="layers" /> 비교 추가
            </button>
          </div>

          {shownResult && (
            <>
              <section className="panel p-2" data-testid="analysis-result">
                <h3 className="text-xs font-semibold text-ink-2">
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
                  <p className="mt-1 text-[11px] text-[var(--state-warning)]" data-testid="failed-rules">
                    게이트 실패: {shownResult.decision.failedRules.join(", ")}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-ink-3">
                  독립 계보 {shownResult.independentLineageCount}개 · 실행 {shownResult.runId}
                </p>
              </section>

              <section className="panel p-2" data-testid="candidates">
                <h3 className="text-xs font-semibold text-ink-2">후보 (독립 생성)</h3>
                <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-72 text-[11px]">
                  <thead>
                    <tr className="text-left text-ink-3">
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
                        <td className="text-ink-3">{c.origin}</td>
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
                </div>
              </section>

              <section className="panel p-2" data-testid="evidence-list">
                <h3 className="text-xs font-semibold text-ink-2">근거 · 반증</h3>
                <ul className="mt-1 max-h-64 space-y-1.5 overflow-y-auto">
                  {shownResult.evidence.map((e) => (
                    <li key={e.id} className="rounded bg-surface-2 p-2 text-[11px]">
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
                      <p className="mt-1 text-ink-2">{e.note}</p>
                      <blockquote className="mt-0.5 border-l-2 border-[var(--accent)] pl-1.5 text-ink-2">
                        {e.quote}
                      </blockquote>
                    </li>
                  ))}
                  {shownResult.evidence.length === 0 && (
                    <li className="text-ink-3">문헌 근거 없음</li>
                  )}
                </ul>
              </section>
            </>
          )}
        </>
      )}
      <LiteratureSearch
        key={detail.tab.id}
        tabId={detail.tab.id}
        initialQuery={detail.tab.uiState.literatureQuery}
      />
      {dossierOpen && cell && (
        <DossierModal glyphCellId={cell.id} onClose={() => setDossierOpen(false)} />
      )}
      </div>
    </div>
  );
}
