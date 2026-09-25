"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { researchApi, type RerunComparison } from "@/lib/api";

const COMPONENT_LABEL: Record<string, string> = {
  engine: "엔진 버전",
  cell: "대상 셀(획)",
  sameTabCells: "같은 비석 셀",
  otherTabCells: "다른 비석 셀",
  tabs: "비석 메타데이터",
  documents: "문헌 본문",
  claims: "문헌 주장",
  priors: "기본 자형표",
  exemplars: "등록 표본",
  variants: "이체자",
  context: "문맥 코퍼스",
  chronology: "연대 증거",
  calibration: "보정 프로파일",
  mode: "데모 모드",
};

/** 분석 실행 이력 — 입력 해시와 재실행 비교 (재현성) */
export function RunHistory({ cellId }: { cellId: string }) {
  const [open, setOpen] = useState(false);
  const { data: runs } = useQuery({ queryKey: ["runs", cellId], queryFn: () => researchApi.runs(cellId), enabled: open });
  const [cmp, setCmp] = useState<RerunComparison | null>(null);
  const rerun = useMutation({ mutationFn: (id: string) => researchApi.rerun(id), onSuccess: setCmp });
  if (!open) {
    return (
      <button className="badge badge-neutral" onClick={() => setOpen(true)} data-testid="open-runs">
        실행 이력·재현
      </button>
    );
  }
  return (
    <section className="panel w-full p-2 text-[11px]" data-testid="run-history">
      <div className="flex items-center">
        <h3 className="font-semibold text-ink-2">분석 실행 이력</h3>
        <button className="badge badge-neutral ml-auto" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
        {runs?.map((r) => (
          <li key={r.id} className="rounded bg-surface-2 p-1.5">
            {r.createdAt.slice(0, 16).replace("T", " ")} · {r.outcome} · {r.topCandidate ?? "-"} · {r.createdBy}
            <span className="block truncate font-mono text-[10px] text-ink-3" title={r.inputHash}>
              입력 {r.inputHash.slice(0, 16)}…
            </span>
            <button className="badge badge-neutral mt-0.5" onClick={() => rerun.mutate(r.id)} data-testid="rerun">
              지금 데이터로 재실행 비교
            </button>
          </li>
        ))}
        {runs?.length === 0 && <li className="text-ink-3">실행 기록 없음</li>}
      </ul>
      {cmp && (
        <div className="mt-2 rounded border border-[var(--panel-border)] p-1.5" data-testid="rerun-result">
          <p>
            {cmp.reproduced ? (
              <span className="badge badge-ok">재현됨 — 입력·결과 동일</span>
            ) : (
              <span className="badge badge-warn">{cmp.sameInput ? "입력 동일, 결과 다름" : "입력이 바뀜"}</span>
            )}{" "}
            결과: {cmp.run.outcome}/{cmp.run.topCandidate ?? "-"} → {cmp.current.summary.outcome}/{cmp.current.summary.topCandidate ?? "-"}
          </p>
          {cmp.changedComponents.length > 0 && (
            <p className="mt-0.5 text-ink-2">바뀐 입력: {cmp.changedComponents.map((c) => COMPONENT_LABEL[c] ?? c).join(", ")}</p>
          )}
        </div>
      )}
    </section>
  );
}
