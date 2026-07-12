"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DemoBadge, ReadingBadge, RightsBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";

export function DossierModal({
  glyphCellId,
  onClose,
}: {
  glyphCellId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["dossier", glyphCellId],
    queryFn: () => api.getDossier(glyphCellId),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Evidence Dossier"
      onClick={onClose}
    >
      <div
        className="panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="dossier-modal"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">Evidence Dossier — {glyphCellId}</h2>
          <button autoFocus onClick={onClose} className="badge badge-neutral" data-testid="dossier-close">
            닫기 ✕
          </button>
        </div>
        {isLoading && <p className="mt-4 text-sm text-neutral-400">불러오는 중…</p>}
        {data && (
          <div className="mt-3 space-y-3 text-sm">
            <section className="panel p-3">
              <div className="flex flex-wrap items-center gap-3">
                <GlyphPatchSvg cell={data.glyphCell} size={72} />
                <div>
                  <h3 className="font-semibold">결론</h3>
                  {data.conclusion ? (
                    <p className="mt-1 flex flex-wrap items-center gap-2" data-testid="dossier-conclusion">
                      <span className="text-2xl">{data.conclusion.candidateCharacter}</span>
                      <ReadingBadge status={data.glyphCell.readingStatus} />
                      <span className="badge badge-neutral">
                        보정 신뢰도 {data.conclusion.calibratedConfidence}
                      </span>
                      <span className="badge badge-neutral">
                        2위와 격차 {data.conclusion.marginToSecond}
                      </span>
                    </p>
                  ) : (
                    <p className="text-neutral-400">아직 분석이 실행되지 않았습니다.</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-500">
                    {data.tab.title} · {data.glyphCell.faceId} · {data.glyphCell.lineIndex}행{" "}
                    {data.glyphCell.sequenceIndex}자 · 관측도{" "}
                    {data.glyphCell.observabilityScore}
                  </p>
                </div>
                <span className="ml-auto">
                  <DemoBadge label="가상 데모 분석 — 실제 판독 아님" />
                </span>
              </div>
            </section>

            {data.decision && (
              <section className="panel p-3" data-testid="dossier-decision">
                <h3 className="font-semibold">
                  결정 규칙 (Decision Gate){" "}
                  <span
                    className={`badge ${data.decision.passed ? "badge-ok" : "badge-warn"}`}
                  >
                    {data.decision.outcome}
                  </span>
                </h3>
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="pr-2">규칙</th>
                      <th className="pr-2">기준</th>
                      <th className="pr-2">실제</th>
                      <th>통과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.decision.ruleTrace.map((r) => (
                      <tr key={r.rule} className="border-t border-[var(--panel-border)]">
                        <td className="py-1 pr-2 font-mono">{r.rule}</td>
                        <td className="pr-2">{r.expected}</td>
                        <td className="pr-2 tabular-nums">{r.actual}</td>
                        <td>{r.passed ? "✓" : <span className="text-red-400">✗</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {data.alternates.length > 0 && (
              <section className="panel p-3">
                <h3 className="font-semibold">대안 후보</h3>
                <ul className="mt-1 flex flex-wrap gap-2 text-xs">
                  {data.alternates.map((a) => (
                    <li key={a.id} className="badge badge-neutral">
                      {a.candidateCharacter} · {a.calibratedConfidence}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="panel p-3" data-testid="dossier-evidence">
              <h3 className="font-semibold">근거 (지지 / 반대)</h3>
              <ul className="mt-2 space-y-2">
                {data.evidence.map((e) => (
                  <li key={e.id} className="rounded bg-[#26262e] p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`badge ${e.kind === "SUPPORT" ? "badge-ok" : "badge-rights"}`}
                      >
                        {e.kind === "SUPPORT" ? "지지" : "반대"}
                      </span>
                      <span className="badge badge-neutral">계보 {e.independenceGroup}</span>
                      <span className="badge badge-neutral">tier {e.reliabilityTier}</span>
                      <span
                        className={`badge ${e.citationVerified ? "badge-ok" : "badge-warn"}`}
                      >
                        {e.citationVerified ? "인용 위치 확인" : "인용 미확인"}
                      </span>
                    </div>
                    <p className="mt-1 text-neutral-300">{e.note}</p>
                    <blockquote className="mt-1 border-l-2 border-[var(--accent)] pl-2 text-neutral-400">
                      {e.citationContext || e.quote}
                    </blockquote>
                  </li>
                ))}
                {data.evidence.length === 0 && (
                  <li className="text-xs text-neutral-500">수집된 문헌 근거 없음</li>
                )}
              </ul>
            </section>

            <section className="panel p-3" data-testid="dossier-genealogy">
              <h3 className="font-semibold">출처 계보 (재인용 병합)</h3>
              <ul className="mt-1 space-y-1 text-xs">
                {data.sourceGenealogy.map((g) => (
                  <li key={g.independenceGroup} className="rounded bg-[#26262e] p-2">
                    <span className="badge badge-neutral">{g.independenceGroup}</span>{" "}
                    <span className="text-neutral-400">
                      문서 {g.documentIds.length}건 → 독립 근거 1개로 계산
                    </span>
                    <p className="mt-1 text-neutral-500">{g.titles.join(" · ")}</p>
                  </li>
                ))}
                {data.sourceGenealogy.length === 0 && (
                  <li className="text-neutral-500">계보 정보 없음</li>
                )}
              </ul>
            </section>

            {data.crossSteleMatches.length > 0 && (
              <section className="panel p-3">
                <h3 className="font-semibold">다른 비석 근거 (교차 매칭)</h3>
                <ul className="mt-1 space-y-1 text-xs">
                  {data.crossSteleMatches.slice(0, 6).map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-neutral">{m.targetGlyphCellId}</span>
                      <span>종합 {m.combinedScore}</span>
                      <span className="text-neutral-500">
                        시각 {m.visualScore} · 서체 {m.scriptScore} · 시대 {m.periodScore}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <footer className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>모델 {data.modelVersion}</span>
              <span>코퍼스 {data.corpusVersion}</span>
              <RightsBadge state={data.rightsState} />
              <span>생성 {data.generatedAt}</span>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
