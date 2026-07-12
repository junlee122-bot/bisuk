"use client";

import { useState } from "react";
import type { TabUiState } from "@seokmun/types";
import type { TabDetail } from "@/lib/api";
import { DemoBadge, RightsBadge } from "@/components/badges";
import { ASSET_MODE_LABEL } from "@/lib/labels";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { Viewer3D } from "@/features/high-fidelity-3d/HybridSteleViewport";
import { FragmentViewer } from "@/components/three/FragmentViewer";
import { SourceCardPanel } from "./SourceCardPanel";

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
  const meshAsset = detail.assets.find(
    (a) => a.assetType === "MESH" && a.format === "PROCEDURAL_MESH"
  );
  const fragmentAssets = detail.assets.filter(
    (a) => a.format === "PROCEDURAL_FRAGMENT"
  );

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
    <div className="flex h-full flex-col" data-testid="workbench">
      <div className="flex items-center gap-1 border-b border-[var(--panel-border)] px-2 py-1 text-xs">
        <button
          onClick={() => setView("work")}
          className={`badge ${view === "work" ? "badge-demo" : "badge-neutral"}`}
          data-testid="workbench-view-work"
        >
          작업대
        </button>
        <button
          onClick={() => setView("sources")}
          className={`badge ${view === "sources" ? "badge-demo" : "badge-neutral"}`}
          data-testid="workbench-view-sources"
        >
          Source Card · 자산
        </button>
        <span className="ml-auto text-ink-3" title={detail.tab.assetMode}>
          자산 모드 {ASSET_MODE_LABEL[detail.tab.assetMode]} ({detail.tab.assetMode})
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{center}</div>
    </div>
  );
}
