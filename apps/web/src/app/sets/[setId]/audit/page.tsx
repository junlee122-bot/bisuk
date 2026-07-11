"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function AuditPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = use(params);
  const { data: events } = useQuery({ queryKey: ["audit"], queryFn: api.listAudit });
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8">
      <header className="mb-4 flex items-center gap-3">
        <Link
          href={`/sets/${setId}`}
          className="text-sm text-neutral-400 hover:text-[var(--accent)]"
        >
          ← 워크스페이스
        </Link>
        <h1 className="text-xl font-bold">감사 로그</h1>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs" data-testid="audit-table">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="p-2">시각</th>
              <th className="p-2">행위</th>
              <th className="p-2">대상</th>
              <th className="p-2">세부</th>
            </tr>
          </thead>
          <tbody>
            {events?.map((e) => (
              <tr key={e.id} className="border-t border-[var(--panel-border)] align-top">
                <td className="p-2 whitespace-nowrap text-neutral-500">{e.ts}</td>
                <td className="p-2">
                  <span className="badge badge-neutral">{e.action}</span>
                </td>
                <td className="p-2">
                  {e.entityType}
                  <span className="text-neutral-500"> {e.entityId}</span>
                </td>
                <td className="max-w-96 break-all p-2 text-neutral-400">
                  {JSON.stringify(e.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
