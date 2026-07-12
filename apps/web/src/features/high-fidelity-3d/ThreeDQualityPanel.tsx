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
  onClose,
}: {
  asset: SteleAsset;
  representation: TabUiState["representation"];
  lod: TabUiState["lodLevel"];
  tier: string;
  meshInfo: { triangles: number; vertices: number; gpuBytes: number };
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["3d-quality", asset.id] }),
  });

  const meshVariants = report?.variants.filter((v) => v.format === "GLB") ?? [];

  return (
    <aside
      className="absolute right-2 top-2 bottom-2 z-10 w-80 overflow-y-auto rounded border border-[var(--panel-border)] bg-[#191920f2] p-3 text-[11px]"
      data-testid="quality-panel"
      aria-label="3D 품질 패널"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">3D 품질</h3>
        <button onClick={onClose} className="badge badge-neutral">닫기 ✕</button>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-1">
        <dt className="text-neutral-500">현재 표현</dt>
        <dd data-testid="qp-representation">{representation}</dd>
        <dt className="text-neutral-500">원본 유형</dt>
        <dd>{asset.provenance === "VIRTUAL_DEMO" ? "절차 생성 가상" : asset.format}</dd>
        <dt className="text-neutral-500">현재 LOD</dt>
        <dd>{lod}</dd>
        <dt className="text-neutral-500">품질 단계</dt>
        <dd>{tier}</dd>
        <dt className="text-neutral-500">삼각형(베이스)</dt>
        <dd className="tabular-nums" data-testid="qp-triangles">{meshInfo.triangles.toLocaleString()}</dd>
        <dt className="text-neutral-500">정점</dt>
        <dd className="tabular-nums">{meshInfo.vertices.toLocaleString()}</dd>
        <dt className="text-neutral-500">GPU 기하 추정</dt>
        <dd className="tabular-nums">{(meshInfo.gpuBytes / 1048576).toFixed(1)} MB</dd>
        <dt className="text-neutral-500">FPS(최근 1초)</dt>
        <dd className="tabular-nums" data-testid="qp-fps">
          {live ? (live.fps > 0 ? live.fps : "대기(on-demand)") : "—"}
        </dd>
        <dt className="text-neutral-500">draw calls</dt>
        <dd className="tabular-nums">{live?.drawCalls ?? "—"}</dd>
        <dt className="text-neutral-500">GPU geometries</dt>
        <dd className="tabular-nums" data-testid="qp-geometries">{live?.geometries ?? "—"}</dd>
        <dt className="text-neutral-500">스케일 신뢰도</dt>
        <dd>{report?.scaleConfidence ?? "—"}</dd>
        <dt className="text-neutral-500">측정 가능</dt>
        <dd>{representation === "RESEARCH_EVIDENCE" ? "예 (가상 단위)" : "아니오 — 표시 전용"}</dd>
        <dt className="text-neutral-500">생성형 레이어</dt>
        <dd>미사용 (GENERATED_VISUAL_ONLY 없음)</dd>
        <dt className="text-neutral-500">파이프라인</dt>
        <dd>{report?.pipelineVersion ?? "—"}</dd>
      </dl>

      {report && report.diagnostics.length > 0 && (
        <section className="mt-2">
          <h4 className="font-semibold text-amber-200">진단</h4>
          <ul className="mt-1 list-inside list-disc text-neutral-300">
            {report.diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-2">
        <h4 className="font-semibold">파생 자산 (계보)</h4>
        {meshVariants.length === 0 ? (
          <p className="mt-1 text-neutral-500">파생 자산 없음 — 파이프라인을 실행하세요.</p>
        ) : (
          <ul className="mt-1 space-y-1" data-testid="qp-variants">
            {meshVariants.map((v) => (
              <li key={v.id} className="rounded bg-[#26262e] p-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="badge badge-neutral">{v.variantType}</span>
                  <span className={`badge ${v.measurementAllowed ? "badge-ok" : "badge-warn"}`}>
                    {v.measurementAllowed ? "측정 허용" : "표시 전용"}
                  </span>
                  <span className="badge badge-neutral">{v.qualityLevel}</span>
                </div>
                <p className="mt-0.5 text-neutral-400">
                  △{v.triangleCount?.toLocaleString()} · {((v.byteSize ?? 0) / 1024).toFixed(0)}KB
                  {typeof v.metrics.lodSurfaceErrorP95 === "number" &&
                    ` · LOD오차 P95 ${(v.metrics.lodSurfaceErrorP95 as number).toExponential(1)}`}
                </p>
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
          <p className="mt-1 text-red-400">{(upgrade.error as Error).message}</p>
        )}
      </section>

      <section className="mt-2">
        <h4 className="font-semibold">고지</h4>
        <ul className="mt-1 list-inside list-disc text-neutral-500" data-testid="qp-disclaimers">
          {(report?.disclaimers ?? []).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
