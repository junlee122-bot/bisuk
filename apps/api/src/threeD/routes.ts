import type { FastifyInstance } from "fastify";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CameraBookmark,
  CameraBookmarkCreate,
  QUALITY_DISCLAIMERS,
  SceneLook,
  SceneLookCreate,
  THREE_D_PIPELINE_VERSION,
} from "@seokmun/types";
import { dataDir, type Db } from "../db";
import { auditEvents, steleAssets, steleTabs } from "../repo";
import { listAdapters, validateAdapter } from "./adapters";
import {
  generateDetailPatches,
  generateSplatDemo,
  qualityReportFor,
  runUpgradePipeline,
} from "./pipeline";
import { assetVariants, cameraBookmarks, renderPresets, sceneLooks, threeDJobs } from "./store";

const MIME_BY_FORMAT: Record<string, string> = {
  GLB: "model/gltf-binary",
  PLY: "application/octet-stream",
  SEOKMUN_SPLAT_BIN_V1: "application/octet-stream",
  PNG: "image/png",
};

export function registerThreeDRoutes(app: FastifyInstance, db: Db): void {
  const notFound = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }, what: string) =>
    reply.status(404).send({ error: "NOT_FOUND", message: `${what}을(를) 찾을 수 없습니다` });

  // ── 자산 감사·업그레이드·variants ──
  app.post("/api/3d/assets/:assetId/audit", async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    const asset = steleAssets.get(db, assetId);
    if (!asset) return notFound(reply, "자산");
    return qualityReportFor(db, asset);
  });

  app.get("/api/3d/assets/:assetId/quality-report", async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    const asset = steleAssets.get(db, assetId);
    if (!asset) return notFound(reply, "자산");
    return qualityReportFor(db, asset);
  });

  app.post("/api/3d/assets/:assetId/upgrade", async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    const asset = steleAssets.get(db, assetId);
    if (!asset) return notFound(reply, "자산");
    if (asset.assetType !== "MESH" && asset.assetType !== "POINT_CLOUD") {
      return reply.status(400).send({
        error: "NOT_A_MESH",
        message: "3D 업그레이드는 메시/점군 자산에만 적용됩니다",
      });
    }
    const job = await runUpgradePipeline(db, asset);
    return reply.status(job.stage === "READY" ? 201 : 500).send(job);
  });

  app.get("/api/3d/assets/:assetId/variants", async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    const asset = steleAssets.get(db, assetId);
    if (!asset) return notFound(reply, "자산");
    return assetVariants.listByAsset(db, assetId);
  });

  app.post("/api/3d/assets/:assetId/variants/:variantId/activate", async (req, reply) => {
    const { assetId, variantId } = req.params as { assetId: string; variantId: string };
    const asset = steleAssets.get(db, assetId);
    const variant = assetVariants.get(db, variantId);
    if (!asset || !variant || variant.steleAssetId !== assetId) {
      return notFound(reply, "variant");
    }
    const tab = steleTabs.get(db, asset.steleTabId);
    if (tab) {
      steleTabs.put(db, {
        ...tab,
        uiState: { ...tab.uiState, activeVariantId: variantId },
        updatedAt: new Date().toISOString(),
      });
    }
    auditEvents.record(db, "THREE_D_ACTIVATE_VARIANT", "AssetVariant", variantId, {
      assetId,
      variantType: variant.variantType,
    });
    return { ok: true, activeVariantId: variantId };
  });

  app.delete("/api/3d/assets/:assetId/variants/:variantId", async (req, reply) => {
    const { assetId, variantId } = req.params as { assetId: string; variantId: string };
    const variant = assetVariants.get(db, variantId);
    if (!variant || variant.steleAssetId !== assetId) return notFound(reply, "variant");
    if (variant.variantType.startsWith("RAW_")) {
      return reply.status(403).send({
        error: "RAW_IMMUTABLE",
        message: "원본(RAW) variant는 삭제할 수 없습니다",
      });
    }
    assetVariants.delete(db, variantId);
    auditEvents.record(db, "THREE_D_DELETE_VARIANT", "AssetVariant", variantId, { assetId });
    return { ok: true };
  });

  app.get("/api/3d/variants/:variantId/file", async (req, reply) => {
    const { variantId } = req.params as { variantId: string };
    const variant = assetVariants.get(db, variantId);
    if (!variant?.storageKey) return notFound(reply, "variant 파일");
    const buf = readFileSync(path.join(dataDir(), variant.storageKey));
    return reply
      .header("content-type", MIME_BY_FORMAT[variant.format] ?? "application/octet-stream")
      .header("cache-control", "public, max-age=3600, immutable")
      .send(buf);
  });

  // ── 글자 detail patch ──
  app.post("/api/3d/mesh/generate-detail-patches", async (req, reply) => {
    const body = z
      .object({
        assetId: z.string(),
        glyphCellIds: z.array(z.string()).min(1).max(24),
        resolution: z.coerce.number().int().min(32).max(192).default(96),
      })
      .parse(req.body);
    const asset = steleAssets.get(db, body.assetId);
    if (!asset) return notFound(reply, "자산");
    try {
      const variants = await generateDetailPatches(db, asset, body.glyphCellIds, body.resolution);
      return { variants };
    } catch (err) {
      return reply.status(400).send({ error: "PATCH_FAILED", message: (err as Error).message });
    }
  });

  // ── Splat ──
  app.post("/api/3d/splat/demo", async (req, reply) => {
    const body = z.object({ assetId: z.string() }).parse(req.body);
    const asset = steleAssets.get(db, body.assetId);
    if (!asset) return notFound(reply, "자산");
    const job = await generateSplatDemo(db, asset);
    return reply.status(job.stage === "READY" ? 201 : 400).send(job);
  });

  app.post("/api/3d/splat/train", async (_req, reply) => {
    const adapter = validateAdapter("nerfstudio");
    return reply.status(501).send({
      error: "ADAPTER_UNAVAILABLE",
      message: `Nerfstudio Splatfacto 어댑터: ${adapter?.statusNote ?? "미등록"}. 데모 splat은 POST /api/3d/splat/demo 사용.`,
      adapter,
    });
  });

  // ── 재구성 job ──
  app.post("/api/3d/reconstruction/jobs", async (req, reply) => {
    const body = z
      .object({ adapterId: z.string(), assetId: z.string().optional() })
      .parse(req.body);
    const adapter = validateAdapter(body.adapterId);
    if (!adapter) return notFound(reply, "어댑터");
    if (!adapter.available) {
      return reply.status(409).send({
        error: "ADAPTER_UNAVAILABLE",
        message: `${adapter.displayName}: ${adapter.statusNote}`,
        adapter,
      });
    }
    return reply.status(501).send({
      error: "NOT_IMPLEMENTED",
      message: "외부 재구성 제출은 어댑터 실행 환경 구성 후 활성화됩니다 (P1)",
    });
  });

  app.get("/api/3d/reconstruction/jobs/:jobId", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = threeDJobs.get(db, jobId);
    if (!job) return notFound(reply, "작업");
    return job;
  });

  // ── 어댑터 ──
  app.get("/api/3d/adapters", async () => listAdapters());

  app.post("/api/3d/adapters/:adapterId/validate", async (req, reply) => {
    const { adapterId } = req.params as { adapterId: string };
    const adapter = validateAdapter(adapterId);
    if (!adapter) return notFound(reply, "어댑터");
    return adapter;
  });

  // ── 렌더 프리셋 ──
  app.get("/api/3d/render-presets", async () => renderPresets.list(db));

  app.post("/api/3d/render-presets", async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1),
        lightingPreset: z.enum([
          "MUSEUM_NEUTRAL", "FIELD_DAYLIGHT", "LABORATORY_NEUTRAL", "RAKING", "SWEEP", "UNLIT_ALBEDO",
        ]),
        exposure: z.number().min(0.1).max(4),
        aoStrength: z.number().min(0).max(2),
        normalStrength: z.number().min(0).max(3).default(1),
        note: z.string().default(""),
      })
      .parse(req.body);
    const preset = {
      id: `preset-${Date.now()}`,
      ...body,
      toneMapping: "ACESFilmic",
      createdAt: new Date().toISOString(),
    };
    renderPresets.put(db, preset);
    return reply.status(201).send(preset);
  });

  // ── 기준 렌더 (before/after 비교) ──
  app.post("/api/3d/reference-renders", async (req, reply) => {
    const body = z
      .object({
        assetId: z.string(),
        name: z.string().min(1).max(60),
        imageDataUrl: z.string().startsWith("data:image/png;base64,"),
        camera: z.record(z.unknown()).default({}),
        lighting: z.record(z.unknown()).default({}),
      })
      .parse(req.body);
    const asset = steleAssets.get(db, body.assetId);
    if (!asset) return notFound(reply, "자산");
    const png = Buffer.from(body.imageDataUrl.split(",")[1]!, "base64");
    if (png.length > 8 * 1024 * 1024) {
      return reply.status(400).send({ error: "TOO_LARGE", message: "기준 렌더는 8MB 이하" });
    }
    const id = `var-ref-${Date.now()}`;
    const dir = path.join(dataDir(), "derived");
    mkdirSync(dir, { recursive: true });
    const storageKey = path.join("derived", `${id}.png`);
    writeFileSync(path.join(dataDir(), storageKey), png);
    const variant = {
      id,
      steleAssetId: body.assetId,
      variantType: "REFERENCE_RENDER" as const,
      parentVariantIds: [],
      sourceState: "DERIVED" as const,
      format: "PNG",
      mimeType: "image/png",
      storageKey,
      byteSize: png.length,
      sha256: null,
      vertexCount: null,
      triangleCount: null,
      pointCount: null,
      splatCount: null,
      coordinateSystem: "screen",
      unit: null,
      scaleConfidence: "UNKNOWN" as const,
      bounds: null,
      qualityLevel: "Q1_PREVIEW" as const,
      measurementAllowed: false,
      visualizationOnly: true,
      licenseState: asset.rightsState,
      pipelineName: "reference-render",
      pipelineVersion: THREE_D_PIPELINE_VERSION,
      pipelineParameters: { name: body.name, camera: body.camera, lighting: body.lighting },
      metrics: {},
      glyphCellId: null,
      createdAt: new Date().toISOString(),
    };
    assetVariants.put(db, variant);
    return reply.status(201).send(variant);
  });

  app.get("/api/3d/reference-renders/:assetId", async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    const asset = steleAssets.get(db, assetId);
    if (!asset) return notFound(reply, "자산");
    return assetVariants
      .listByAsset(db, assetId)
      .filter((v) => v.variantType === "REFERENCE_RENDER");
  });

  app.get("/api/3d/disclaimers", async () => ({ disclaimers: QUALITY_DISCLAIMERS }));

  // ── SceneLook CRUD (버전 관리·스크린샷 재현용, 표시 계층 전용) ──
  app.get("/api/3d/scene-looks", async () => sceneLooks.list(db));

  app.get("/api/3d/scene-looks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const look = sceneLooks.get(db, id);
    if (!look) return notFound(reply, "SceneLook");
    return look;
  });

  app.post("/api/3d/scene-looks", async (req, reply) => {
    const parsed = SceneLookCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "VALIDATION", issues: parsed.error.issues });
    }
    const now = new Date().toISOString();
    const look = SceneLook.parse({
      ...parsed.data,
      id: `look-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      builtIn: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    sceneLooks.put(db, look);
    auditEvents.record(db, "SCENE_LOOK_CREATED", "SceneLook", look.id, { name: look.name });
    return reply.status(201).send(look);
  });

  app.patch("/api/3d/scene-looks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = sceneLooks.get(db, id);
    if (!existing) return notFound(reply, "SceneLook");
    const parsed = SceneLookCreate.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "VALIDATION", issues: parsed.error.issues });
    }
    const updated = SceneLook.parse({
      ...existing,
      ...parsed.data,
      id: existing.id,
      builtIn: existing.builtIn,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    });
    sceneLooks.put(db, updated);
    auditEvents.record(db, "SCENE_LOOK_UPDATED", "SceneLook", id, { version: updated.version });
    return updated;
  });

  app.delete("/api/3d/scene-looks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = sceneLooks.get(db, id);
    if (!existing) return notFound(reply, "SceneLook");
    if (existing.builtIn) {
      return reply
        .status(409)
        .send({ error: "BUILT_IN", message: "내장 SceneLook은 삭제할 수 없습니다" });
    }
    sceneLooks.delete(db, id);
    auditEvents.record(db, "SCENE_LOOK_DELETED", "SceneLook", id, {});
    return { ok: true };
  });

  // ── CameraBookmark CRUD ──
  app.get("/api/3d/camera-bookmarks", async () => cameraBookmarks.list(db));

  app.post("/api/3d/camera-bookmarks", async (req, reply) => {
    const parsed = CameraBookmarkCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "VALIDATION", issues: parsed.error.issues });
    }
    const bm = CameraBookmark.parse({
      ...parsed.data,
      id: `cambm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      createdAt: new Date().toISOString(),
    });
    cameraBookmarks.put(db, bm);
    auditEvents.record(db, "CAMERA_BOOKMARK_CREATED", "CameraBookmark", bm.id, { name: bm.name });
    return reply.status(201).send(bm);
  });

  app.delete("/api/3d/camera-bookmarks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!cameraBookmarks.get(db, id)) return notFound(reply, "CameraBookmark");
    cameraBookmarks.delete(db, id);
    return { ok: true };
  });
}
