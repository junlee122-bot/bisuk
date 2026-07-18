"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Icon } from "@/components/ui/Icon";

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

  const summary = (sets ?? []).reduce(
    (acc, item) => ({
      tabs: acc.tabs + item.stats.tabCount,
      unresolved: acc.unresolved + item.stats.unresolvedGlyphs,
      reviews: acc.reviews + item.stats.rightsWarnings + item.stats.conflictingGlyphs,
    }),
    { tabs: 0, unresolved: 0, reviews: 0 }
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.7fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-line-soft bg-surface px-5 py-7 shadow-[var(--shadow-sm)] sm:px-8 sm:py-9">
          <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-jade-soft opacity-55 blur-3xl" aria-hidden="true" />
          <div className="relative max-w-3xl">
            <p className="section-label text-clay">Comparative inscription research</p>
            <h1 className="mt-3 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              판독부터 근거 검증까지,
              <span className="block text-clay">하나의 연구 흐름으로</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-2 sm:text-base">
              비석·탁본·3D 표면·판독문을 함께 열고 후보 문자를 비교하세요. 모든 판단은
              출처, 반증, 권리 상태와 연결되어 재검토 가능한 연구 기록으로 남습니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {sets?.[0] ? (
                <Link href={`/sets/${sets[0].set.id}`} className="ui-button ui-button-primary">
                  최근 연구 계속하기
                  <Icon name="arrow-right" />
                </Link>
              ) : (
                <a href="#new-research-set" className="ui-button ui-button-primary">
                  첫 연구 세트 만들기
                  <Icon name="arrow-right" />
                </a>
              )}
              <Link href="/frontier" className="ui-button ui-button-secondary">
                <Icon name="compass" />
                발견 동향 검토
              </Link>
            </div>
          </div>
        </div>

        <aside className="panel p-5" aria-label="연구 현황 요약">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-label">Workspace pulse</p>
              <h2 className="mt-1 text-lg font-bold">오늘의 연구 현황</h2>
            </div>
            <span className="badge badge-ok"><span className="status-dot" /> 시스템 정상</span>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-2">
            <div className="metric-card">
              <dt className="text-[11px] text-ink-3">연구 세트</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{sets?.length ?? 0}</dd>
            </div>
            <div className="metric-card">
              <dt className="text-[11px] text-ink-3">열린 대상</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{summary.tabs}</dd>
            </div>
            <div className="metric-card">
              <dt className="text-[11px] text-ink-3">검토 필요</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-[var(--state-warning)]">
                {summary.reviews}
              </dd>
            </div>
          </dl>
          <div className="mt-4 rounded-lg border border-line-soft bg-surface-2 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Icon name="shield" className="h-4 w-4 text-jade" />
              검증 원칙
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-2">
              원본·가상 자산을 구분하고, 미확정 판독과 권리 미검토 자료는 결과물에 명시합니다.
            </p>
          </div>
        </aside>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="연구 작업 흐름">
        {[
          ["01", "대상 구성", "비석·탁본·문헌을 연구 세트에 모으고 권리 상태를 확인합니다.", "layers"],
          ["02", "표면 관찰", "정사영·사광·곡률·3D 비교로 손상 흔적과 글자 영역을 관찰합니다.", "box"],
          ["03", "근거 검증", "독립 후보, 지지·반증 문헌, 인용 검증을 함께 기록합니다.", "check"],
        ].map(([step, title, description, icon]) => (
          <article key={step} className="panel flex gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-clay">
              <Icon name={icon as "layers" | "box" | "check"} />
            </span>
            <div>
              <p className="section-label">Step {step}</p>
              <h2 className="mt-0.5 text-sm font-bold">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-ink-2">{description}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="mt-9" aria-labelledby="research-set-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-label">Research sets</p>
            <h2 id="research-set-heading" className="mt-1 text-xl font-bold">진행 중인 연구</h2>
            <p className="mt-1 text-sm text-ink-2">우선 검토가 필요한 항목을 한눈에 확인하세요.</p>
          </div>
          <a href="#new-research-set" className="ui-button ui-button-secondary">
            <Icon name="plus" /> 새 연구 세트
          </a>
        </div>

        <div className="research-grid mt-4 gap-4" aria-label="연구 세트 목록">
          {isLoading && [0, 1].map((item) => (
            <div key={item} className="panel p-5" aria-hidden="true">
              <div className="skeleton h-5 w-2/5" />
              <div className="skeleton mt-3 h-3 w-4/5" />
              <div className="mt-5 grid grid-cols-3 gap-2"><div className="skeleton h-16" /><div className="skeleton h-16" /><div className="skeleton h-16" /></div>
            </div>
          ))}
          {sets?.map(({ set, stats }) => {
            const needsAttention = stats.rightsWarnings + stats.conflictingGlyphs;
            return (
              <article
                key={set.id}
                className="panel panel-interactive flex min-h-64 flex-col p-5"
                data-testid={`set-card-${set.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-neutral">{stats.tabCount}개 대상</span>
                      {needsAttention > 0 ? (
                        <span className="badge badge-warn"><Icon name="warning" className="h-3 w-3" /> 검토 {needsAttention}</span>
                      ) : (
                        <span className="badge badge-ok"><Icon name="check" className="h-3 w-3" /> 검토 완료</span>
                      )}
                    </div>
                    <h3 className="mt-3 truncate text-lg font-bold">{set.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-ink-2">{set.description}</p>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-muted text-clay">
                    <Icon name="layers" className="h-5 w-5" />
                  </span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="metric-card col-span-2 sm:col-span-1">
                    <dt className="text-[11px] text-ink-3">주 연구 대상</dt>
                    <dd className="mt-1 truncate text-sm font-semibold">{stats.primaryTabTitle ?? "미지정"}</dd>
                  </div>
                  <div className="metric-card">
                    <dt className="text-[11px] text-ink-3">미해결 문자</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums">{stats.unresolvedGlyphs}</dd>
                  </div>
                  <div className="metric-card">
                    <dt className="text-[11px] text-ink-3">권리 확인</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums">{stats.rightsWarnings}</dd>
                  </div>
                  <div className="metric-card">
                    <dt className="text-[11px] text-ink-3">발견 항목</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums">{stats.frontierItems}</dd>
                  </div>
                </dl>
                <div className="mt-auto flex items-center justify-between border-t border-line-soft pt-4">
                  <span className="text-xs text-ink-3">마지막 작업 상태 자동 복원</span>
                  <Link href={`/sets/${set.id}`} className="ui-button ui-button-primary">
                    연구실 열기 <Icon name="arrow-right" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="new-research-set" className="panel mt-8 scroll-mt-24 p-5 sm:p-6" aria-label="연구 세트 생성">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-center">
          <div>
            <p className="section-label">New research set</p>
            <h2 className="mt-1 text-lg font-bold">새 비교 연구 시작</h2>
            <p className="mt-2 text-sm leading-6 text-ink-2">
              연구 질문이나 비교 범위가 드러나는 이름을 사용하세요. 세트 안에서 대상별 탭과 근거 기록을 관리할 수 있습니다.
            </p>
          </div>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) createMutation.mutate();
            }}
          >
            <label className="sr-only" htmlFor="research-set-name">연구 세트 이름</label>
            <input
              id="research-set-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 신라 순수비 서체·어휘 비교"
              className="ui-input min-w-0 flex-1"
              aria-describedby="research-set-help"
            />
            <button type="submit" disabled={createMutation.isPending || !name.trim()} className="ui-button ui-button-primary">
              <Icon name="plus" />
              {createMutation.isPending ? "생성 중" : "세트 생성"}
            </button>
          </form>
        </div>
        <p id="research-set-help" className="mt-2 text-xs text-ink-3 lg:text-right">생성 후 자산·문헌·비교 대상을 추가할 수 있습니다.</p>
        {createMutation.isError && (
          <p className="mt-3 rounded-lg border border-[#e6c3be] bg-[#f7e3e0] p-3 text-xs text-[var(--state-danger)]" role="alert">
            생성하지 못했습니다. {(createMutation.error as Error).message}
          </p>
        )}
      </section>
    </main>
  );
}
