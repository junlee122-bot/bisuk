"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TabUiState, type GlyphCell, type RightsState, type SteleAsset } from "@seokmun/types";
import { api, type TabDetail } from "@/lib/api";
import { useStageMode } from "@/lib/store";
import { Viewer3D } from "@/features/high-fidelity-3d/HybridSteleViewport";
import type { BookmarkName } from "@/features/high-fidelity-3d/cameraBookmarks";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { DemoBadge, ReadingBadge, RightsBadge } from "@/components/badges";
import { rightsLabel } from "@/lib/labels";

/** 공개 쇼케이스 권리 게이트 — 엔진 내보내기 허용목록(exporters)과 동일 기준.
 * 가상 데모(provenance=VIRTUAL_DEMO)는 항상 허용, 그 외에는 재배포 가능 권리만. */
const REDISTRIBUTABLE: RightsState[] = [
  "OPEN_FOR_REUSE",
  "ATTRIBUTION_REQUIRED",
  "NONCOMMERCIAL",
];
function publicShowable(asset: SteleAsset): boolean {
  if (asset.provenance === "VIRTUAL_DEMO") return true;
  return REDISTRIBUTABLE.includes(asset.rightsState);
}

interface Chapter {
  key: string;
  no: number;
  title: string;
  heading: string;
  bookmark: BookmarkName;
  ui: Partial<TabUiState>;
  selectGlyph?: string;
}

const FOCUS_CELL = "demoA-L2-C3";
const UNKNOWN_CELL = "demoA-L3-C5";

const CHAPTERS: Chapter[] = [
  {
    key: "artifact",
    no: 1,
    title: "유물",
    heading: "비석의 전체 형태",
    bookmark: "HERO_THREE_QUARTER",
    ui: { lightingPreset: "MUSEUM_NEUTRAL", representation: "PBR_PRESENTATION", lodLevel: "MEDIUM", renderMode: "ALBEDO" },
  },
  {
    key: "surface",
    no: 2,
    title: "표면",
    heading: "사광 아래의 음각",
    bookmark: "FRONT_INSCRIPTION",
    ui: { lightingPreset: "RAKING", representation: "PBR_PRESENTATION", lodLevel: "MEDIUM", renderMode: "ALBEDO", lightAzimuthDeg: 105, lightElevationDeg: 12 },
  },
  {
    key: "glyph",
    no: 3,
    title: "자형",
    heading: "한 글자를 가까이",
    bookmark: "DETAIL_SELECTED_GLYPH",
    selectGlyph: FOCUS_CELL,
    ui: { lightingPreset: "MUSEUM_NEUTRAL", representation: "PBR_PRESENTATION", lodLevel: "FULL", renderMode: "ALBEDO" },
  },
  {
    key: "compare",
    no: 4,
    title: "비교",
    heading: "다른 비석의 유사 자형",
    bookmark: "FULL_ARTIFACT",
    ui: { lightingPreset: "MUSEUM_NEUTRAL", representation: "PBR_PRESENTATION", lodLevel: "MEDIUM", renderMode: "ALBEDO" },
  },
  {
    key: "evidence",
    no: 5,
    title: "근거",
    heading: "결론은 근거를 따른다",
    bookmark: "FULL_ARTIFACT",
    ui: { lightingPreset: "LABORATORY_NEUTRAL", representation: "RESEARCH_EVIDENCE", lodLevel: "MEDIUM", renderMode: "ALBEDO" },
  },
];

export function Showcase({ setId }: { setId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setMode = useStageMode((s) => s.setMode);

  // 쇼케이스는 전시 동선 — 진입 시 전시 보기
  useEffect(() => setMode("EXHIBITION"), [setMode]);

  const { data } = useQuery({
    queryKey: ["showcase", setId],
    queryFn: async () => {
      const overview = await api.getSet(setId);
      const details = await Promise.all(
        overview.tabs.map((t) => api.getTab(t.tab.id).catch(() => null))
      );
      return { overview, details: details.filter(Boolean) as TabDetail[] };
    },
  });

  const chapterIdx = Math.min(
    CHAPTERS.length - 1,
    Math.max(0, Number(searchParams.get("chapter") ?? "1") - 1)
  );
  const chapter = CHAPTERS[chapterIdx]!;
  const [guided, setGuided] = useState(true);
  const [flyTo, setFlyTo] = useState<{ name: BookmarkName; seq: number } | null>(null);
  const flySeq = useRef(0);

  // 쇼케이스 전용 로컬 표시 상태 — 읽기 전용 재구성: 서버에 저장하지 않는다
  const [ui, setUi] = useState<TabUiState>(() => TabUiState.parse({}));
  const [selectedGlyph, setSelectedGlyph] = useState<string | null>(null);

  const applyChapter = useCallback((c: Chapter) => {
    setUi((prev) => ({ ...prev, ...c.ui, camera: prev.camera }));
    setSelectedGlyph(c.selectGlyph ?? null);
    flySeq.current += 1;
    setFlyTo({ name: c.bookmark, seq: flySeq.current });
  }, []);

  const gotoChapter = useCallback(
    (idx: number) => {
      const clamped = Math.min(CHAPTERS.length - 1, Math.max(0, idx));
      router.replace(`/showcase/${setId}?chapter=${clamped + 1}`, { scroll: false });
      setGuided(true);
    },
    [router, setId]
  );

  // 챕터 변경 → 가이드 적용
  useEffect(() => {
    if (guided) applyChapter(chapter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx, guided]);

  // 키보드 좌우 화살표
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (e.key === "ArrowRight") gotoChapter(chapterIdx + 1);
      if (e.key === "ArrowLeft") gotoChapter(chapterIdx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chapterIdx, gotoChapter]);

  const primary = useMemo(() => {
    if (!data) return null;
    const withMesh = data.details.find((d) =>
      d.assets.some((a) => a.assetType === "MESH" && a.format === "PROCEDURAL_MESH")
    );
    return withMesh ?? data.details[0] ?? null;
  }, [data]);

  const meshAsset = primary?.assets.find(
    (a) => a.assetType === "MESH" && a.format === "PROCEDURAL_MESH" && publicShowable(a)
  );

  // 권리 게이트 — 공개 불가 자산 목록 (내용은 노출하지 않고 사유만)
  const gatedAssets = useMemo(
    () =>
      (data?.details ?? []).flatMap((d) =>
        d.assets
          .filter((a) => !publicShowable(a))
          .map((a) => ({ tab: d.tab.title, name: a.originalFilename ?? a.id, state: a.rightsState }))
      ),
    [data]
  );

  const metrics = useMemo(() => {
    if (!data) return null;
    const cells = data.details.flatMap((d) => d.glyphCells);
    const unresolved = cells.filter((c) =>
      ["UNKNOWN", "CONFLICTING"].includes(c.readingStatus)
    ).length;
    return {
      tabCount: data.overview.stats.tabCount,
      cellCount: cells.length,
      sourceCount: data.details.reduce((n, d) => n + d.sourceRecords.length, 0),
      unresolvedRatio: cells.length ? Math.round((unresolved / cells.length) * 100) : 0,
      unresolved,
    };
  }, [data]);

  if (!data || !metrics) {
    return <p className="p-8 text-sm text-ink-2">쇼케이스 불러오는 중…</p>;
  }

  return (
    <div className="min-h-full bg-paper" data-testid="showcase-root">
      {/* Hero */}
      <section className="border-b border-line-soft bg-[var(--canvas-page)] px-6 pb-4 pt-8 text-center" data-testid="showcase-hero">
        <p className="text-xs tracking-widest text-ink-3">석문 Studio</p>
        <h1 className="font-display mt-1 text-3xl font-semibold sm:text-4xl">
          {data.overview.set.name}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          손상된 비문을, 근거와 함께 다시 읽다 — 가상 데모 자료로 전 과정을 재현한 연구
          스튜디오입니다.
        </p>
        <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-3">
          {[
            ["비교 비석", `${metrics.tabCount}기`, "metric-tabs"],
            ["등록 문자 영역", `${metrics.cellCount}칸`, "metric-cells"],
            ["공식 출처 카드", `${metrics.sourceCount}건`, "metric-sources"],
            ["미확정(UNKNOWN·CONFLICTING)", `${metrics.unresolvedRatio}% (${metrics.unresolved}칸)`, "metric-unresolved"],
          ].map(([label, value, tid]) => (
            <div key={tid} className="panel min-w-32 px-4 py-2" data-testid={tid}>
              <p className="text-[11px] text-ink-3">{label}</p>
              <p className="font-display text-lg">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-3">
          모든 지표는 현재 저장된 실제 데이터에서 계산됩니다 — 홍보용 수치를 만들지
          않습니다.
        </p>
        <Link
          href={`/sets/${setId}`}
          className="badge badge-demo mt-3 inline-flex px-4 py-1 text-sm"
          data-testid="open-workspace"
        >
          연구 작업대 열기 →
        </Link>
      </section>

      {/* Stage + Chapters */}
      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="relative min-h-[420px] lg:sticky lg:top-0 lg:h-[calc(100vh-4rem)]">
          {meshAsset && primary ? (
            <Viewer3D
              asset={meshAsset}
              cells={primary.glyphCells}
              uiState={{ ...ui, activeGlyphCellId: selectedGlyph }}
              selectedId={selectedGlyph}
              onSelect={(id) => setSelectedGlyph(id)}
              onUiStateChange={(patch) => setUi((prev) => ({ ...prev, ...patch }))}
              externalFlyTo={flyTo}
              onUserInteract={() => setGuided(false)}
            />
          ) : (
            <p className="p-8 text-sm text-ink-2">
              공개 가능한 3D 자산이 없습니다 (권리 게이트).
            </p>
          )}
          {!guided && (
            <button
              onClick={() => {
                setGuided(true);
                applyChapter(chapter);
              }}
              className="badge badge-demo absolute bottom-3 left-1/2 z-10 -translate-x-1/2 px-3 py-1"
              data-testid="guide-return"
            >
              가이드로 돌아가기
            </button>
          )}
        </section>

        <aside className="border-l border-line-soft bg-surface p-5" data-testid="chapter-panel">
          {/* 챕터 네비 */}
          <nav className="flex items-center gap-2" aria-label="챕터 이동">
            <button
              onClick={() => gotoChapter(chapterIdx - 1)}
              disabled={chapterIdx === 0}
              className="badge badge-neutral disabled:opacity-40"
              data-testid="chapter-prev"
              aria-label="이전 챕터"
            >
              ←
            </button>
            <div className="flex items-center gap-1.5">
              {CHAPTERS.map((c, i) => (
                <button
                  key={c.key}
                  onClick={() => gotoChapter(i)}
                  aria-label={`챕터 ${c.no} ${c.title}`}
                  aria-current={i === chapterIdx}
                  data-testid={`chapter-dot-${c.no}`}
                  className={`h-2.5 w-2.5 rounded-full transition-colors ${
                    i === chapterIdx ? "bg-clay" : "bg-line-strong hover:bg-ink-3"
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => gotoChapter(chapterIdx + 1)}
              disabled={chapterIdx === CHAPTERS.length - 1}
              className="badge badge-neutral disabled:opacity-40"
              data-testid="chapter-next"
              aria-label="다음 챕터"
            >
              →
            </button>
            <span className="ml-auto text-[11px] text-ink-3">
              {chapter.no} / {CHAPTERS.length} · ← → 키
            </span>
          </nav>

          <p className="mt-4 text-[11px] tracking-widest text-ink-3">
            CHAPTER {chapter.no} — {chapter.title.toUpperCase()}
          </p>
          <h2 className="font-display mt-1 text-xl font-semibold">{chapter.heading}</h2>

          <div className="mt-3 space-y-3 text-sm text-ink-2" data-testid={`chapter-body-${chapter.key}`}>
            {chapter.key === "artifact" && primary && (
              <ArtifactChapter detail={primary} gated={gatedAssets} />
            )}
            {chapter.key === "surface" && (
              <SurfaceChapter
                representation={ui.representation ?? "PBR_PRESENTATION"}
                onRepresentation={(r) => setUi((prev) => ({ ...prev, representation: r }))}
              />
            )}
            {chapter.key === "glyph" && primary && (
              <GlyphChapter cells={primary.glyphCells} focusId={FOCUS_CELL} />
            )}
            {chapter.key === "compare" && <CompareChapter details={data.details} />}
            {chapter.key === "evidence" && <EvidenceChapter details={data.details} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ArtifactChapter({
  detail,
  gated,
}: {
  detail: TabDetail;
  gated: Array<{ tab: string; name: string; state: RightsState }>;
}) {
  return (
    <>
      <p>
        <strong className="text-ink">{detail.tab.title}</strong> —{" "}
        {detail.tab.canonicalName}. 이 무대의 3D는 절차 생성된{" "}
        <strong>가상 데모 메시</strong>이며 실제 유물 스캔이 아닙니다.
      </p>
      <DemoBadge label="가상 데모 — 실제 판독 결과 아님" />
      <ul className="list-inside list-disc space-y-1">
        {detail.tab.knownFacts.slice(0, 3).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <div className="panel p-3">
        <h3 className="text-xs font-semibold text-ink">데이터 품질 · 측정 가능 여부</h3>
        <p className="mt-1 text-xs">
          가상 단위 좌표 — mm 환산 없음. 측정·판독 기준은 연구 보기의 Evidence
          표현입니다. 전시 표현 보강은 측정 정확도를 높이지 않습니다.
        </p>
      </div>
      <div className="panel p-3">
        <h3 className="text-xs font-semibold text-ink">공식 출처 카드</h3>
        <ul className="mt-1 space-y-1 text-xs">
          {detail.sourceRecords.slice(0, 3).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-1">
              <span>
                {s.publisher} · {s.type}
              </span>
              <RightsBadge state={s.rightsState} />
            </li>
          ))}
        </ul>
      </div>
      {gated.length > 0 && (
        <div className="panel border-[#e6c3be] p-3" data-testid="rights-gate-note">
          <h3 className="text-xs font-semibold text-[var(--state-danger)]">
            공개 쇼케이스 제외 자산 {gated.length}건
          </h3>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {gated.map((g, i) => (
              <li key={i}>
                {g.tab} · {g.name} — {rightsLabel(g.state)} ({g.state})
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-ink-3">
            권리 확인 전 자산은 공개 화면에 표시하지 않습니다. 무대의 3D는 가상 데모로
            대체되어 있습니다.
          </p>
        </div>
      )}
    </>
  );
}

function SurfaceChapter({
  representation,
  onRepresentation,
}: {
  representation: string;
  onRepresentation: (r: TabUiState["representation"]) => void;
}) {
  return (
    <>
      <p>
        표면과 거의 평행한 <strong className="text-ink">사광(raking light)</strong>이
        얕은 음각의 그림자를 길게 만들어 획을 드러냅니다. 무대의 조명이 사광 프리셋으로
        전환되어 있습니다.
      </p>
      <div className="flex gap-1">
        <button
          onClick={() => onRepresentation("UNLIT_ORIGINAL")}
          aria-pressed={representation === "UNLIT_ORIGINAL"}
          className={`badge ${representation === "UNLIT_ORIGINAL" ? "badge-demo" : "badge-neutral"}`}
          data-testid="showcase-rep-original"
        >
          원본 시각화
        </button>
        <button
          onClick={() => onRepresentation("PBR_PRESENTATION")}
          aria-pressed={representation === "PBR_PRESENTATION"}
          className={`badge ${representation === "PBR_PRESENTATION" ? "badge-demo" : "badge-neutral"}`}
          data-testid="showcase-rep-enhanced"
        >
          전시 표현 보강
        </button>
      </div>
      <div className="panel p-3 text-xs">
        이 비교는 <strong>복원 전/후가 아닙니다</strong>. 같은 Evidence 기하를 두 가지
        표시 방식으로 렌더한 것이며, 표현 보강은 원본 기하의 측정 정확도를 높이지
        않습니다.
      </div>
    </>
  );
}

function GlyphChapter({ cells, focusId }: { cells: GlyphCell[]; focusId: string }) {
  const cell = cells.find((c) => c.id === focusId);
  if (!cell) return <p>선택 글자 데이터가 없습니다.</p>;
  return (
    <>
      <p>
        카메라가 <strong className="text-ink">{cell.id}</strong> 셀로 다가가면 고해상
        디테일 패치가 스트리밍됩니다. 실선은 <strong>관측된 획</strong>, 점선은 마모로{" "}
        <strong>불확실한 영역</strong>입니다.
      </p>
      <div className="flex items-center gap-3">
        <GlyphPatchSvg cell={cell} size={96} />
        <div className="text-xs">
          <ReadingBadge status={cell.readingStatus} />
          <p className="mt-1">
            관측 획 {cell.strokes ? cell.strokes.polylines.length - cell.strokes.erodedStrokeIndexes.length : 0}
            개 · 마모 획 {cell.strokes?.erodedStrokeIndexes.length ?? 0}개
          </p>
          <p className="mt-1 text-ink-3">확대경(M 키)으로 표면을 더 가까이 볼 수 있습니다.</p>
        </div>
      </div>
    </>
  );
}

function CompareChapter({ details }: { details: TabDetail[] }) {
  const tabIds = details.slice(0, 3).map((d) => d.tab.id);
  const { data } = useQuery({
    queryKey: ["showcase-matrix", tabIds],
    queryFn: () => api.compareGlyphs({ glyphCellIds: [FOCUS_CELL], tabIds }),
    enabled: tabIds.length >= 2,
  });
  const row = data?.rows?.[0];
  return (
    <>
      <p>
        같은 자형이 다른 비석에서 어떻게 나타나는지 나란히 비교합니다 — 시대·서체·문맥이
        다른 <strong className="text-ink">가상 데모 자형</strong>들의 유사도입니다.
      </p>
      {row ? (
        <div className="space-y-2" data-testid="showcase-matrix">
          {row.columns.map((col) => {
            const entry = col.cells[0];
            return (
              <div key={col.tab.id} className="panel flex items-center gap-2 p-2 text-xs">
                <span className="w-28 truncate font-medium text-ink">{col.tab.title}</span>
                {entry?.glyphCell ? (
                  <>
                    <GlyphPatchSvg cell={entry.glyphCell} size={40} />
                    <span>
                      {entry.publishedReading
                        ? `기존 판독 ${entry.publishedReading}`
                        : "판독 없음"}
                    </span>
                    {entry.match && (
                      <span className="text-ink-3">
                        유사도 {entry.match.combinedScore.toFixed(3)}
                      </span>
                    )}
                    <DemoBadge label="가상" />
                  </>
                ) : (
                  <span className="text-ink-3">대응 자형 없음</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-ink-3">비교 매트릭스 불러오는 중…</p>
      )}
    </>
  );
}

function EvidenceChapter({ details }: { details: TabDetail[] }) {
  const cells = details.flatMap((d) => d.glyphCells);
  const byStatus = new Map<string, number>();
  for (const c of cells) byStatus.set(c.readingStatus, (byStatus.get(c.readingStatus) ?? 0) + 1);
  const unknownCell = cells.find((c) => c.id === UNKNOWN_CELL);
  return (
    <>
      <p>
        후보 생성 → 반증 수집 → 인용 검증 → Decision Gate. 근거가 부족하면 결론은{" "}
        <strong className="text-ink">UNKNOWN(미상)</strong>으로 남습니다 — 이 스튜디오가
        지키는 원칙입니다.
      </p>
      <table className="w-full text-xs" data-testid="showcase-status-table">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="py-1">판독 상태</th>
            <th className="py-1 text-right">문자 수</th>
          </tr>
        </thead>
        <tbody>
          {[...byStatus.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([status, n]) => (
              <tr key={status} className="border-t border-line-soft">
                <td className="py-1">
                  <ReadingBadge status={status as GlyphCell["readingStatus"]} />
                </td>
                <td className="py-1 text-right tabular-nums">{n}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {unknownCell && (
        <div className="panel p-3 text-xs" data-testid="showcase-unknown-example">
          <h3 className="font-semibold text-ink">예: {unknownCell.id}</h3>
          <p className="mt-1">
            시각 근거가 약하고 독립 계보가 부족해 <ReadingBadge status={unknownCell.readingStatus} />{" "}
            상태입니다. 연구 작업대에서 분석과 반증 수집 전 과정을 볼 수 있습니다.
          </p>
        </div>
      )}
      <p className="text-[11px] text-ink-3">
        쇼케이스는 저장된 결과를 읽기 전용으로 재구성하며, 새 분석을 생성하지 않습니다.
      </p>
    </>
  );
}
