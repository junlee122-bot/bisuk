"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { TabUiState } from "@seokmun/types";
import type { TabDetail } from "@/lib/api";
import { DemoBadge, RightsBadge } from "@/components/badges";
import { ASSET_MODE_LABEL } from "@/lib/labels";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { SourceCardPanel } from "./SourceCardPanel";
import { Icon } from "@/components/ui/Icon";

const Viewer3D = dynamic(
  () =>
    import("@/features/high-fidelity-3d/HybridSteleViewport").then(
      (module) => module.Viewer3D
    ),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-ink-2">3D 뷰어 불러오는 중…</div>,
  }
);

const FragmentViewer = dynamic(
  () => import("@/components/three/FragmentViewer").then((module) => module.FragmentViewer),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-ink-2">파편 뷰어 불러오는 중…</div>,
  }
);

function TranscriptionViewer({
  detail,
  selectedId,
  onSelect,
}: {
  detail: TabDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const transcriptionAsset = detail.assets.find((a) => a.assetType === "TRANSCRIPTION");
  const lines = new Map<number, typeof detail.glyphCells>();
  for (const c of detail.glyphCells) {
    const list = lines.get(c.lineIndex) ?? [];
    list.push(c);
    lines.set(c.lineIndex, list);
  }
  return (
    <div className="space-y-3 p-4" data-testid="transcription-viewer">
      {transcriptionAsset && (
        <DemoBadge label={transcriptionAsset.demoLabel ?? "가상 판독문 (DEMO)"} />
      )}
      {[...lines.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([line, cells]) => (
          <div key={line} className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-xs text-ink-3">{line}행</span>
            {cells
              .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
              .map((c) => (
                <button key={c.id} onClick={() => onSelect(c.id)} aria-label={`문자 셀 ${c.id}`}>
                  <GlyphPatchSvg cell={c} size={56} selected={c.id === selectedId} />
                </button>
              ))}
          </div>
        ))}
      {detail.glyphCells.length === 0 && (
        <p className="text-sm text-ink-3">판독문 데이터가 없습니다.</p>
      )}
    </div>
  );
}

function MetadataViewer({ detail }: { detail: TabDetail }) {
  const { tab } = detail;
  return (
    <div className="space-y-3 overflow-y-auto p-4" data-testid="metadata-viewer">
      <div className="flex flex-wrap items-center gap-2">
        <RightsBadge state={tab.rightsState} />
        <span className="badge badge-frontier">{tab.initialStatus}</span>
      </div>
      {tab.preliminaryClaims.length > 0 && (
        <section className="panel p-3">
          <h3 className="text-sm font-semibold">
            1차 판독 주장{" "}
            <span className="badge badge-warn" data-testid="preliminary-badge">
              1차 판독 — 확정 아님
            </span>
          </h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink-2">
            {tab.preliminaryClaims.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      {tab.warnings.length > 0 && (
        <section className="panel border-[#e1d3a6] bg-[#f4edd6] p-3">
          <h3 className="text-sm font-semibold text-[var(--state-warning)]">주의</h3>
          <ul className="mt-1 list-inside list-disc text-sm text-[#6f5b28]">
            {tab.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      {tab.knownFacts.length > 0 && (
        <section className="panel p-3">
          <h3 className="text-sm font-semibold">알려진 사실 (공개 기록)</h3>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-2">
            {tab.knownFacts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}
      {tab.questions.length > 0 && (
        <section className="panel p-3">
          <h3 className="text-sm font-semibold">연구 질문</h3>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-2">
            {tab.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      {tab.restrictions.length > 0 && (
        <section className="panel p-3">
          <h3 className="text-sm font-semibold">운영 제한</h3>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-2">
            {tab.restrictions.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function Workbench({
  detail,
  selectedId,
  onSelect,
  onUiStateChange,
}: {
  detail: TabDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUiStateChange: (patch: Partial<TabUiState>) => void;
}) {
  const [view, setView] = useState<"work" | "sources">("work");
  const meshAsset = detail.assets.find((a) => a.assetType === "MESH");
  const fragmentAssets = detail.assets.filter(
    (a) => a.format === "PROCEDURAL_FRAGMENT"
  );
  const workContext = fragmentAssets.length >= 2
    ? { label: "파편 정합", description: "분리된 파편의 위치와 접합 관계를 비교합니다." }
    : meshAsset
      ? { label: "3D 표면 관찰", description: "조명·시점·표현을 바꿔 표면 흔적을 검토합니다." }
      : detail.glyphCells.length > 0
        ? { label: "판독문 검토", description: "행별 문자 영역과 판독 상태를 확인합니다." }
        : { label: "메타데이터 검토", description: "공개 사실·제한·연구 질문을 확인합니다." };

  let center: React.ReactNode;
  if (view === "sources") {
    center = <SourceCardPanel detail={detail} />;
  } else if (fragmentAssets.length >= 2) {
    center = (
      <FragmentViewer
        tabId={detail.tab.id}
        assets={detail.assets}
        cells={detail.glyphCells}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    );
  } else if (meshAsset) {
    center = (
      <Viewer3D
        asset={meshAsset}
        cells={detail.glyphCells}
        uiState={detail.tab.uiState}
        selectedId={selectedId}
        onSelect={onSelect}
        onUiStateChange={onUiStateChange}
      />
    );
  } else if (detail.glyphCells.length > 0) {
    center = (
      <TranscriptionViewer detail={detail} selectedId={selectedId} onSelect={onSelect} />
    );
  } else {
    center = <MetadataViewer detail={detail} />;
  }

  return (
    <div className="flex h-full flex-col bg-surface" data-testid="workbench">
      <header className="border-b border-line-soft bg-[var(--surface-elevated)] px-3 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="section-label">Step 2 · Observe</p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-sm font-bold">{view === "work" ? workContext.label : "출처·자산 검토"}</h2>
              <p className="text-[11px] text-ink-3">
                {view === "work" ? workContext.description : "원본 파일, 생성 이력, 권리 조건을 확인합니다."}
              </p>
            </div>
          </div>
          <div className="toolbar-group ml-auto shrink-0 text-xs" role="group" aria-label="작업대 보기">
            <button
              onClick={() => setView("work")}
              aria-pressed={view === "work"}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 font-semibold transition ${view === "work" ? "bg-clay text-ink-inverse" : "text-ink-2 hover:bg-surface-muted"}`}
              data-testid="workbench-view-work"
            >
              <Icon name="box" className="h-3.5 w-3.5" /> 관찰
            </button>
            <button
              onClick={() => setView("sources")}
              aria-pressed={view === "sources"}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 font-semibold transition ${view === "sources" ? "bg-clay text-ink-inverse" : "text-ink-2 hover:bg-surface-muted"}`}
              data-testid="workbench-view-sources"
            >
              <Icon name="document" className="h-3.5 w-3.5" /> 출처·자산
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-ink-3">
          <span className="badge badge-neutral" title={detail.tab.assetMode}>
            {ASSET_MODE_LABEL[detail.tab.assetMode]}
          </span>
          <span>선택·카메라·표시 설정은 자동 저장됩니다.</span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{center}</div>
    </div>
  );
}
