"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { labApi } from "@/lib/api";

type AuditRow = Awaited<ReturnType<typeof labApi.auditQuery>>[number] & { seq?: number };

export default function AuditPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = use(params);
  const [filters, setFilters] = useState({ action: "", entityType: "", entityId: "", actor: "", since: "" });
  const [applied, setApplied] = useState(filters);
  const query = useInfiniteQuery({
    queryKey: ["audit", applied],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => labApi.auditQuery({ ...applied, limit: 100, beforeSeq: pageParam }) as Promise<AuditRow[]>,
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1]?.seq : undefined),
  });
  const verify = useMutation({ mutationFn: labApi.auditVerify });
  const events = query.data?.pages.flat() ?? [];
  const input = "rounded border border-[var(--panel-border)] bg-transparent px-2 py-1";
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/sets/${setId}`} className="text-sm text-ink-2 hover:text-[var(--accent)]">
          ← 워크스페이스
        </Link>
        <h1 className="text-xl font-bold">감사 로그</h1>
        <button className="badge badge-neutral ml-auto" onClick={() => verify.mutate()} data-testid="audit-verify">
          해시 체인 검증
        </button>
        {verify.data && (
          <span className={`badge ${verify.data.ok ? "badge-ok" : "badge-rights"}`} data-testid="audit-verify-result">
            {verify.data.ok ? `무결성 확인 (${verify.data.checked}건)` : `변조 의심: #${verify.data.firstBrokenSeq} — ${verify.data.reason}`}
          </span>
        )}
      </header>
      <form
        className="mb-3 flex flex-wrap items-center gap-2 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filters);
        }}
      >
        <input className={input} placeholder="행위 (예: REVIEW_READING)" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        <input className={input} placeholder="대상 유형 (GlyphCell…)" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} />
        <input className={input} placeholder="대상 ID" value={filters.entityId} onChange={(e) => setFilters({ ...filters, entityId: e.target.value })} />
        <input className={input} placeholder="행위자 ID" value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} />
        <input className={input} type="date" value={filters.since} onChange={(e) => setFilters({ ...filters, since: e.target.value })} aria-label="이후 날짜" />
        <button className="badge badge-demo" type="submit">
          필터
        </button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs" data-testid="audit-table">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="p-2">#</th>
              <th className="p-2">시각</th>
              <th className="p-2">행위자</th>
              <th className="p-2">행위</th>
              <th className="p-2">대상</th>
              <th className="p-2">세부</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-[var(--panel-border)] align-top">
                <td className="p-2 text-ink-3">{e.seq}</td>
                <td className="whitespace-nowrap p-2 text-ink-3">{e.ts.replace("T", " ").slice(0, 19)}</td>
                <td className="p-2">{e.actorName ?? e.actor}</td>
                <td className="p-2">
                  <span className="badge badge-neutral">{e.action}</span>
                </td>
                <td className="p-2">
                  {e.entityType}
                  <span className="text-ink-3"> {e.entityId}</span>
                </td>
                <td className="max-w-96 break-all p-2 text-ink-2">{JSON.stringify(e.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage && (
        <button className="badge badge-neutral mt-3" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          더 보기
        </button>
      )}
    </main>
  );
}
