"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { researchApi } from "@/lib/api";
import { useCan } from "@/lib/session";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (w: { point: number; lower: number; upper: number }) => `${pct(w.point)} (95% 구간 ${pct(w.lower)}–${pct(w.upper)})`;

export default function EvaluationPage() {
  const qc = useQueryClient();
  const isPI = useCan("PI");
  const canRun = useCan("RESEARCHER");
  const run = useMutation({ mutationFn: () => researchApi.evaluate() });
  const { data: profiles } = useQuery({ queryKey: ["calibration"], queryFn: researchApi.calibrationProfiles });
  const [method, setMethod] = useState<"ISOTONIC" | "PLATT">("ISOTONIC");
  const [msg, setMsg] = useState<string | null>(null);
  const fit = useMutation({
    mutationFn: (activate: boolean) => researchApi.fitCalibration(method, activate),
    onSuccess: (r) => {
      setMsg(`보정 프로파일 ${r.profile.id} (n=${r.profile.n}, ECE ${r.profile.ece})${r.active ? " — 활성화됨" : ""}`);
      void qc.invalidateQueries({ queryKey: ["calibration"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const activate = useMutation({ mutationFn: (id: string) => researchApi.activateCalibration(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["calibration"] }) });
  const deactivate = useMutation({ mutationFn: researchApi.deactivateCalibration, onSuccess: () => void qc.invalidateQueries({ queryKey: ["calibration"] }) });
  const s = run.data?.summary;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8" data-testid="evaluation-page">
      <h1 className="text-xl font-bold">평가·보정</h1>
      <p className="text-sm text-ink-2">
        정답이 있는 사례(벤치마크 숨김 정답 + 연구실이 채택한 판독, 자동 분석 유래 제외)에서 자동 분석을 다시 돌려 성능을 봅니다. 사례가 적으면 비율의 신뢰구간이
        넓으니 점추정만 보고 판단하지 마십시오. 보정 프로파일은 평가 사례가 30건 이상일 때만 만들 수 있습니다.
      </p>
      {canRun && (
        <button className="badge badge-demo" onClick={() => run.mutate()} disabled={run.isPending} data-testid="run-evaluation">
          {run.isPending ? "평가 중…" : "평가 실행"}
        </button>
      )}
      {s && (
        <section className="panel space-y-1 p-3 text-sm" data-testid="evaluation-summary">
          <p>
            사례 {s.n}건 ({Object.entries(s.bySource).map(([k, v]) => `${k === "BENCHMARK" ? "벤치마크" : "채택 판독"} ${v}`).join(", ")})
          </p>
          <p>1위 정답률: {ci(s.top1Accuracy)}</p>
          <p>
            자동 확정 {s.autoAccepted}건 · 자동 확정 중 오답률: {s.autoAccepted ? ci(s.falseAutoAcceptRate) : "추정 불가"}
          </p>
          <p>자동 확정 비율: {ci(s.coverage)}</p>
          <p>기대 보정 오차(ECE): {s.ece}</p>
          {s.warnings.map((w) => (
            <p key={w} className="text-[var(--state-warning)]">
              ⚠ {w}
            </p>
          ))}
        </section>
      )}
      {run.data && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="p-1">셀</th>
              <th className="p-1">정답 출처</th>
              <th className="p-1">정답</th>
              <th className="p-1">1위</th>
              <th className="p-1">결정</th>
              <th className="p-1">신뢰도</th>
              <th className="p-1">실패 규칙</th>
            </tr>
          </thead>
          <tbody>
            {run.data.cases.map((c) => (
              <tr key={c.caseId} className="border-t border-[var(--panel-border)]">
                <td className="p-1">{c.caseId}</td>
                <td className="p-1">{c.truthSource}</td>
                <td className="p-1 text-base">{c.truth}</td>
                <td className={`p-1 text-base ${c.topCandidate === c.truth ? "" : "text-[var(--state-danger)]"}`}>{c.topCandidate ?? "-"}</td>
                <td className="p-1">{c.outcome}</td>
                <td className="p-1">{c.confidence}</td>
                <td className="p-1 text-ink-3">{c.failedRules.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <section className="panel p-3 text-sm">
        <h2 className="font-semibold">보정 프로파일</h2>
        <ul className="mt-1 space-y-1 text-xs">
          {profiles?.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded bg-surface-2 p-1.5">
              {p.active && <span className="badge badge-ok">활성</span>}
              {p.method} · n={p.n} · ECE {p.ece} · {p.fittedBy} · {p.fittedAt.slice(0, 10)}
              <span className="text-ink-3">{p.note}</span>
              {isPI && !p.active && (
                <button className="badge badge-neutral ml-auto" onClick={() => activate.mutate(p.id)}>
                  활성화
                </button>
              )}
            </li>
          ))}
          {profiles?.length === 0 && <li className="text-ink-3">보정 프로파일 없음 — 데모 셀은 데모 휴리스틱, 실제 셀은 자동 확정하지 않음</li>}
        </ul>
        {isPI && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1 py-1">
              <option value="ISOTONIC">등위 회귀 (isotonic)</option>
              <option value="PLATT">Platt (로지스틱)</option>
            </select>
            <button className="badge badge-neutral" onClick={() => fit.mutate(false)}>
              적합만
            </button>
            <button className="badge badge-demo" onClick={() => fit.mutate(true)}>
              적합 후 활성화
            </button>
            <button className="badge badge-neutral" onClick={() => deactivate.mutate()}>
              보정 끄기
            </button>
          </div>
        )}
        {msg && <p className="mt-1 text-xs text-ink-2">{msg}</p>}
      </section>
    </main>
  );
}
