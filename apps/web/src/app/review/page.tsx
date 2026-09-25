"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatReadingToken } from "@seokmun/engine";
import { labApi } from "@/lib/api";
import { useCan } from "@/lib/session";

export default function ReviewQueuePage() {
  const qc = useQueryClient();
  const isPI = useCan("PI");
  const { data } = useQuery({ queryKey: ["review-queue"], queryFn: labApi.reviewQueue });
  const review = useMutation({
    mutationFn: ({ id, decision, version }: { id: string; decision: "ACCEPT" | "REJECT"; version: number }) =>
      labApi.reviewReading(id, { decision, expectedVersion: version, note: decision === "REJECT" ? window.prompt("기각 사유 (선택)") ?? "" : "" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["review-queue"] }),
  });
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8" data-testid="review-page">
      <h1 className="text-xl font-bold">판독 검토 대기열</h1>
      <p className="mt-1 text-sm text-ink-2">
        연구원이 제안한 판독입니다. PI가 채택하면 해당 셀의 연구실 판독으로 확정되고, 이전 채택 판독은 ‘대체됨’으로 남습니다.
      </p>
      {review.error && <p className="mt-2 text-sm text-[var(--state-danger)]">{(review.error as Error).message}</p>}
      <ul className="mt-4 space-y-2">
        {data?.map(({ reading: r, tab, cell }) => (
          <li key={r.id} className="panel flex flex-wrap items-center gap-2 p-3 text-sm" data-testid={`review-item-${r.id}`}>
            <span className="text-2xl">{formatReadingToken(r)}</span>
            <div className="min-w-0 flex-1">
              <p>
                <Link href={`/sets/${tab.researchSetId}?tab=${tab.id}${cell ? `&cell=${cell.id}` : ""}`} className="font-medium underline decoration-dotted">
                  {tab.title} {cell ? `${cell.lineIndex}행 ${cell.sequenceIndex}자` : ""}
                </Link>{" "}
                · {r.sourceLabel || r.authorName} · {r.certainty}
              </p>
              {r.rationale && <p className="text-xs text-ink-2">{r.rationale}</p>}
            </div>
            {isPI && (
              <>
                <button className="badge badge-ok" onClick={() => review.mutate({ id: r.id, decision: "ACCEPT", version: r.version })}>
                  채택
                </button>
                <button className="badge badge-rights" onClick={() => review.mutate({ id: r.id, decision: "REJECT", version: r.version })}>
                  기각
                </button>
              </>
            )}
          </li>
        ))}
        {data?.length === 0 && <li className="text-sm text-ink-3">검토를 기다리는 판독이 없습니다.</li>}
      </ul>
    </main>
  );
}
