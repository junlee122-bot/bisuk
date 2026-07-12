"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SteleAsset } from "@seokmun/types";
import { api, type TabDetail } from "@/lib/api";
import { DemoBadge, RightsBadge } from "@/components/badges";

function LicenseForm({ asset, onDone }: { asset: SteleAsset; onDone: () => void }) {
  const [licenseType, setLicenseType] = useState("KOGL_TYPE_1");
  const [rightsState, setRightsState] = useState("ATTRIBUTION_REQUIRED");
  const [verifiedBy, setVerifiedBy] = useState("demo-admin");
  const mutation = useMutation({
    mutationFn: () =>
      api.setLicense(asset.id, { licenseType, rightsState, verifiedBy }),
    onSuccess: onDone,
  });
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      data-testid={`license-form-${asset.id}`}
    >
      <select
        value={licenseType}
        onChange={(e) => setLicenseType(e.target.value)}
        className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1"
        aria-label="공공누리 유형"
      >
        <option value="KOGL_TYPE_1">공공누리 1유형</option>
        <option value="KOGL_TYPE_2">공공누리 2유형</option>
        <option value="KOGL_TYPE_3">공공누리 3유형</option>
        <option value="KOGL_TYPE_4">공공누리 4유형</option>
        <option value="CUSTOM">개별 조건</option>
      </select>
      <select
        value={rightsState}
        onChange={(e) => setRightsState(e.target.value)}
        className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1"
        aria-label="권리 상태"
      >
        <option value="ATTRIBUTION_REQUIRED">출처표시 후 이용 가능</option>
        <option value="RESEARCH_ONLY">연구 목적 한정</option>
        <option value="NONCOMMERCIAL">비상업 한정</option>
        <option value="DERIVATIVES_PROHIBITED">변경 금지</option>
        <option value="OPEN_FOR_REUSE">자유 이용</option>
      </select>
      <input
        value={verifiedBy}
        onChange={(e) => setVerifiedBy(e.target.value)}
        className="w-28 rounded border border-[var(--panel-border)] bg-transparent px-2 py-1"
        aria-label="확인자"
      />
      <button type="submit" className="badge badge-ok" disabled={mutation.isPending}>
        권리 확인 저장
      </button>
    </form>
  );
}

export function SourceCardPanel({ detail }: { detail: TabDetail }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [purpose, setPurpose] = useState("판독 연구 (개인 검토용)");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { data: maturity } = useQuery({
    queryKey: ["maturity", detail.tab.id],
    queryFn: () => api.getMaturity(detail.tab.id),
  });
  const officialSources = detail.sourceRecords;
  const canImport = officialSources.some((s) => s.type === "OFFICIAL_3D_INDEX");
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("파일을 선택하세요");
      return api.uploadAsset(detail.tab.id, file, purpose, officialSources[0]?.id ?? null);
    },
    onSuccess: () => {
      setFile(null);
      setUploadError(null);
      void qc.invalidateQueries({ queryKey: ["tab", detail.tab.id] });
    },
    onError: (e) => setUploadError((e as Error).message),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["tab", detail.tab.id] });

  return (
    <div className="space-y-3 overflow-y-auto p-3" data-testid="source-card-panel">
      <section className="panel p-3">
        <h3 className="text-sm font-semibold">공식 Source Card</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          앱은 원본 파일을 자동 수집하지 않습니다. 공식 출처의 이용 조건을 확인한 뒤
          직접 내려받은 파일만 등록하세요.
        </p>
        <ul className="mt-2 space-y-2">
          {officialSources.map((s) => (
            <li key={s.id} className="panel p-2 text-xs" data-testid={`source-${s.id}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="badge badge-neutral">{s.type}</span>
                <strong>{s.publisher}</strong>
                <RightsBadge state={s.rightsState} />
                <span className="badge badge-neutral">신뢰 계층 {s.reliabilityTier}</span>
              </div>
              {s.expectedFormats.length > 0 && (
                <p className="mt-1 text-ink-2">
                  공식 형식: {s.expectedFormats.join(", ")}
                </p>
              )}
              <p className="mt-1 text-ink-3">{s.notes}</p>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block break-all text-[11px] text-[var(--state-info)] underline decoration-dotted"
              >
                {s.url}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {maturity?.scores && (
        <section className="panel p-3">
          <h3 className="text-sm font-semibold">
            연구 성숙도{" "}
            <span className="text-[var(--accent)]">{maturity.total}</span>/100
            {maturity.frontierIndex !== null && (
              <span className="badge badge-frontier ml-2">
                Frontier Index {maturity.frontierIndex}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-3">{maturity.note}</p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-3">
            {Object.entries(maturity.scores).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 rounded bg-surface-2 px-2 py-1">
                <span className="text-ink-2">{k.replace("Score", "")}</span>
                <span className="tabular-nums">{v}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {canImport && (
        <section className="panel p-3" data-testid="importer">
          <h3 className="text-sm font-semibold">3D 파일 수동 등록 (PLY·STL·ASC)</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            등록 즉시 체크섬·품질 보고서가 생성되며, 공공누리 유형 확인 전에는{" "}
            <span className="text-[var(--state-danger)]">권리 확인 필요</span> 상태로 외부 공개
            내보내기가 차단됩니다.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <input
              type="file"
              accept=".ply,.stl,.asc,.xyz,.obj"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="upload-input"
              aria-label="3D 파일 선택"
            />
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="min-w-48 flex-1 rounded border border-[var(--panel-border)] bg-transparent px-2 py-1"
              aria-label="사용 목적"
              placeholder="사용 목적"
            />
            <button
              onClick={() => uploadMutation.mutate()}
              disabled={!file || uploadMutation.isPending}
              className="badge badge-demo disabled:opacity-40"
              data-testid="upload-button"
            >
              {uploadMutation.isPending ? "등록 중…" : "원본 보존 등록"}
            </button>
          </div>
          {uploadError && <p className="mt-1 text-xs text-[var(--state-danger)]">{uploadError}</p>}
        </section>
      )}

      <section className="panel p-3">
        <h3 className="text-sm font-semibold">등록 자산</h3>
        <ul className="mt-2 space-y-2">
          {detail.assets.map((a) => (
            <li key={a.id} className="panel p-2 text-xs" data-testid={`asset-${a.id}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="badge badge-neutral">{a.assetType}</span>
                {a.provenance === "VIRTUAL_DEMO" ? (
                  <DemoBadge label={a.demoLabel ?? "가상 데모"} />
                ) : (
                  <strong>{a.originalFilename}</strong>
                )}
                <RightsBadge state={a.rightsState} />
                {a.licenseType && (
                  <span className="badge badge-ok">라이선스 {a.licenseType}</span>
                )}
              </div>
              {a.checksumSha256 && (
                <p className="mt-1 break-all text-[10px] text-ink-3">
                  sha256 {a.checksumSha256}
                </p>
              )}
              {a.qualityReport && (
                <div className="mt-1 text-ink-2">
                  <span className="mr-2">형식 {a.qualityReport.format}</span>
                  {a.qualityReport.vertexCount !== null && (
                    <span className="mr-2">정점 {a.qualityReport.vertexCount}</span>
                  )}
                  {a.qualityReport.triangleCount !== null && (
                    <span className="mr-2">삼각형 {a.qualityReport.triangleCount}</span>
                  )}
                  {a.qualityReport.pointCount !== null && (
                    <span className="mr-2">점 {a.qualityReport.pointCount}</span>
                  )}
                  {a.qualityReport.unitGuess && (
                    <span className="mr-2">단위 {a.qualityReport.unitGuess}</span>
                  )}
                  {a.qualityReport.warnings.map((w) => (
                    <p key={w} className="text-[var(--state-warning)]">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}
              {a.provenance === "REAL_USER_UPLOAD" && a.rightsState === "VERIFY_REQUIRED" && (
                <LicenseForm asset={a} onDone={refresh} />
              )}
            </li>
          ))}
          {detail.assets.length === 0 && (
            <li className="text-xs text-ink-3">등록된 자산 없음</li>
          )}
        </ul>
      </section>
    </div>
  );
}
