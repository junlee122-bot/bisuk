"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GlyphCell } from "@seokmun/types";
import { ApiRequestError, labApi, researchApi } from "@/lib/api";
import { useCan } from "@/lib/session";

const MANUAL_STATUSES = [
  ["OBSERVED", "관측(원문 확인)"],
  ["PARTIALLY_OBSERVED", "부분 관측"],
  ["ILLEGIBLE", "판독 불가"],
  ["UNKNOWN", "미상"],
  ["TEXTUAL_SUPPLEMENT", "문헌 보충"],
] as const;

/** 셀 속성 편집 · 변경 이력/되돌리기 · 표본 등록 · 삭제 */
export function CellEditor({ cell, tabId, onDeleted }: { cell: GlyphCell; tabId: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const isPI = useCan("PI");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"edit" | "history" | "claims">("edit");
  const [f, setF] = useState({
    faceId: cell.faceId,
    lineIndex: cell.lineIndex,
    sequenceIndex: cell.sequenceIndex,
    readingStatus: cell.readingStatus,
    publishedReading: cell.publishedReading ?? "",
    observabilityScore: cell.observabilityScore,
    damageGrade: cell.damageGrade,
    note: cell.note ?? "",
    reason: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["tab", tabId] });
    void qc.invalidateQueries({ queryKey: ["cell-history", cell.id] });
  };
  const save = useMutation({
    mutationFn: () =>
      labApi.patchCell(cell.id, {
        faceId: f.faceId,
        lineIndex: Number(f.lineIndex),
        sequenceIndex: Number(f.sequenceIndex),
        ...(MANUAL_STATUSES.some(([s]) => s === f.readingStatus) ? { readingStatus: f.readingStatus } : {}),
        publishedReading: f.publishedReading.trim() || null,
        observabilityScore: Number(f.observabilityScore),
        damageGrade: Number(f.damageGrade),
        note: f.note,
        reason: f.reason,
        expectedVersion: cell.version,
      }),
    onSuccess: () => {
      setMsg("저장했습니다");
      refresh();
    },
    onError: (e) =>
      setMsg(e instanceof ApiRequestError && e.status === 409 ? "다른 사람이 먼저 수정했습니다 — 셀을 다시 선택해 최신 값을 불러오세요" : (e as Error).message),
  });
  const history = useQuery({ queryKey: ["cell-history", cell.id], queryFn: () => labApi.cellHistory(cell.id), enabled: open && tab === "history" });
  const claims = useQuery({ queryKey: ["cell-claims", cell.id], queryFn: () => researchApi.cellClaims(cell.id), enabled: open && tab === "claims" });
  const revert = useMutation({
    mutationFn: (versionId: string) => labApi.revertCell(cell.id, versionId, window.prompt("되돌리는 이유") ?? ""),
    onSuccess: refresh,
  });
  const exemplar = useMutation({
    mutationFn: (ch: string) => researchApi.exemplarFromCell(cell.id, ch),
    onSuccess: (e) => setMsg(`'${e.character}' 자형 표본으로 등록했습니다 — 이후 분석의 시각 비교에 쓰입니다`),
    onError: (e) => setMsg((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => labApi.deleteCell(cell.id),
    onSuccess: () => {
      refresh();
      onDeleted();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const input = "rounded border border-[var(--panel-border)] bg-transparent px-1.5 py-1";

  if (!open) {
    return (
      <button className="badge badge-neutral" onClick={() => setOpen(true)} data-testid="open-cell-editor">
        셀 편집·이력
      </button>
    );
  }
  return (
    <section className="panel w-full p-2 text-[11px]" data-testid="cell-editor">
      <div className="flex items-center gap-1">
        {(["edit", "history", "claims"] as const).map((t) => (
          <button key={t} className={`badge ${tab === t ? "badge-demo" : "badge-neutral"}`} onClick={() => setTab(t)}>
            {t === "edit" ? "속성" : t === "history" ? "변경 이력" : "문헌 주장"}
          </button>
        ))}
        <button className="badge badge-neutral ml-auto" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      {tab === "edit" && (
        <form
          className="mt-2 space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            <label>
              면 <input value={f.faceId} onChange={(e) => setF({ ...f, faceId: e.target.value })} className={`${input} w-20`} disabled={!canEdit} />
            </label>
            <label>
              행 <input type="number" min={1} value={f.lineIndex} onChange={(e) => setF({ ...f, lineIndex: Number(e.target.value) })} className={`${input} w-14`} disabled={!canEdit} />
            </label>
            <label>
              자 <input type="number" min={1} value={f.sequenceIndex} onChange={(e) => setF({ ...f, sequenceIndex: Number(e.target.value) })} className={`${input} w-14`} disabled={!canEdit} />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <select value={f.readingStatus} onChange={(e) => setF({ ...f, readingStatus: e.target.value as GlyphCell["readingStatus"] })} className={input} disabled={!canEdit} aria-label="판독 상태">
              {!MANUAL_STATUSES.some(([s]) => s === f.readingStatus) && <option value={f.readingStatus}>{f.readingStatus} (자동 분석 결과)</option>}
              {MANUAL_STATUSES.map(([s, l]) => (
                <option key={s} value={s}>
                  {l}
                </option>
              ))}
            </select>
            <input value={f.publishedReading} onChange={(e) => setF({ ...f, publishedReading: e.target.value })} placeholder="원문 글자" className={`${input} w-16`} disabled={!canEdit} aria-label="원문 글자" />
            <label>
              관측도 <input type="number" step={0.05} min={0} max={1} value={f.observabilityScore} onChange={(e) => setF({ ...f, observabilityScore: Number(e.target.value) })} className={`${input} w-16`} disabled={!canEdit} />
            </label>
            <label>
              손상 <input type="number" min={0} max={5} value={f.damageGrade} onChange={(e) => setF({ ...f, damageGrade: Number(e.target.value) })} className={`${input} w-12`} disabled={!canEdit} />
            </label>
          </div>
          <textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} placeholder="메모 (관찰 기록)" className={`${input} w-full`} disabled={!canEdit} />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1">
              <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="변경 사유 (이력에 남음)" className={`${input} min-w-0 flex-1`} />
              <button type="submit" className="badge badge-demo" disabled={save.isPending} data-testid="cell-save">
                저장
              </button>
            </div>
          )}
          <p className="text-ink-3">
            자동 분석 상태(다중 근거 자동·상충 등)는 사람이 직접 지정할 수 없습니다. 확정은 판독 제안 → PI 채택으로 합니다.
          </p>
        </form>
      )}
      {tab === "history" && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {history.data?.map((v) => (
            <li key={v.id} className="rounded bg-surface-2 p-1.5">
              v{v.version} · {v.action} · {v.actorName} · {v.ts.slice(0, 16).replace("T", " ")}
              {v.reason && <span className="text-ink-3"> — {v.reason}</span>}
              {isPI && (
                <button className="badge badge-neutral ml-1" onClick={() => revert.mutate(v.id)}>
                  이 버전으로 되돌리기
                </button>
              )}
            </li>
          ))}
          {history.data?.length === 0 && <li className="text-ink-3">이력 없음</li>}
        </ul>
      )}
      {tab === "claims" && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {claims.data?.map((c) => (
            <li key={c.id} className="rounded bg-surface-2 p-1.5">
              <span className={`badge ${c.stance === "SUPPORT" ? "badge-ok" : "badge-rights"}`}>{c.stance === "SUPPORT" ? "지지" : "반대"}</span>{" "}
              {c.character} · <span className="badge badge-neutral">{c.status}</span> · {c.origin}
              <blockquote className="mt-0.5 border-l-2 border-[var(--accent)] pl-1.5 text-ink-2">{c.quote}</blockquote>
            </li>
          ))}
          {claims.data?.length === 0 && <li className="text-ink-3">이 셀을 가리키는 문헌 주장 없음 — 자료실에서 문헌 주장을 제안·확인하세요</li>}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1 border-t border-[var(--panel-border)] pt-2">
        {canEdit && cell.strokes && (
          <button
            className="badge badge-neutral"
            onClick={() => {
              const ch = window.prompt("이 셀의 획을 어떤 글자의 자형 표본으로 등록할까요?", cell.publishedReading ?? "");
              if (ch) exemplar.mutate(ch.trim());
            }}
          >
            자형 표본으로 등록
          </button>
        )}
        {isPI && (
          <button className="badge badge-rights" onClick={() => window.confirm("셀과 판독·분석 기록을 삭제합니다. 계속할까요?") && remove.mutate()}>
            셀 삭제
          </button>
        )}
      </div>
      {msg && <p className="mt-1 text-ink-2" role="status">{msg}</p>}
    </section>
  );
}
