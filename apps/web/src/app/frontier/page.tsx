"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RightsBadge } from "@/components/badges";

const STATUS_LABEL: Record<string, string> = {
  NEWS_MENTION: "보도 단계",
  INSTITUTION_CONFIRMED: "기관 확인",
  PRELIMINARY_READING: "1차 판독",
  DATA_REQUESTED: "자료 요청",
  BASIC_REPORT: "기본 보고서",
  OPEN_DATA_AVAILABLE: "공개 데이터",
  MULTIPLE_STUDIES: "복수 연구",
  STABLE_REFERENCE: "안정 참조",
  CONTESTED_REFERENCE: "논쟁 참조",
};

export default function FrontierPage() {
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ["frontier"], queryFn: api.listFrontier });
  const { data: sets } = useQuery({ queryKey: ["sets"], queryFn: api.listSets });
  const [message, setMessage] = useState<string | null>(null);
  const defaultSetId = sets?.[0]?.set.id;

  const promote = useMutation({
    mutationFn: (id: string) => {
      if (!defaultSetId) throw new Error("연구 세트가 없습니다");
      return api.promoteFrontier(id, defaultSetId);
    },
    onSuccess: (data) => {
      setMessage(
        `'${data.tab.title}' 메타데이터 탭으로 승격됨 — 1차 판독은 확정 판독으로 표시되지 않습니다.`
      );
      void qc.invalidateQueries({ queryKey: ["frontier"] });
      void qc.invalidateQueries({ queryKey: ["sets"] });
    },
    onError: (e) => setMessage((e as Error).message),
  });

  const recheck = useMutation({
    mutationFn: (id: string) => api.recheckFrontier(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["frontier"] }),
  });

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-neutral-400 hover:text-[var(--accent)]">
          ← 대시보드
        </Link>
        <h1 className="text-xl font-bold">Frontier Watch</h1>
        <p className="w-full text-sm text-neutral-400">
          새 발견을 정답 코퍼스로 넣지 않고, 자료 성숙도와 출처 상태를 추적하는 관찰
          목록입니다.
        </p>
      </header>
      {message && (
        <p className="panel mb-4 p-3 text-sm text-emerald-300" data-testid="frontier-message">
          {message}
        </p>
      )}
      <ul className="space-y-4">
        {items?.map((item) => (
          <li key={item.id} className="panel p-4" data-testid={`watch-item-${item.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{item.provisionalName}</h2>
              <span className="badge badge-frontier" data-testid={`watch-status-${item.id}`}>
                {STATUS_LABEL[item.status] ?? item.status}
              </span>
              <RightsBadge state={item.rightsState} />
              {item.frontierIndex !== null && (
                <span className="badge badge-neutral">
                  Frontier Index {item.frontierIndex}
                </span>
              )}
            </div>
            <dl className="mt-2 grid gap-1 text-xs text-neutral-400 sm:grid-cols-2">
              <div>
                <dt className="inline text-neutral-500">발견/발표: </dt>
                <dd className="inline">
                  {item.discoveryDate ?? "?"} / {item.announcementDate ?? "?"}
                </dd>
              </div>
              <div>
                <dt className="inline text-neutral-500">보고 기관: </dt>
                <dd className="inline">{item.reportingInstitution}</dd>
              </div>
              <div>
                <dt className="inline text-neutral-500">자료 확보: </dt>
                <dd className="inline" data-testid={`watch-assets-${item.id}`}>
                  {item.assetAvailability.length > 0
                    ? item.assetAvailability.join(", ")
                    : "원본 자료 미확보"}
                </dd>
              </div>
              <div>
                <dt className="inline text-neutral-500">다음 예상 이벤트: </dt>
                <dd className="inline">{item.nextExpectedEvent}</dd>
              </div>
            </dl>
            {item.preliminaryClaims.length > 0 && (
              <section className="mt-2">
                <h3 className="text-xs font-semibold text-amber-200">
                  1차 판독 주장 <span className="badge badge-warn">확정 아님</span>
                </h3>
                <ul className="mt-1 list-inside list-disc text-xs text-neutral-300">
                  {item.preliminaryClaims.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button
                onClick={() => recheck.mutate(item.id)}
                className="badge badge-neutral"
                data-testid={`watch-recheck-${item.id}`}
              >
                상태 재확인
              </button>
              {item.promotedTabId ? (
                <Link
                  href={defaultSetId ? `/sets/${defaultSetId}?tab=${item.promotedTabId}` : "#"}
                  className="badge badge-ok"
                  data-testid={`watch-open-tab-${item.id}`}
                >
                  연결된 탭 열기 →
                </Link>
              ) : (
                <button
                  onClick={() => promote.mutate(item.id)}
                  disabled={!defaultSetId || promote.isPending}
                  className="badge badge-demo"
                  data-testid={`watch-promote-${item.id}`}
                >
                  메타데이터 탭으로 승격
                </button>
              )}
              <span className="text-neutral-500">
                마지막 확인 {item.lastCheckedAt ?? "—"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
