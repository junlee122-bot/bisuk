"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssetVariant, SteleAsset, TabUiState } from "@seokmun/types";

interface QualityReport {
  variants: AssetVariant[];
  jobs: Array<{ id: string; kind: string; stage: string; pipelineVersion: string }>;
  diagnostics: string[];
  disclaimers: readonly string[];
  pipelineVersion: string;
  unit: string | null;
  scaleConfidence: string;
}

async function fetchReport(assetId: string): Promise<QualityReport> {
  const res = await fetch(`/api/3d/assets/${assetId}/quality-report`);
  if (!res.ok) throw new Error(`품질 보고서 로딩 실패 (${res.status})`);
  return (await res.json()) as QualityReport;
}

/** 3D 품질 패널 — 실측 수치·진단·고지문·파생 파이프라인 실행 (§12) */
export function ThreeDQualityPanel({
  asset,
  representation,
  lod,
  tier,
  meshInfo,
  measurementAllowed,
  activeVariantId,
  onActivateVariant,
  onClose,
}: {
  asset: SteleAsset;
  representation: TabUiState["representation"];
  lod: TabUiState["lodLevel"];
  tier: string;
  meshInfo: { triangles: number; vertices: number; gpuBytes: number };
  measurementAllowed: boolean;
  activeVariantId: string | null;
  onActivateVariant: (variant: AssetVariant) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [live, setLive] = useState<Window["__seokmunStats"] | null>(null);
  const { data: report } = useQuery({
    queryKey: ["3d-quality", asset.id],
    queryFn: () => fetchReport(asset.id),
  });

  useEffect(() => {
    const t = setInterval(() => setLive(window.__seokmunStats ?? null), 1000);
    return () => clearInterval(t);
  }, []);

  const upgrade = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/3d/assets/${asset.id}/upgrade`, { method: "POST" });
      if (!res.ok) throw new Error(`파이프라인 실패 (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["3d-quality", asset.id] });
      void qc.invalidateQueries({ queryKey: ["3d-variants", asset.id] });
    },
  });

  const activate = useMutation({
    mutationFn: async (variant: AssetVariant) => {
      const res = await fetch(`/api/3d/assets/${asset.id}/variants/${variant.id}/activate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`variant 활성화 실패 (${res.status})`);
      await res.json();
      return variant;
    },
    onSuccess: (variant) => {
      onActivateVariant(variant);
      void qc.invalidateQueries({ queryKey: ["tab", asset.steleTabId] });
    },
  });

  const meshVariants = report?.variants.filter((v) => v.format === "GLB") ?? [];

  return (
    <aside
      className="absolute inset-y-2 right-2 z-20 w-[min(22rem,calc(100%-1rem))] overflow-y-auto rounded-xl border border-line-soft bg-[var(--surface-elevated)] p-4 text-[11px] shadow-[var(--shadow-md)] backdrop-blur-xl"
      data-testid="quality-panel"
      aria-label="3D 품질 패널"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line-soft pb-3">
        <div>
          <p className="section-label">Technical report</p>
          <h3 className="mt-0.5 text-base font-bold">3D 품질·계보</h3>
          <p className="mt-1 text-[10px] leading-4 text-ink-3">현재 렌더 상태와 파생 자산의 측정 적합성을 확인합니다.</p>
        </div>
        <button onClick={onClose} className="ui-button ui-button-ghost min-h-8 px-2 py-1" aria-label="3D 품질 패널 닫기">닫기 ✕</button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-surface-2 p-3">
        <dt className="text-ink-3">현재 표현</dt>
        <dd data-testid="qp-representation">{representation}</dd>
        <dt className="text-ink-3">원본 유형</dt>
        <dd>{asset.provenance === "VIRTUAL_DEMO" ? "절차 생성 가상" : asset.format}</dd>
        <dt className="text-ink-3">현재 LOD</dt>
        <dd>{lod}</dd>
        <dt className="text-ink-3">품질 단계</dt>
        <dd>{tier}</dd>
        <dt className="text-ink-3">삼각형(베이스)</dt>
        <dd className="tabular-nums" data-testid="qp-triangles">{meshInfo.triangles.toLocaleString()}</dd>
        <dt className="text-ink-3">정점</dt>
        <dd className="tabular-nums">{meshInfo.vertices.toLocaleString()}</dd>
        <dt className="text-ink-3">GPU 기하 추정</dt>
        <dd className="tabular-nums">{(meshInfo.gpuBytes / 1048576).toFixed(1)} MB</dd>
        <dt className="text-ink-3">FPS(최근 1초)</dt>
        <dd className="tabular-nums" data-testid="qp-fps">
          {live ? (live.fps > 0 ? live.fps : "대기(on-demand)") : "—"}
        </dd>
        <dt className="text-ink-3">draw calls</dt>
        <dd className="tabular-nums">{live?.drawCalls ?? "—"}</dd>
        <dt className="text-ink-3">GPU geometries</dt>
        <dd className="tabular-nums" data-testid="qp-geometries">{live?.geometries ?? "—"}</dd>
        <dt className="text-ink-3">스케일 신뢰도</dt>
        <dd>{report?.scaleConfidence ?? "—"}</dd>
        <dt className="text-ink-3">측정 가능</dt>
        <dd>{measurementAllowed ? "예 (자산 단위)" : "아니오 — 표시 전용"}</dd>
        <dt className="text-ink-3">생성형 레이어</dt>
        <dd>미사용 (GENERATED_VISUAL_ONLY 없음)</dd>
        <dt className="text-ink-3">파이프라인</dt>
        <dd>{report?.pipelineVersion ?? "—"}</dd>
      </dl>

      {report && report.diagnostics.length > 0 && (
        <section className="mt-4 rounded-lg border border-[#e1d3a6] bg-[#f4edd6] p-3">
          <h4 className="font-semibold text-[var(--state-warning)]">품질 진단</h4>
          <ul className="mt-1 list-inside list-disc text-ink-2">
            {report.diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4 border-t border-line-soft pt-3">
        <h4 className="font-semibold">파생 자산 계보</h4>
        {meshVariants.length === 0 ? (
          <p className="mt-1 text-ink-3">파생 자산 없음 — 파이프라인을 실행하세요.</p>
        ) : (
          <ul className="mt-1 space-y-1" data-testid="qp-variants">
            {meshVariants.map((v) => (
              <li key={v.id} className="rounded bg-surface-2 p-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="badge badge-neutral">{v.variantType}</span>
                  {activeVariantId === v.id && <span className="badge badge-ok">현재 활성</span>}
                  <span className={`badge ${v.measurementAllowed ? "badge-ok" : "badge-warn"}`}>
                    {v.measurementAllowed ? "측정 허용" : "표시 전용"}
                  </span>
                  <span className="badge badge-neutral">{v.qualityLevel}</span>
                </div>
                <p className="mt-0.5 text-ink-2">
                  △{v.triangleCount?.toLocaleString()} · {((v.byteSize ?? 0) / 1024).toFixed(0)}KB
                  {typeof v.metrics.lodSurfaceErrorP95 === "number" &&
                    ` · LOD오차 P95 ${(v.metrics.lodSurfaceErrorP95 as number).toExponential(1)}`}
                </p>
                {v.glyphCellId === null && v.variantType !== "COLLISION_PROXY" && (
                  <button
                    type="button"
                    onClick={() => activate.mutate(v)}
                    disabled={activate.isPending || activeVariantId === v.id}
                    className="badge badge-neutral mt-1 disabled:opacity-40"
                    data-testid={`activate-variant-${v.id}`}
                  >
                    {activate.isPending && activate.variables?.id === v.id
                      ? "적용 중…"
                      : activeVariantId === v.id
                        ? "사용 중"
                        : "이 GLB 사용"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => upgrade.mutate()}
          disabled={upgrade.isPending}
          className="badge badge-demo mt-2 disabled:opacity-40"
          data-testid="run-pipeline"
        >
          {upgrade.isPending ? "파이프라인 실행 중…" : "파생 파이프라인 실행 (LOD·GLB)"}
        </button>
        {upgrade.isError && (
          <p className="mt-1 text-[var(--state-danger)]">{(upgrade.error as Error).message}</p>
        )}
        {activate.isError && (
          <p className="mt-1 text-[var(--state-danger)]">{(activate.error as Error).message}</p>
        )}
      </section>

      <section className="mt-4 border-t border-line-soft pt-3">
        <h4 className="font-semibold">해석·측정 고지</h4>
        <ul className="mt-1 list-inside list-disc text-ink-3" data-testid="qp-disclaimers">
          {(report?.disclaimers ?? []).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
