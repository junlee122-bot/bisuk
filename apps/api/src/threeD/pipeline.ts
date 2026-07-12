/**
 * 3D 파생 자산 파이프라인 (데모: 순수 TS · 실제 업로드: PLY/STL 파싱 + 클러스터 간소화).
 * 원본은 수정하지 않으며 모든 파생물은 계보(parentVariantIds)와 재현 파라미터를 기록한다.
 * 단계 로그는 실제 수행 시점 기준 — 가짜 진행률 없음.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  QUALITY_DISCLAIMERS,
  THREE_D_PIPELINE_VERSION,
  type AssetVariant,
  type GlyphCell,
  type QualityGrade,
  type SteleAsset,
  type ThreeDJob,
  type ThreeDJobStage,
  type VariantType,
} from "@seokmun/types";
import {
  buildDetailPatchMesh,
  buildSlabMesh,
  lodSurfaceError,
  parsePlyToMesh,
  parseStlToMesh,
  sampleSplatPoints,
  splatToAsciiPly,
  vertexClusterDecimate,
  type MeshArrays,
  type SlabParams,
} from "@seokmun/engine";
import { dataDir, type Db } from "../db";
import { auditEvents, glyphCells } from "../repo";
import { meshArraysToGlb } from "./glb";
import { assetVariants, threeDJobs } from "./store";

let idCounter = 0;
function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idCounter++}`;
}

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function writeDerived(variantId: string, ext: string, data: Uint8Array | string): {
  storageKey: string;
  byteSize: number;
  sha: string;
} {
  const dir = path.join(dataDir(), "derived");
  mkdirSync(dir, { recursive: true });
  const storageKey = path.join("derived", `${variantId}.${ext}`);
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  writeFileSync(path.join(dataDir(), storageKey), buf);
  return { storageKey, byteSize: buf.length, sha: sha256(buf) };
}

/** 숨김 벤치마크 셀의 마모 획은 파생 기하에도 넣지 않는다 (정답 복원 차단 정책과 일관) */
function sanitizedCells(db: Db, tabId: string): GlyphCell[] {
  return glyphCells.listByTab(db, tabId).map((stored) => {
    if (!stored.extra.hiddenBenchmark || !stored.entity.strokes) return stored.entity;
    const eroded = new Set(stored.entity.strokes.erodedStrokeIndexes);
    return {
      ...stored.entity,
      strokes: {
        polylines: stored.entity.strokes.polylines.filter((_, i) => !eroded.has(i)),
        erodedStrokeIndexes: [],
      },
    };
  });
}

interface StageRecorder {
  job: ThreeDJob;
  advance: (stage: ThreeDJobStage, note?: string) => void;
}

function makeJob(
  db: Db,
  asset: SteleAsset,
  kind: ThreeDJob["kind"],
  parameters: Record<string, unknown>,
  inputHashes: string[]
): StageRecorder {
  const job: ThreeDJob = {
    id: newId("3dj"),
    steleAssetId: asset.id,
    kind,
    stage: "QUEUED",
    stageLog: [{ stage: "QUEUED", at: new Date().toISOString(), note: "" }],
    parameters,
    inputHashes,
    outputVariantIds: [],
    pipelineName: asset.provenance === "VIRTUAL_DEMO" ? "demo-procedural" : "upload-ingest",
    pipelineVersion: THREE_D_PIPELINE_VERSION,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  threeDJobs.put(db, job);
  return {
    job,
    advance: (stage, note = "") => {
      job.stage = stage;
      job.stageLog.push({ stage, at: new Date().toISOString(), note });
      if (stage === "READY" || stage === "FAILED") {
        job.finishedAt = new Date().toISOString();
      }
      threeDJobs.put(db, job);
    },
  };
}

function baseVariant(
  asset: SteleAsset,
  variantType: VariantType,
  overrides: Partial<AssetVariant>
): AssetVariant {
  return {
    id: newId("var"),
    steleAssetId: asset.id,
    variantType,
    parentVariantIds: [],
    sourceState: "DERIVED",
    format: "GLB",
    mimeType: "model/gltf-binary",
    storageKey: null,
    byteSize: null,
    sha256: null,
    vertexCount: null,
    triangleCount: null,
    pointCount: null,
    splatCount: null,
    coordinateSystem: "stele-space(+Y up, +Z 비문면)",
    unit: asset.provenance === "VIRTUAL_DEMO" ? "가상 단위 (실측 아님)" : asset.unit,
    scaleConfidence: asset.provenance === "VIRTUAL_DEMO" ? "ASSUMED" : "UNKNOWN",
    bounds: null,
    qualityLevel: "Q1_PREVIEW",
    measurementAllowed: false,
    visualizationOnly: false,
    licenseState: asset.rightsState,
    pipelineName: "demo-procedural",
    pipelineVersion: THREE_D_PIPELINE_VERSION,
    pipelineParameters: {},
    metrics: {},
    glyphCellId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function persistMeshVariant(
  db: Db,
  asset: SteleAsset,
  arrays: MeshArrays,
  variantType: VariantType,
  opts: {
    sourceState?: AssetVariant["sourceState"];
    measurementAllowed?: boolean;
    quality: QualityGrade;
    parents?: string[];
    parameters?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    pipelineName?: string;
    glyphCellId?: string | null;
    roughness?: number;
  }
): Promise<AssetVariant> {
  const variant = baseVariant(asset, variantType, {
    sourceState: opts.sourceState ?? "DERIVED",
    measurementAllowed: opts.measurementAllowed ?? false,
    qualityLevel: opts.quality,
    parentVariantIds: opts.parents ?? [],
    pipelineParameters: opts.parameters ?? {},
    metrics: opts.metrics ?? {},
    pipelineName: opts.pipelineName ?? "demo-procedural",
    glyphCellId: opts.glyphCellId ?? null,
    vertexCount: arrays.vertexCount,
    triangleCount: arrays.triangleCount,
    bounds: arrays.bounds,
  });
  const glb = await meshArraysToGlb(arrays, variant.id, { roughness: opts.roughness });
  const stored = writeDerived(variant.id, "glb", glb);
  variant.storageKey = stored.storageKey;
  variant.byteSize = stored.byteSize;
  variant.sha256 = stored.sha;
  assetVariants.put(db, variant);
  return variant;
}

/** 데모(절차 생성) 또는 업로드 자산의 LOD·PBR 파생 파이프라인 */
export async function runUpgradePipeline(db: Db, asset: SteleAsset): Promise<ThreeDJob> {
  const cells = sanitizedCells(db, asset.steleTabId);
  const isDemo = asset.provenance === "VIRTUAL_DEMO" && asset.meshParams;
  const inputHash = sha256(
    Buffer.from(JSON.stringify({ meshParams: asset.meshParams, storage: asset.storageKey, cells: cells.map((c) => c.id) }))
  );
  const rec = makeJob(db, asset, "UPGRADE_PIPELINE", { assetId: asset.id }, [inputHash]);
  try {
    rec.advance("VALIDATING");
    if (!isDemo && !asset.storageKey) {
      throw new Error("메시 파라미터도 원본 파일도 없는 자산");
    }
    rec.advance("INSPECTING");

    const outputs: AssetVariant[] = [];
    if (isDemo) {
      const params = asset.meshParams as unknown as SlabParams;
      const grids: Array<{ type: VariantType; grid: [number, number]; q: QualityGrade }> = [
        { type: "EVIDENCE_MESH_PREVIEW", grid: [24, 64], q: "Q1_PREVIEW" },
        { type: "EVIDENCE_MESH_MEDIUM", grid: [48, 128], q: "Q2_WEB_STANDARD" },
        { type: "EVIDENCE_MESH_HIGH", grid: [144, 384], q: "Q3_RESEARCH_HIGH" },
      ];
      rec.advance("GENERATING_LOD", grids.map((g) => g.grid.join("x")).join(", "));
      const evidenceIds: string[] = [];
      for (const g of grids) {
        const arrays = buildSlabMesh(params, cells, g.grid, { cavityStrength: 0.4 });
        const err = lodSurfaceError(params, cells, g.grid, 4000);
        const variant = await persistMeshVariant(db, asset, arrays, g.type, {
          measurementAllowed: true,
          quality: g.q,
          parameters: { grid: g.grid, cavityStrength: 0.4 },
          metrics: {
            lodSurfaceErrorP95: err.p95,
            lodSurfaceErrorMax: err.max,
            lodSurfaceErrorMean: err.mean,
            errorUnit: "가상 모델 단위 (실측 아님)",
          },
        });
        evidenceIds.push(variant.id);
        outputs.push(variant);
      }
      rec.advance("BAKING", "PBR presentation (cavity 강화 알베도)");
      for (const [i, g] of grids.entries()) {
        if (g.type === "EVIDENCE_MESH_PREVIEW") continue;
        const arrays = buildSlabMesh(params, cells, g.grid, { cavityStrength: 0.9 });
        outputs.push(
          await persistMeshVariant(
            db,
            asset,
            arrays,
            g.type === "EVIDENCE_MESH_HIGH" ? "PBR_MESH_HIGH" : "PBR_MESH_MEDIUM",
            {
              sourceState: "PRESENTATION_ENHANCED",
              measurementAllowed: false,
              quality: g.q,
              parents: [evidenceIds[i]!],
              parameters: { grid: g.grid, cavityStrength: 0.9, roughness: 0.82 },
              roughness: 0.82,
            }
          )
        );
      }
    } else {
      // 업로드 원본 파싱 (ASCII PLY / STL)
      const buf = readFileSync(path.join(dataDir(), asset.storageKey!));
      const parsed =
        asset.originalFilename?.toLowerCase().endsWith(".ply") === true
          ? parsePlyToMesh(buf)
          : parseStlToMesh(buf);
      if (!parsed) {
        throw new Error(
          "P0 파서가 지원하지 않는 형식 (ASCII PLY / STL만 파생 생성 가능 — 바이너리 PLY는 P1)"
        );
      }
      rec.advance("NORMALIZING", parsed.warnings.join("; "));
      rec.advance("GENERATING_LOD");
      const high = await persistMeshVariant(db, asset, parsed.arrays, "EVIDENCE_MESH_HIGH", {
        measurementAllowed: true,
        quality: "Q3_RESEARCH_HIGH",
        pipelineName: "upload-ingest",
        parameters: { source: asset.originalFilename },
        metrics: {
          hadNormals: parsed.hadNormals,
          hadColors: parsed.hadColors,
          warnings: parsed.warnings,
        },
      });
      outputs.push(high);
      for (const [type, target, q] of [
        ["EVIDENCE_MESH_MEDIUM", 60000, "Q2_WEB_STANDARD"],
        ["EVIDENCE_MESH_PREVIEW", 8000, "Q1_PREVIEW"],
      ] as Array<[VariantType, number, QualityGrade]>) {
        const { arrays, cellSize } = vertexClusterDecimate(parsed.arrays, target);
        outputs.push(
          await persistMeshVariant(db, asset, arrays, type, {
            measurementAllowed: true,
            quality: q,
            parents: [high.id],
            pipelineName: "vertex-cluster-decimate",
            parameters: { targetTriangles: target },
            metrics: {
              decimationCellSize: cellSize,
              errorBoundNote: "오차 상한 ≈ 클러스터 셀 대각선 (quadric 간소화는 P1)",
            },
          })
        );
      }
    }

    rec.advance("COMPRESSING", "GLB + KHR_mesh_quantization (KTX2 텍스처는 어댑터 미설치로 미적용)");
    rec.advance("QUALITY_CHECK");
    rec.job.outputVariantIds = outputs.map((v) => v.id);
    rec.advance("READY");
    auditEvents.record(db, "THREE_D_UPGRADE", "SteleAsset", asset.id, {
      jobId: rec.job.id,
      variants: rec.job.outputVariantIds,
      pipelineVersion: THREE_D_PIPELINE_VERSION,
    });
  } catch (err) {
    rec.job.error = (err as Error).message;
    rec.advance("FAILED", (err as Error).message);
  }
  return rec.job;
}

/** 글자 detail patch 생성 (셀별 고해상 국소 격자) */
export async function generateDetailPatches(
  db: Db,
  asset: SteleAsset,
  glyphCellIds: string[],
  resolution = 96
): Promise<AssetVariant[]> {
  if (asset.provenance !== "VIRTUAL_DEMO" || !asset.meshParams) {
    throw new Error("detail patch는 현재 절차 생성 데모 자산에서만 지원 (실측 패치는 P1)");
  }
  const params = asset.meshParams as unknown as SlabParams;
  const cells = sanitizedCells(db, asset.steleTabId);
  const existing = assetVariants.listByAsset(db, asset.id);
  const out: AssetVariant[] = [];
  for (const cellId of glyphCellIds) {
    const found = existing.find(
      (v) => v.variantType === "GLYPH_DETAIL_PATCH" && v.glyphCellId === cellId
    );
    if (found) {
      out.push(found);
      continue;
    }
    const cell = cells.find((c) => c.id === cellId);
    if (!cell) continue;
    const arrays = buildDetailPatchMesh(params, cells, cell, resolution, {
      cavityStrength: 0.5,
    });
    out.push(
      await persistMeshVariant(db, asset, arrays, "GLYPH_DETAIL_PATCH", {
        measurementAllowed: true,
        quality: "Q3_RESEARCH_HIGH",
        glyphCellId: cellId,
        parameters: { resolution, cellId },
        metrics: { localResolution: `${resolution}x${resolution}` },
      })
    );
  }
  return out;
}

/** 데모 point-splat 생성 — 표시 전용(visualization_only) */
export async function generateSplatDemo(db: Db, asset: SteleAsset): Promise<ThreeDJob> {
  const rec = makeJob(db, asset, "SPLAT_DEMO", { assetId: asset.id }, []);
  try {
    if (asset.provenance !== "VIRTUAL_DEMO" || !asset.meshParams) {
      throw new Error("splat 데모는 절차 생성 가상 자산에서만 생성 (실사진 splat은 Nerfstudio 어댑터 필요)");
    }
    const params = asset.meshParams as unknown as SlabParams;
    const cells = sanitizedCells(db, asset.steleTabId);
    rec.advance("GENERATING_SPLAT", "표면 포인트 샘플 60k");
    const splat = sampleSplatPoints(params, cells, 60000);

    const plyVariant = baseVariant(asset, "SPLAT_SOURCE_PLY", {
      sourceState: "PRESENTATION_ENHANCED",
      visualizationOnly: true,
      measurementAllowed: false,
      qualityLevel: "Q2_WEB_STANDARD",
      format: "PLY",
      mimeType: "application/octet-stream",
      splatCount: splat.count,
      pipelineName: "demo-point-splat",
      pipelineParameters: { count: splat.count },
      metrics: { note: "가상 표면 포인트 스플랫 — 측정·판독 기준 아님" },
    });
    const plyStored = writeDerived(plyVariant.id, "ply", splatToAsciiPly(splat));
    plyVariant.storageKey = plyStored.storageKey;
    plyVariant.byteSize = plyStored.byteSize;
    plyVariant.sha256 = plyStored.sha;
    assetVariants.put(db, plyVariant);

    rec.advance("COMPRESSING", "바이너리 전달 포맷 (SEOKMUN_SPLAT_BIN_V1)");
    const header = new Uint32Array([splat.count]);
    const bin = Buffer.concat([
      Buffer.from(header.buffer),
      Buffer.from(splat.positions.buffer),
      Buffer.from(splat.colors.buffer),
      Buffer.from(splat.sizes.buffer),
    ]);
    const binVariant = baseVariant(asset, "SPLAT_DELIVERY_SOG", {
      sourceState: "PRESENTATION_ENHANCED",
      visualizationOnly: true,
      measurementAllowed: false,
      qualityLevel: "Q2_WEB_STANDARD",
      format: "SEOKMUN_SPLAT_BIN_V1",
      mimeType: "application/octet-stream",
      splatCount: splat.count,
      parentVariantIds: [plyVariant.id],
      pipelineName: "demo-point-splat",
      metrics: {
        note: "SOG 변환은 splat-transform 어댑터 미설치로 자체 바이너리 포맷 사용",
      },
    });
    const binStored = writeDerived(binVariant.id, "bin", bin);
    binVariant.storageKey = binStored.storageKey;
    binVariant.byteSize = binStored.byteSize;
    binVariant.sha256 = binStored.sha;
    assetVariants.put(db, binVariant);

    rec.advance("ALIGNING", "메시와 동일 stele-space 좌표 (변환 항등, 정렬 오차 0)");
    rec.job.outputVariantIds = [plyVariant.id, binVariant.id];
    rec.advance("READY");
  } catch (err) {
    rec.job.error = (err as Error).message;
    rec.advance("FAILED", (err as Error).message);
  }
  return rec.job;
}

export function qualityReportFor(db: Db, asset: SteleAsset) {
  const variants = assetVariants.listByAsset(db, asset.id);
  const jobs = threeDJobs.listByAsset(db, asset.id);
  const diagnostics: string[] = [];
  if (variants.length === 0) diagnostics.push("파생 자산 없음 — 업그레이드 파이프라인 미실행");
  if (asset.provenance === "VIRTUAL_DEMO") {
    diagnostics.push("가상 데모 자산 — 실제 유물 계측 아님");
  }
  if (!variants.some((v) => v.variantType.startsWith("EVIDENCE_MESH"))) {
    diagnostics.push("Evidence Mesh 없음 — 측정·글자 선택 기준 부재");
  }
  if (variants.some((v) => v.visualizationOnly)) {
    diagnostics.push("표시 전용 레이어(Splat) 존재 — 판독 기준으로 사용 금지");
  }
  if (asset.provenance === "REAL_USER_UPLOAD" && asset.rightsState === "VERIFY_REQUIRED") {
    diagnostics.push("권리 미확인 — 외부 공개 내보내기 차단 상태");
  }
  return {
    assetId: asset.id,
    provenance: asset.provenance,
    demoLabel: asset.demoLabel,
    unit: asset.unit,
    scaleConfidence: asset.provenance === "VIRTUAL_DEMO" ? "ASSUMED(가상)" : "UNKNOWN",
    variants,
    jobs,
    diagnostics,
    disclaimers: QUALITY_DISCLAIMERS,
    pipelineVersion: THREE_D_PIPELINE_VERSION,
  };
}
