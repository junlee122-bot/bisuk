"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatReadingToken } from "@seokmun/engine";
import type { Reading } from "@seokmun/types";
import { ApiRequestError, labApi, researchApi, type ReadingWithCount } from "@/lib/api";
import { useCan, useSession } from "@/lib/session";
import { CommentThread } from "./CommentThread";

const SOURCE_LABEL: Record<Reading["sourceType"], string> = {
  PUBLISHED_EDITION: "출판 판독문",
  RESEARCHER: "연구원",
  AUTO_ANALYSIS: "자동 분석",
};
const STATUS_LABEL: Record<Reading["reviewStatus"], string> = {
  DRAFT: "초안",
  PROPOSED: "검토 대기",
  ACCEPTED: "채택",
  REJECTED: "기각",
  SUPERSEDED: "대체됨",
};
const CERTAINTY_LABEL: Record<Reading["certainty"], string> = {
  CERTAIN: "확실",
  PROBABLE: "개연",
  POSSIBLE: "가능",
  UNCERTAIN: "불확실",
};

function ProposeForm({ cellId, onDone }: { cellId: string; onDone: () => void }) {
  const [f, setF] = useState({
    readingKind: "CHARACTER" as Reading["readingKind"],
    reading: "",
    variantForm: "",
    certainty: "PROBABLE" as Reading["certainty"],
    supplied: false,
    unclear: false,
    sourceType: "RESEARCHER" as "RESEARCHER" | "PUBLISHED_EDITION",
    sourceLabel: "",
    bibliographyId: "",
    citationLocator: "",
    rationale: "",
    draft: false,
  });
  const [error, setError] = useState<string | null>(null);
  const { data: bib } = useQuery({ queryKey: ["bibliography", ""], queryFn: () => researchApi.bibliography() });
  const m = useMutation({
    mutationFn: () =>
      labApi.proposeReading(cellId, {
        readingKind: f.readingKind,
        reading: f.readingKind === "CHARACTER" ? f.reading.trim() : null,
        variantForm: f.variantForm.trim() || null,
        certainty: f.certainty,
        supplied: f.supplied,
        unclear: f.unclear,
        sourceType: f.sourceType,
        sourceLabel: f.sourceLabel,
        bibliographyId: f.bibliographyId || null,
        citationLocator: f.citationLocator,
        rationale: f.rationale,
        draft: f.draft,
      }),
    onSuccess: () => {
      setError(null);
      onDone();
    },
    onError: (e) => setError((e as Error).message),
  });
  const input = "rounded border border-[var(--panel-border)] bg-transparent px-1.5 py-1";
  return (
    <form
      className="space-y-1.5 rounded bg-surface-2 p-2 text-[11px]"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      data-testid="reading-form"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={f.readingKind} onChange={(e) => setF({ ...f, readingKind: e.target.value as Reading["readingKind"] })} className={input} aria-label="판독 종류">
          <option value="CHARACTER">글자</option>
          <option value="ILLEGIBLE">판독 불가</option>
          <option value="LACUNA">결락</option>
        </select>
        {f.readingKind === "CHARACTER" && (
          <>
            <input value={f.reading} onChange={(e) => setF({ ...f, reading: e.target.value })} placeholder="글자" className={`${input} w-12 text-center text-base`} aria-label="판독 글자" data-testid="reading-char" />
            <input value={f.variantForm} onChange={(e) => setF({ ...f, variantForm: e.target.value })} placeholder="이체" className={`${input} w-12 text-center`} aria-label="이체자 자형" />
          </>
        )}
        <select value={f.certainty} onChange={(e) => setF({ ...f, certainty: e.target.value as Reading["certainty"] })} className={input} aria-label="확실도">
          {Object.entries(CERTAINTY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-0.5">
          <input type="checkbox" checked={f.supplied} onChange={(e) => setF({ ...f, supplied: e.target.checked })} /> 복원[ ]
        </label>
        <label className="flex items-center gap-0.5">
          <input type="checkbox" checked={f.unclear} onChange={(e) => setF({ ...f, unclear: e.target.checked })} /> 불확실?
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={f.sourceType} onChange={(e) => setF({ ...f, sourceType: e.target.value as typeof f.sourceType })} className={input} aria-label="출전 유형">
          <option value="RESEARCHER">내 판독</option>
          <option value="PUBLISHED_EDITION">출판 판독문 옮김</option>
        </select>
        <input value={f.sourceLabel} onChange={(e) => setF({ ...f, sourceLabel: e.target.value })} placeholder={f.sourceType === "PUBLISHED_EDITION" ? "출전 (예: 허흥식 1984)" : "라벨 (선택)"} className={`${input} min-w-0 flex-1`} aria-label="출전 라벨" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={f.bibliographyId} onChange={(e) => setF({ ...f, bibliographyId: e.target.value })} className={`${input} min-w-0 flex-1`} aria-label="서지">
          <option value="">서지 연결 없음</option>
          {bib?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.formatted.slice(0, 60)}
            </option>
          ))}
        </select>
        <input value={f.citationLocator} onChange={(e) => setF({ ...f, citationLocator: e.target.value })} placeholder="쪽·도판" className={`${input} w-20`} aria-label="인용 위치" />
      </div>
      <textarea value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} placeholder="판독 근거 (획 관찰, 문맥, 비교 자료…)" rows={2} className={`${input} w-full`} aria-label="판독 근거" data-testid="reading-rationale" />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-0.5">
          <input type="checkbox" checked={f.draft} onChange={(e) => setF({ ...f, draft: e.target.checked })} /> 초안으로 저장
        </label>
        <button type="submit" className="badge badge-demo ml-auto" disabled={m.isPending} data-testid="reading-submit">
          {f.draft ? "초안 저장" : "판독 제안"}
        </button>
      </div>
      {error && <p className="text-[var(--state-danger)]" role="alert">{error}</p>}
    </form>
  );
}

function ReadingRow({ r, adopted, onChanged }: { r: ReadingWithCount; adopted: boolean; onChanged: () => void }) {
  const { user } = useSession();
  const isPI = user?.role === "PI";
  const mine = r.authorId === user?.id;
  const [showComments, setShowComments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async (kind: "accept" | "reject" | "submit" | "delete") => {
      if (kind === "accept" || kind === "reject") {
        const note = kind === "reject" ? window.prompt("기각 사유 (선택)") ?? "" : "";
        return labApi.reviewReading(r.id, { decision: kind === "accept" ? "ACCEPT" : "REJECT", note, expectedVersion: r.version });
      }
      if (kind === "submit") return labApi.submitReading(r.id);
      return labApi.deleteReading(r.id);
    },
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (e) => setError(e instanceof ApiRequestError && e.status === 409 ? `${e.message} — 새로고침 후 다시 시도하세요` : (e as Error).message),
  });
  return (
    <li className={`rounded p-1.5 ${adopted ? "bg-[color-mix(in_srgb,var(--state-success)_12%,transparent)]" : "bg-surface-2"}`} data-testid="reading-row" data-reading-id={r.id}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-base" data-testid="reading-token">{formatReadingToken(r)}</span>
        {adopted && <span className="badge badge-ok" data-testid="reading-adopted">연구실 채택</span>}
        <span className="badge badge-neutral">{SOURCE_LABEL[r.sourceType]}</span>
        <span className={`badge ${r.reviewStatus === "PROPOSED" ? "badge-warn" : r.reviewStatus === "REJECTED" ? "badge-rights" : "badge-neutral"}`}>{STATUS_LABEL[r.reviewStatus]}</span>
        <span className="text-ink-3">{CERTAINTY_LABEL[r.certainty]}</span>
      </div>
      <p className="mt-0.5 text-ink-2">
        {r.sourceLabel || r.authorName}
        {r.citationLocator && ` · ${r.citationLocator}`}
        {r.reviewerName && ` · 검토 ${r.reviewerName}`}
      </p>
      {r.rationale && <p className="mt-0.5 whitespace-pre-wrap text-ink-3">{r.rationale}</p>}
      {r.reviewNote && <p className="mt-0.5 text-ink-3">검토 의견: {r.reviewNote}</p>}
      <div className="mt-1 flex flex-wrap gap-1">
        {isPI && (r.reviewStatus === "PROPOSED" || r.reviewStatus === "REJECTED" || (r.reviewStatus === "ACCEPTED" && !adopted)) && (
          <button className="badge badge-ok" onClick={() => act.mutate("accept")} data-testid="reading-accept">
            채택
          </button>
        )}
        {isPI && (r.reviewStatus === "PROPOSED" || adopted) && (
          <button className="badge badge-rights" onClick={() => act.mutate("reject")} data-testid="reading-reject">
            기각
          </button>
        )}
        {mine && r.reviewStatus === "DRAFT" && (
          <button className="badge badge-neutral" onClick={() => act.mutate("submit")}>
            검토 요청
          </button>
        )}
        {(mine || isPI) && !adopted && (r.reviewStatus === "DRAFT" || r.reviewStatus === "PROPOSED") && (
          <button className="badge badge-neutral" onClick={() => window.confirm("이 판독을 삭제할까요?") && act.mutate("delete")}>
            삭제
          </button>
        )}
        <button className="badge badge-neutral" onClick={() => setShowComments((s) => !s)}>
          토론 {r.commentCount}
        </button>
      </div>
      {error && <p className="mt-1 text-[var(--state-danger)]" role="alert">{error}</p>}
      {showComments && (
        <div className="mt-1">
          <CommentThread targetType="READING" targetId={r.id} />
        </div>
      )}
    </li>
  );
}

/** 셀의 판독자별 판독·제안·PI 검토·토론 */
export function ReadingsPanel({ cellId, setId, tabId }: { cellId: string; setId: string; tabId: string }) {
  const qc = useQueryClient();
  const canPropose = useCan("RESEARCHER");
  const [proposing, setProposing] = useState(false);
  const [showCellComments, setShowCellComments] = useState(false);
  const { data } = useQuery({ queryKey: ["readings", cellId], queryFn: () => labApi.readings(cellId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["readings", cellId] });
    void qc.invalidateQueries({ queryKey: ["tab", tabId] });
    void qc.invalidateQueries({ queryKey: ["review-queue"] });
  };
  const fromAnalysis = useMutation({
    mutationFn: () => labApi.readingFromAnalysis(cellId),
    onSuccess: refresh,
  });
  const readings = [...(data?.readings ?? [])].sort(
    (a, b) => Number(b.id === data?.adoptedReadingId) - Number(a.id === data?.adoptedReadingId) || (a.createdAt < b.createdAt ? 1 : -1)
  );
  return (
    <section className="panel p-2" data-testid="readings-panel">
      <div className="flex items-center gap-1">
        <h3 className="text-xs font-semibold text-ink-2">판독 (판독자별)</h3>
        <Link href={`/sets/${setId}/readings?tab=${tabId}`} className="ml-auto text-[11px] text-ink-3 underline">
          비교표
        </Link>
      </div>
      <ul className="mt-1 space-y-1.5 text-[11px]">
        {readings.map((r) => (
          <ReadingRow key={r.id} r={r} adopted={r.id === data?.adoptedReadingId} onChanged={refresh} />
        ))}
        {data && readings.length === 0 && <li className="text-ink-3">등록된 판독 없음</li>}
      </ul>
      {canPropose && (
        <div className="mt-2 flex flex-wrap gap-1">
          <button className="badge badge-demo" onClick={() => setProposing((p) => !p)} data-testid="propose-reading">
            {proposing ? "닫기" : "+ 판독 제안"}
          </button>
          <button
            className="badge badge-neutral"
            onClick={() => fromAnalysis.mutate()}
            disabled={fromAnalysis.isPending}
            title="최근 자동 분석의 1위 후보를 사람 검토 대기 판독안으로 기록"
          >
            자동 분석 → 판독안
          </button>
          <button className="badge badge-neutral" onClick={() => setShowCellComments((s) => !s)}>
            셀 토론
          </button>
        </div>
      )}
      {fromAnalysis.error && <p className="mt-1 text-[11px] text-[var(--state-danger)]">{(fromAnalysis.error as Error).message}</p>}
      {proposing && (
        <div className="mt-2">
          <ProposeForm
            cellId={cellId}
            onDone={() => {
              setProposing(false);
              refresh();
            }}
          />
        </div>
      )}
      {showCellComments && (
        <div className="mt-2">
          <CommentThread targetType="GLYPH_CELL" targetId={cellId} />
        </div>
      )}
    </section>
  );
}
