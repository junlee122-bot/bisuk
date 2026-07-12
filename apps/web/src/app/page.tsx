"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function DashboardPage() {
  const qc = useQueryClient();
  const { data: sets, isLoading } = useQuery({
    queryKey: ["sets"],
    queryFn: api.listSets,
  });
  const [name, setName] = useState("");
  const createMutation = useMutation({
    mutationFn: () => api.createSet({ name }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["sets"] });
    },
  });

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          석문<span className="text-[var(--accent)]">(石文)</span> Comparative
          Autonomous Studio
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          여러 비석·조각·탁본·판독문을 탭으로 열고, 문헌을 교차 검색해 근거 중심으로
          복원 가설을 검증하는 연구 작업대
        </p>
        <nav className="mt-3 flex gap-3 text-sm">
          <Link className="underline decoration-dotted" href="/frontier">
            Frontier Watch
          </Link>
        </nav>
      </header>

      <section aria-label="연구 세트 목록" className="grid gap-4">
        {isLoading && <p className="text-ink-2">불러오는 중…</p>}
        {sets?.map(({ set, stats }) => (
          <Link
            key={set.id}
            href={`/sets/${set.id}`}
            className="panel block p-4 transition hover:border-[var(--accent)]"
            data-testid={`set-card-${set.id}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{set.name}</h2>
              <span className="text-xs text-ink-2">
                열린 탭 {stats.tabCount}개
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-2">{set.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <div className="panel p-2">
                <dt className="text-ink-3">주 대상</dt>
                <dd className="mt-0.5 font-medium">{stats.primaryTabTitle ?? "—"}</dd>
              </div>
              <div className="panel p-2">
                <dt className="text-ink-3">미해결 문자</dt>
                <dd className="mt-0.5 font-medium">{stats.unresolvedGlyphs}</dd>
              </div>
              <div className="panel p-2">
                <dt className="text-ink-3">상충 가설</dt>
                <dd className="mt-0.5 font-medium">{stats.conflictingGlyphs}</dd>
              </div>
              <div className="panel p-2">
                <dt className="text-ink-3">권리 확인 필요</dt>
                <dd className="mt-0.5 font-medium">{stats.rightsWarnings}</dd>
              </div>
              <div className="panel p-2">
                <dt className="text-ink-3">Frontier 항목</dt>
                <dd className="mt-0.5 font-medium">{stats.frontierItems}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </section>

      <section className="panel mt-6 p-4" aria-label="연구 세트 생성">
        <h2 className="text-sm font-semibold text-ink-2">새 연구 세트</h2>
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="세트 이름 (예: 신라 순수비 비교)"
            className="min-w-60 flex-1 rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-sm"
            aria-label="연구 세트 이름"
          />
          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim()}
            className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
          >
            생성
          </button>
        </form>
        {createMutation.isError && (
          <p className="mt-2 text-xs text-[var(--state-danger)]">
            생성 실패: {(createMutation.error as Error).message}
          </p>
        )}
      </section>
    </main>
  );
}
