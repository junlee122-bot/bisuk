"use client";

import Link from "next/link";
import { Suspense, use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, labApi } from "@/lib/api";

function ReadingTable({ setId }: { setId: string }) {
  const params = useSearchParams();
  const { data: overview } = useQuery({ queryKey: ["set", setId], queryFn: () => api.getSet(setId) });
  const [tabId, setTabId] = useState<string | null>(params.get("tab"));
  const [onlyDisagree, setOnlyDisagree] = useState(false);
  const active = tabId ?? overview?.tabs[0]?.tab.id ?? null;
  const { data } = useQuery({ queryKey: ["reading-comparison", active], queryFn: () => labApi.readingComparison(active!), enabled: Boolean(active) });
  const rows = (data?.rows ?? []).filter((r) => (onlyDisagree ? r.disagreement : Object.keys(r.values).length > 0 || r.adopted));
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-8" data-testid="reading-comparison-page">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/sets/${setId}${active ? `?tab=${active}` : ""}`} className="text-sm text-ink-2 hover:text-[var(--accent)]">
          ← 워크스페이스
        </Link>
        <h1 className="text-xl font-bold">판독자별 비교표</h1>
        <select value={active ?? ""} onChange={(e) => setTabId(e.target.value)} className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1 text-sm" aria-label="비석 선택">
          {overview?.tabs.map(({ tab }) => (
            <option key={tab.id} value={tab.id}>
              {tab.title}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={onlyDisagree} onChange={(e) => setOnlyDisagree(e.target.checked)} /> 불일치만
        </label>
        {active && (
          <a href={labApi.readingComparisonCsvUrl(active)} className="badge badge-neutral ml-auto" data-testid="reading-csv">
            CSV 내려받기 (Excel)
          </a>
        )}
      </header>
      <p className="mb-2 text-xs text-ink-3">
        표기: 글자 = 판독, [字] = 복원, 字? = 불확실, 字(異) = 이체, □ = 결락, [?] = 판독 불가. 기각·대체·초안 판독은 제외합니다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm" data-testid="reading-table">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="p-2">위치</th>
              {data?.columns.map((c) => (
                <th key={c.key} className="p-2">
                  {c.label}
                  <span className="block text-[10px] font-normal">{c.sourceType === "PUBLISHED_EDITION" ? "출판본" : c.sourceType === "RESEARCHER" ? "연구원" : "자동"}</span>
                </th>
              ))}
              <th className="p-2">연구실 채택</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cellId} className={`border-t border-[var(--panel-border)] ${r.disagreement ? "bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)]" : ""}`}>
                <td className="whitespace-nowrap p-2 text-xs">
                  <Link href={`/sets/${setId}?tab=${active}&cell=${r.cellId}`} className="underline decoration-dotted">
                    {r.faceLabel} {r.lineIndex}행 {r.sequenceIndex}자
                  </Link>
                  {r.disagreement && <span className="badge badge-warn ml-1">불일치</span>}
                </td>
                {data?.columns.map((c) => (
                  <td key={c.key} className="p-2 text-base">
                    {r.values[c.key] ?? ""}
                  </td>
                ))}
                <td className="p-2 text-base font-semibold">{r.adopted ?? ""}</td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr>
                <td className="p-4 text-xs text-ink-3" colSpan={(data.columns.length ?? 0) + 2}>
                  판독이 없습니다. 워크스페이스에서 판독을 제안하거나 ‘비석 관리 → 판독문 가져오기’로 출판 판독문을 넣으세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export default function ReadingsPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = use(params);
  return (
    <Suspense fallback={null}>
      <ReadingTable setId={setId} />
    </Suspense>
  );
}
