import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CORPUS_VERSION,
  MODEL_VERSION,
  CompareGlyphsBody,
  CreateResearchSetBody,
  CreateTabBody,
  InitUploadBody,
  SetLicenseBody,
  TabOrderBody,
  UiStateBody,
  type DossierResponse,
  type GlyphCell as GlyphCellEntity,
  type GlyphMatrixResponse,
  type ResearchSet,
  type SteleAsset,
  type SteleTab,
} from "@seokmun/types";
import {
  Bm25Index,
  analyzeGlyphCell,
  buildLineages,
  checkExportRights,
  computeFrontierIndex,
  computeMaturityScore,
  evaluateJoin,
  exportCsv,
  exportEpiDoc,
  exportJson,
  exportReport,
  jitterPolylines,
  observedPolylines,
  strokeSetSimilarity,
  toPipelineCell,
  type BreakCurve,
  type SeedPriors,
} from "@seokmun/engine";
import { dataDir, openDb, tx, wipe, type Db } from "./db";
import { assertSafeConfig, isLoopback, loadConfig, type AppConfig } from "./config";
import { newId } from "./context";
import { ALLOWED_UPLOAD_EXTENSIONS, inspectStoredFile, saveStream, uploadKind } from "./uploads";
import { assetFileAccess, sendFileStream } from "./files";
import { registerShowcaseRoutes } from "./showcase";
import { registerEditingRoutes } from "./editing";
import { registerReadingRoutes } from "./readings";
import { createBackup, exportSetBundle, importSetBundle, listBackups, type SetBundle } from "./backup";
import { ensureBootstrapAdmin, ensureDevUsers, registerAuth } from "./auth";
import { canAccessSet, effectiveSetRole } from "./auth/policy";
import { sanitizeCell } from "./sanitize";
import { computeGlyphMatrix } from "./glyphMatrix";
import { registerThreeDRoutes } from "./threeD/routes";
import { buildPipelineInput, runAndPersistAnalysis } from "./analysis";
import { defaultUiState, isSeeded, seedAll } from "./seed";
import {
  auditEvents,
  benchmarkCases,
  comparisons,
  crossMatches,
  documentClaims,
  documents,
  evidenceRepo,
  readings as readingsRepo,
  frontierItems,
  glyphCells,
  hypotheses,
  researchSets,
  sourceRecords,
  steleAssets,
  steleTabs,
} from "./repo";

const UNRESOLVED = new Set(["UNKNOWN", "CONFLICTING", "PARTIALLY_OBSERVED", "ILLEGIBLE"]);


interface Ctx {
  db: Db;
  priors: SeedPriors;
  bm25: Bm25Index;
}

function loadPriors(): SeedPriors {
  const seedPath = path.resolve(import.meta.dirname, "../../../data/seed/demo-glyphs.json");
  return (JSON.parse(readFileSync(seedPath, "utf8")) as { priors: SeedPriors }).priors;
}

function buildSearchIndex(db: Db): Bm25Index {
  return new Bm25Index(
    documents.list(db).map((d) => ({
      id: d.entity.id,
      title: d.entity.title,
      content: d.entity.content,
    }))
  );
}

function setStats(db: Db, set: ResearchSet) {
  const tabs = steleTabs.listBySet(db, set.id).filter((t) => !t.archived);
  let unresolved = 0;
  let conflicting = 0;
  let rightsWarnings = 0;
  for (const tab of tabs) {
    if (["VERIFY_PER_ASSET", "VERIFY_REQUIRED", "UNKNOWN", "NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED"].includes(tab.rightsState)) {
      rightsWarnings++;
    }
    for (const c of glyphCells.listByTab(db, tab.id)) {
      if (UNRESOLVED.has(c.entity.readingStatus)) unresolved++;
      if (c.entity.readingStatus === "CONFLICTING") conflicting++;
    }
    for (const a of steleAssets.listByTab(db, tab.id)) {
      if (a.provenance === "REAL_USER_UPLOAD" && a.rightsState === "VERIFY_REQUIRED") {
        rightsWarnings++;
      }
    }
  }
  const primary = tabs.find((t) => t.roles.includes("PRIMARY"));
  return {
    tabCount: tabs.length,
    primaryTabTitle: primary?.title ?? null,
    unresolvedGlyphs: unresolved,
    conflictingGlyphs: conflicting,
    rightsWarnings,
    frontierItems: frontierItems.list(db).length,
  };
}

function tabBadges(db: Db, tab: SteleTab) {
  const cells = glyphCells.listByTab(db, tab.id);
  const assets = steleAssets.listByTab(db, tab.id);
  return {
    unresolvedCount: cells.filter((c) => UNRESOLVED.has(c.entity.readingStatus)).length,
    rightsWarning: ["VERIFY_PER_ASSET", "VERIFY_REQUIRED", "UNKNOWN", "NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED"].includes(tab.rightsState) ||
      assets.some((a) => a.provenance === "REAL_USER_UPLOAD" && a.rightsState === "VERIFY_REQUIRED"),
    isFrontier: tab.roles.includes("FRONTIER") || tab.roles.includes("WATCHLIST"),
    hasVirtualDemo: assets.some((a) => a.provenance === "VIRTUAL_DEMO"),
    has3d: assets.some((a) => a.assetType === "MESH"),
  };
}

export function buildServer(overrides: Partial<AppConfig> = {}): FastifyInstance {
  const cfg: AppConfig = { ...loadConfig(), ...overrides };
  assertSafeConfig(cfg);
  const db = openDb(cfg.dataDir);
  if (cfg.authMode === "dev") ensureDevUsers(db);
  if (!isSeeded(db) && cfg.seedDemo) seedAll(db);
  const ctx: Ctx = { db, priors: loadPriors(), bm25: buildSearchIndex(db) };

  const app = Fastify({
    logger: {
      level: cfg.logLevel,
      redact: ["req.headers.cookie", "req.headers.authorization", "req.headers[\"x-seokmun-proxy-secret\"]"],
    },
    // JSON 본문 한도 — 파일 업로드는 스트리밍 라우트에서 별도 한도로 처리
    bodyLimit: 20 * 1024 * 1024,
    genReqId: () => newId("req"),
  });
  void app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || cfg.allowedOrigins.includes(origin)),
    credentials: true,
  });
  app.addHook("onReady", async () => {
    await ensureBootstrapAdmin(db, cfg);
  });
  app.addHook("onClose", async () => {
    db.close();
  });

  // 업로드는 본문을 메모리에 올리지 않고 스트림 그대로 받는다
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));

  app.setErrorHandler((rawErr, req, reply) => {
    if (rawErr instanceof z.ZodError) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "요청 본문이 유효하지 않습니다",
        details: rawErr.issues,
      });
    }
    const err = rawErr as { statusCode?: number; code?: string; name?: string; message?: string };
    const status = typeof err.statusCode === "number" ? err.statusCode : 500;
    if (status >= 500) {
      // 내부 경로·스택은 서버 로그에만 남기고 클라이언트에는 요청 ID만 준다
      req.log.error({ err: rawErr }, "unhandled error");
      return reply.status(status).send({
        error: "INTERNAL_ERROR",
        message: "서버 오류가 발생했습니다. 관리자에게 요청 ID를 알려 주세요.",
        requestId: req.id,
      });
    }
    return reply.status(status).send({
      error: err.code ?? err.name ?? "REQUEST_ERROR",
      message: err.message ?? "요청을 처리할 수 없습니다",
    });
  });

  registerAuth(app, db, cfg);

  const notFound = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }, what: string) =>
    reply.status(404).send({ error: "NOT_FOUND", message: `${what}을(를) 찾을 수 없습니다` });

  // ── 헬스 ──
  app.get("/api/health", async () => ({
    ok: true,
    modelVersion: MODEL_VERSION,
    corpusVersion: CORPUS_VERSION,
    authMode: cfg.authMode,
  }));

  // ── 연구 세트 ──
  app.get("/api/research-sets", async (req) => {
    const sets = researchSets
      .list(ctx.db)
      .filter((s) => effectiveSetRole(ctx.db, req.user, s.id) !== null);
    return sets.map((s) => ({
      set: s,
      stats: setStats(ctx.db, s),
      myRole: effectiveSetRole(ctx.db, req.user, s.id),
    }));
  });

  app.post("/api/research-sets", async (req, reply) => {
    const body = CreateResearchSetBody.parse(req.body);
    const now = new Date().toISOString();
    const id = newId("rs");
    const set: ResearchSet = {
      id,
      name: body.name,
      description: body.description,
      researchQuestion: body.researchQuestion,
      periodRange: "",
      regions: [],
      scripts: [],
      languages: [],
      visibility: "PRIVATE",
      activeTabOrder: [],
      activeTabId: null,
      pinnedTabIds: [],
      rightsPolicy: "각 자산의 권리 상태를 확인하기 전에는 재배포하지 않는다.",
      createdAt: now,
      updatedAt: now,
    };
    researchSets.put(ctx.db, set);
    auditEvents.record(ctx.db, "CREATE_RESEARCH_SET", "ResearchSet", id, { name: body.name });
    return reply.status(201).send(set);
  });

  app.get("/api/research-sets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const set = researchSets.get(ctx.db, id);
    if (!set) return notFound(reply, "연구 세트");
    const tabs = steleTabs.listBySet(ctx.db, id).filter((t) => !t.archived);
    const orderIndex = new Map(set.activeTabOrder.map((tabId, i) => [tabId, i]));
    tabs.sort(
      (a, b) => (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999)
    );
    return {
      set,
      tabs: tabs.map((t) => ({ tab: t, badges: tabBadges(ctx.db, t) })),
      stats: setStats(ctx.db, set),
      myRole: effectiveSetRole(ctx.db, req.user, id),
    };
  });

  app.patch("/api/research-sets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const set = researchSets.get(ctx.db, id);
    if (!set) return notFound(reply, "연구 세트");
    const patch = z
      .object({ name: z.string().min(1).optional(), description: z.string().optional() })
      .parse(req.body);
    const updated = { ...set, ...patch, updatedAt: new Date().toISOString() };
    researchSets.put(ctx.db, updated);
    auditEvents.record(ctx.db, "UPDATE_RESEARCH_SET", "ResearchSet", id, patch);
    return updated;
  });

  app.patch("/api/research-sets/:id/tab-order", async (req, reply) => {
    const { id } = req.params as { id: string };
    const set = researchSets.get(ctx.db, id);
    if (!set) return notFound(reply, "연구 세트");
    const body = TabOrderBody.parse(req.body);
    // 부분 갱신 — 제공된 필드만 반영 (stale 클라이언트가 다른 필드를 되돌리는 경합 방지)
    const updated: ResearchSet = {
      ...set,
      activeTabOrder: body.activeTabOrder ?? set.activeTabOrder,
      activeTabId: body.activeTabId !== undefined ? body.activeTabId : set.activeTabId,
      pinnedTabIds: body.pinnedTabIds ?? set.pinnedTabIds,
      updatedAt: new Date().toISOString(),
    };
    researchSets.put(ctx.db, updated);
    auditEvents.record(ctx.db, "REORDER_TABS", "ResearchSet", id, {
      order: updated.activeTabOrder,
      activeTabId: updated.activeTabId,
    });
    return updated;
  });

  app.post("/api/research-sets/:id/tabs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const set = researchSets.get(ctx.db, id);
    if (!set) return notFound(reply, "연구 세트");
    const body = CreateTabBody.parse(req.body);
    const now = new Date().toISOString();
    const tabId = newId("tab");
    const tab: SteleTab = {
      id: tabId,
      researchSetId: id,
      title: body.title,
      canonicalName: body.canonicalName || body.title,
      alternativeNames: [],
      roles: body.roles,
      assetMode: body.assetMode,
      initialStatus: "SOURCE_METADATA_READY",
      maturityScores: null,
      frontierSignals: null,
      periodEstimate: body.periodEstimate,
      location: body.location,
      material: "",
      scriptType: "한문 해서/예서 계열",
      writingDirection: "세로쓰기",
      rightsState: body.rightsState,
      sourceQuality: 0.5,
      questions: [],
      knownFacts: [],
      restrictions: [],
      preliminaryClaims: [],
      warnings: [],
      archived: false,
      uiState: defaultUiState(),
      createdAt: now,
      updatedAt: now,
    };
    tx(ctx.db, () => {
      steleTabs.put(ctx.db, tab);
      researchSets.put(ctx.db, {
        ...set,
        activeTabOrder: [...set.activeTabOrder, tabId],
        updatedAt: now,
      });
      auditEvents.record(ctx.db, "CREATE_TAB", "SteleTab", tabId, { title: body.title });
    });
    return reply.status(201).send(tab);
  });

  // ── 탭 ──
  app.get("/api/stele-tabs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(ctx.db, id);
    if (!tab) return notFound(reply, "탭");
    return {
      tab,
      badges: tabBadges(ctx.db, tab),
      sourceRecords: sourceRecords.listByTab(ctx.db, id),
      assets: steleAssets.listByTab(ctx.db, id),
      glyphCells: glyphCells.listByTab(ctx.db, id).map(sanitizeCell),
    };
  });

  app.post("/api/stele-tabs/:id/ui-state", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(ctx.db, id);
    if (!tab) return notFound(reply, "탭");
    const patch = UiStateBody.parse(req.body);
    const updated: SteleTab = {
      ...tab,
      uiState: { ...tab.uiState, ...patch, lastSavedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    steleTabs.put(ctx.db, updated);
    return updated.uiState;
  });

  app.post("/api/stele-tabs/:id/archive", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(ctx.db, id);
    if (!tab) return notFound(reply, "탭");
    tx(ctx.db, () => {
      steleTabs.put(ctx.db, { ...tab, archived: true, updatedAt: new Date().toISOString() });
      // 세트 상태에서 고아 참조 제거 (activeTabId·순서·고정)
      const set = researchSets.get(ctx.db, tab.researchSetId);
      if (set) {
        const remaining = set.activeTabOrder.filter((t) => t !== id);
        researchSets.put(ctx.db, {
          ...set,
          activeTabOrder: remaining,
          pinnedTabIds: set.pinnedTabIds.filter((t) => t !== id),
          activeTabId: set.activeTabId === id ? (remaining[0] ?? null) : set.activeTabId,
          updatedAt: new Date().toISOString(),
        });
      }
      auditEvents.record(ctx.db, "ARCHIVE_TAB", "SteleTab", id, {});
    });
    return { ok: true };
  });

  // 보관 탭 복구 (닫기 실수 되돌리기)
  app.post("/api/stele-tabs/:id/unarchive", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(ctx.db, id);
    if (!tab) return notFound(reply, "탭");
    if (!tab.archived) return { ok: true, alreadyActive: true };
    tx(ctx.db, () => {
      steleTabs.put(ctx.db, { ...tab, archived: false, updatedAt: new Date().toISOString() });
      const set = researchSets.get(ctx.db, tab.researchSetId);
      if (set && !set.activeTabOrder.includes(id)) {
        researchSets.put(ctx.db, {
          ...set,
          activeTabOrder: [...set.activeTabOrder, id],
          updatedAt: new Date().toISOString(),
        });
      }
      auditEvents.record(ctx.db, "UNARCHIVE_TAB", "SteleTab", id, {});
    });
    return { ok: true };
  });

  app.get("/api/research-sets/:id/archived-tabs", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!researchSets.get(ctx.db, id)) return notFound(reply, "연구 세트");
    return steleTabs
      .listBySet(ctx.db, id)
      .filter((t) => t.archived)
      .map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt }));
  });

  app.get("/api/stele-tabs/:id/maturity", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(ctx.db, id);
    if (!tab) return notFound(reply, "탭");
    return {
      scores: tab.maturityScores,
      total: tab.maturityScores ? computeMaturityScore(tab.maturityScores) : null,
      frontierIndex: tab.frontierSignals ? computeFrontierIndex(tab.frontierSignals) : null,
      initialStatus: tab.initialStatus,
      note: "성숙도 점수는 공개 연구 기반의 성숙도이며 진실성 점수가 아니다.",
    };
  });

  app.get("/api/stele-tabs/:id/glyphs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(ctx.db, id);
    if (!tab) return notFound(reply, "탭");
    return glyphCells.listByTab(ctx.db, id).map(sanitizeCell);
  });

  // ── 자산 업로드 (스트리밍) ──
  // 본문은 application/octet-stream 스트림 — 메모리에 올리지 않고 디스크로 흘려 쓴다
  app.post(
    "/api/stele-tabs/:id/assets/upload",
    { bodyLimit: cfg.maxUploadBytes },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const tab = steleTabs.get(ctx.db, id);
      if (!tab) return notFound(reply, "탭");
      const query = InitUploadBody.omit({ byteSize: true }).parse(req.query);
      const body = req.body as NodeJS.ReadableStream | undefined;
      if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
        return reply.status(400).send({
          error: "EMPTY_BODY",
          message: "application/octet-stream 본문으로 파일을 전송해야 합니다",
        });
      }
      // 길이를 아는 요청은 본문을 읽기 전에 한도 검사
      const declaredLength = Number(req.headers["content-length"] ?? NaN);
      if (Number.isFinite(declaredLength) && declaredLength > cfg.maxUploadBytes) {
        return reply.status(413).send({
          error: "UPLOAD_TOO_LARGE",
          message: `업로드 한도(${Math.round(cfg.maxUploadBytes / 1024 ** 2)}MB)를 넘었습니다`,
        });
      }
      const kind = uploadKind(query.filename, query.declaredType ?? null);
      if (!kind) {
        return reply.status(400).send({
          error: "UNSUPPORTED_FORMAT",
          message: `지원하지 않는 확장자입니다 — 허용: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}`,
        });
      }
      if (query.sourceRecordId && !sourceRecords.get(ctx.db, query.sourceRecordId)) {
        return reply.status(400).send({
          error: "UNKNOWN_SOURCE_RECORD",
          message: `출처 레코드(${query.sourceRecordId})가 존재하지 않습니다`,
        });
      }
      const assetId = newId("asset-upload");
      const storageKey = path.join("originals", assetId, path.basename(query.filename));
      const absPath = path.join(dataDir(), storageKey);
      const saved = await saveStream(body as unknown as import("node:stream").Readable, absPath, cfg.maxUploadBytes);
      let inspection: ReturnType<typeof inspectStoredFile>;
      try {
        inspection = inspectStoredFile(kind, absPath, saved.bytes, cfg.fullParseMaxBytes);
      } catch (err) {
        req.log.warn({ err }, "upload inspection failed");
        inspection = {
          qualityReport: {
            format: kind.ext.toUpperCase(),
            vertexCount: null,
            triangleCount: null,
            pointCount: null,
            hasNormals: null,
            hasColors: null,
            boundingBox: null,
            unitGuess: null,
            warnings: ["파일 검사 중 오류 — 원본은 보존되었습니다. 형식을 확인하세요"],
          },
          image: null,
        };
      }
      const asset: SteleAsset = {
        id: assetId,
        steleTabId: id,
        assetType: kind.assetType,
        provenance: "REAL_USER_UPLOAD",
        demoLabel: null,
        originalFilename: query.filename,
        mimeType: kind.mimeType,
        format: inspection.qualityReport.format,
        byteSize: saved.bytes,
        checksumSha256: saved.sha256,
        sourceRecordId: query.sourceRecordId,
        licenseType: null,
        licenseVerifiedAt: null,
        licenseVerifiedBy: null,
        usagePurpose: query.usagePurpose,
        coordinateSystem: null,
        unit: inspection.qualityReport.unitGuess,
        qualityLevel: "FULL",
        isOriginal: true,
        parentAssetId: null,
        processingStatus: "READY",
        rightsState: "VERIFY_REQUIRED",
        qualityReport: inspection.qualityReport,
        storageKey,
        meshParams: null,
        imageInfo: inspection.image,
        scaleCalibration: null,
        alignment: null,
        createdAt: new Date().toISOString(),
      };
      tx(ctx.db, () => {
        steleAssets.put(ctx.db, asset);
        auditEvents.record(ctx.db, "UPLOAD_ASSET", "SteleAsset", assetId, {
          filename: query.filename,
          byteSize: saved.bytes,
          checksum: saved.sha256,
          assetType: kind.assetType,
          usagePurpose: query.usagePurpose,
          rightsState: "VERIFY_REQUIRED",
        });
      });
      return reply.status(201).send(asset);
    }
  );

  // 원본 파일 (이미지·탁본 뷰어, 원본 다운로드) — 권리·세트 권한 판정 + Range
  app.get("/api/assets/:id/file", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = steleAssets.get(ctx.db, id);
    if (!asset?.storageKey) return notFound(reply, "자산 파일");
    const access = assetFileAccess(ctx.db, req.user, asset);
    if (!access.ok) {
      return reply.status(access.status).send({ error: access.error, message: access.message });
    }
    return sendFileStream(
      req,
      reply,
      path.join(dataDir(), asset.storageKey),
      asset.mimeType ?? "application/octet-stream",
      access.cache,
      asset.originalFilename ?? undefined
    );
  });

  app.get("/api/assets/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = steleAssets.get(ctx.db, id);
    if (!asset) return notFound(reply, "자산");
    return {
      id: asset.id,
      processingStatus: asset.processingStatus,
      rightsState: asset.rightsState,
      licenseType: asset.licenseType,
    };
  });

  app.get("/api/assets/:id/quality-report", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = steleAssets.get(ctx.db, id);
    if (!asset) return notFound(reply, "자산");
    return { id: asset.id, qualityReport: asset.qualityReport };
  });

  app.post("/api/assets/:id/license", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = steleAssets.get(ctx.db, id);
    if (!asset) return notFound(reply, "자산");
    const body = SetLicenseBody.parse(req.body);
    // 확인자는 클라이언트 입력이 아니라 세션 사용자(PI)로 기록한다
    const verifier = req.user!;
    const updated: SteleAsset = {
      ...asset,
      licenseType: body.licenseType,
      rightsState: body.rightsState,
      licenseVerifiedAt: new Date().toISOString(),
      licenseVerifiedBy: `${verifier.displayName} (${verifier.id})`,
    };
    tx(ctx.db, () => {
      steleAssets.put(ctx.db, updated);
      auditEvents.record(ctx.db, "CONFIRM_RIGHTS", "SteleAsset", id, {
        licenseType: body.licenseType,
        rightsState: body.rightsState,
        previousRightsState: asset.rightsState,
        notes: body.notes,
        ...(body.verifiedBy ? { declaredVerifier: body.verifiedBy } : {}),
      });
    });
    return updated;
  });

  // ── 글리프 분석 / Dossier ──
  app.post("/api/glyphs/:id/analyze", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(ctx.db, id);
    if (!stored) return notFound(reply, "문자 셀");
    // 관측 확정(OBSERVED) 셀은 자동 분석으로 상태를 덮어쓰지 않는다
    if (stored.entity.readingStatus === "OBSERVED" && stored.entity.publishedReading) {
      return reply.status(409).send({
        error: "OBSERVED_CELL",
        message:
          "관측 확정 셀은 자동 분석 대상이 아닙니다. 손상·미상 셀을 선택하세요.",
      });
    }
    const result = runAndPersistAnalysis(ctx.db, stored, ctx.priors);
    const updated = glyphCells.get(ctx.db, id);
    return { ...result, glyphCell: updated ? sanitizeCell(updated) : result.glyphCell };
  });

  app.get("/api/glyphs/:id/dossier", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(ctx.db, id);
    if (!stored) return notFound(reply, "문자 셀");
    const tab = steleTabs.get(ctx.db, stored.entity.steleTabId);
    if (!tab) return notFound(reply, "탭");
    const runId = stored.extra.latestRunId;
    const allHyp = hypotheses
      .listByCell(ctx.db, id)
      .filter((h) => (runId ? h.id.startsWith(`hyp-${runId}-`) : false))
      .sort((a, b) => b.calibratedConfidence - a.calibratedConfidence);
    const conclusion = allHyp[0] ?? null;
    const evidence = allHyp.flatMap((h) => evidenceRepo.listByHypothesis(ctx.db, h.id));
    const docsById = new Map(documents.list(ctx.db).map((d) => [d.entity.id, d.entity]));
    const genealogyDocs = evidence
      .filter((e) => e.citationVerified && e.documentId)
      .map((e) => {
        const doc = docsById.get(e.documentId!)!;
        return {
          id: doc.id,
          title: doc.title,
          independenceGroup: doc.independenceGroup,
          derivedFromDocumentId: doc.derivedFromDocumentId,
          reliabilityTier: doc.reliabilityTier,
        };
      });
    const uniqueDocs = [...new Map(genealogyDocs.map((d) => [d.id, d])).values()];
    const response: DossierResponse = {
      glyphCell: sanitizeCell(stored),
      tab,
      conclusion,
      alternates: allHyp.slice(1),
      evidence,
      crossSteleMatches: crossMatches
        .listByCell(ctx.db, id)
        .filter((m) => (runId ? m.id.startsWith(`xm-${runId}-`) : false)),
      sourceGenealogy: buildLineages(uniqueDocs),
      decision: conclusion?.gateResult ?? null,
      readings: readingsRepo.listByCell(ctx.db, id),
      adoptedReadingId: stored.entity.adoptedReadingId,
      modelVersion: MODEL_VERSION,
      corpusVersion: CORPUS_VERSION,
      rightsState: tab.rightsState,
      generatedAt: new Date().toISOString(),
    };
    return response;
  });

  // ── 비교 (Glyph Matrix / 조각 접합) ──
  app.post("/api/comparisons/glyphs", async (req, reply) => {
    const body = CompareGlyphsBody.parse(req.body);
    // 요청한 셀·탭이 모두 사용자가 접근 가능한 세트인지 확인 (본문 기반 자원)
    for (const cellId of body.glyphCellIds) {
      const stored = glyphCells.get(ctx.db, cellId);
      if (!stored) return notFound(reply, `문자 셀 ${cellId}`);
      const t = steleTabs.get(ctx.db, stored.entity.steleTabId);
      if (!t) return notFound(reply, "탭");
      if (!canAccessSet(ctx.db, req.user, t.researchSetId, "GUEST")) {
        return reply.status(403).send({ error: "SET_ACCESS_DENIED", message: "이 연구 세트에 대한 권한이 없습니다" });
      }
    }
    for (const tabId of body.tabIds) {
      const t = steleTabs.get(ctx.db, tabId);
      if (!t) return notFound(reply, `탭 ${tabId}`);
      if (!canAccessSet(ctx.db, req.user, t.researchSetId, "GUEST")) {
        return reply.status(403).send({ error: "SET_ACCESS_DENIED", message: "이 연구 세트에 대한 권한이 없습니다" });
      }
    }
    const { rows, researchSetId } = computeGlyphMatrix(ctx.db, body.glyphCellIds, body.tabIds);
    const comparisonId = newId("cmp");
    const response: GlyphMatrixResponse = {
      id: comparisonId,
      rows,
      createdAt: new Date().toISOString(),
    };
    comparisons.put(ctx.db, {
      id: comparisonId,
      researchSetId,
      kind: "GLYPH_MATRIX",
      payload: response,
      createdAt: response.createdAt,
    });
    auditEvents.record(ctx.db, "COMPARE_GLYPHS", "Comparison", comparisonId, {
      glyphCellIds: body.glyphCellIds,
      tabIds: body.tabIds,
    });
    return response;
  });

  app.get("/api/comparisons/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cmp = comparisons.get(ctx.db, id);
    if (!cmp) return notFound(reply, "비교 세션");
    return cmp.payload;
  });

  app.post("/api/comparisons/fragments", async (req, reply) => {
    const body = z
      .object({ tabId: z.string(), offset: z.number().min(-1).max(1) })
      .parse(req.body);
    if (!steleTabs.get(ctx.db, body.tabId)) return notFound(reply, "탭");
    const assets = steleAssets
      .listByTab(ctx.db, body.tabId)
      .filter((a) => a.format === "PROCEDURAL_FRAGMENT");
    if (assets.length < 2) {
      return reply.status(400).send({
        error: "NO_FRAGMENTS",
        message: "이 탭에는 가상 조각 자산이 2개 이상 필요합니다",
      });
    }
    const curveA = (assets[0]!.meshParams as { breakCurve: BreakCurve }).breakCurve;
    const curveB = (assets[1]!.meshParams as { breakCurve: BreakCurve }).breakCurve;
    const result = evaluateJoin(curveA, curveB, body.offset);
    return {
      ...result,
      fragmentAssetIds: assets.map((a) => a.id),
      note: "가상 조각(DEMO-C) 접합 시뮬레이션 — 실제 유물 계측이 아님",
    };
  });

  // ── 문헌 검색 (지지·반증) ──
  app.get("/api/literature/search", async (req) => {
    const query = z
      .object({
        q: z.string().min(1),
        stance: z.enum(["SUPPORT", "COUNTER", "ALL"]).default("ALL"),
        tabId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      })
      .parse(req.query);
    const hits = ctx.bm25.search(query.q, query.limit * 3);
    const docsById = new Map(documents.list(ctx.db).map((d) => [d.entity.id, d]));
    const out = [];
    for (const hit of hits) {
      const doc = docsById.get(hit.id);
      if (!doc) continue;
      const claims = documentClaims
        .listByDocument(ctx.db, doc.entity.id)
        .filter((c) => c.status === "CONFIRMED");
      if (query.stance !== "ALL") {
        const hasStance = claims.some((c) => c.stance === query.stance);
        if (!hasStance) continue;
      }
      if (query.tabId && !doc.entity.relatedTabIds.includes(query.tabId)) continue;
      out.push({
        document: doc.entity,
        score: Math.round(hit.score * 1000) / 1000,
        snippet: hit.snippet,
        matchOffsets: hit.matchOffsets,
        claims: claims.map((c) => ({
          targetGlyphCellId: c.targetGlyphCellId,
          character: c.character,
          stance: c.stance,
          quote: c.quote,
        })),
        benchmarkLeak: Boolean(doc.extra.benchmarkLeak),
      });
      if (out.length >= query.limit) break;
    }
    return out;
  });

  app.post("/api/documents", async (req, reply) => {
    const body = z
      .object({
        title: z.string().min(1),
        content: z.string().min(10),
        docType: z
          .enum([
            "PRIMARY_SOURCE",
            "PEER_REVIEWED",
            "SURVEY_REPORT",
            "CONFERENCE",
            "NEWS",
            "INSTITUTION_NOTE",
            "USER_NOTE",
          ])
          .default("USER_NOTE"),
        publisher: z.string().default("사용자 등록"),
        publishedAt: z.string().default(""),
        isFictional: z.boolean().default(false),
        reliabilityTier: z.coerce.number().int().min(1).max(7).default(7),
        relatedTabIds: z.array(z.string()).default([]),
      })
      .parse(req.body);
    const now = new Date().toISOString();
    const id = newId("doc-user");
    documents.put(ctx.db, {
      entity: {
        id,
        title: body.title,
        docType: body.docType,
        publisher: body.publisher,
        publishedAt: body.publishedAt || now.slice(0, 10),
        language: "ko",
        isFictional: body.isFictional,
        reliabilityTier: body.reliabilityTier,
        independenceGroup: id,
        derivedFromDocumentId: null,
        relatedTabIds: body.relatedTabIds,
        content: body.content,
        bibliographyId: null,
        fileStorageKey: null,
        createdAt: now,
      },
      extra: { benchmarkLeak: false },
    });
    ctx.bm25 = buildSearchIndex(ctx.db);
    auditEvents.record(ctx.db, "UPLOAD_DOCUMENT", "CorpusDocument", id, {
      title: body.title,
      docType: body.docType,
      bytes: Buffer.byteLength(body.content),
    });
    return reply.status(201).send({ id });
  });

  app.get("/api/documents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = documents.get(ctx.db, id);
    if (!doc) return notFound(reply, "문헌");
    return {
      ...doc.entity,
      claims: documentClaims.listByDocument(ctx.db, id),
      benchmarkLeak: Boolean(doc.extra.benchmarkLeak),
    };
  });

  // ── Frontier Watch ──
  app.get("/api/frontier", async () => frontierItems.list(ctx.db));

  app.get("/api/frontier/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = frontierItems.get(ctx.db, id);
    if (!item) return notFound(reply, "Frontier 항목");
    return item;
  });

  app.post("/api/frontier/:id/recheck", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = frontierItems.get(ctx.db, id);
    if (!item) return notFound(reply, "Frontier 항목");
    const updated = { ...item, lastCheckedAt: new Date().toISOString() };
    frontierItems.put(ctx.db, updated);
    auditEvents.record(ctx.db, "FRONTIER_RECHECK", "FrontierWatchItem", id, {});
    return updated;
  });

  app.post("/api/frontier/:id/promote-to-tab", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = frontierItems.get(ctx.db, id);
    if (!item) return notFound(reply, "Frontier 항목");
    if (item.promotedTabId) {
      return reply.status(409).send({
        error: "ALREADY_PROMOTED",
        message: "이미 탭으로 승격된 항목입니다",
        details: { promotedTabId: item.promotedTabId },
      });
    }
    const body = z.object({ researchSetId: z.string() }).parse(req.body);
    const set = researchSets.get(ctx.db, body.researchSetId);
    if (!set) return notFound(reply, "연구 세트");
    const now = new Date().toISOString();
    const tabId = newId("tab-frontier");
    const tab: SteleTab = {
      id: tabId,
      researchSetId: set.id,
      title: item.provisionalName,
      canonicalName: item.provisionalName,
      alternativeNames: [],
      roles: ["WATCHLIST", "FRONTIER"],
      assetMode: "METADATA_ONLY",
      initialStatus: "PRELIMINARY_READING",
      maturityScores: null,
      frontierSignals: null,
      periodEstimate: "",
      location: item.locationPrecision,
      material: "",
      scriptType: "미상",
      writingDirection: "미상",
      rightsState: item.rightsState,
      sourceQuality: 0.3,
      questions: item.unknownQuestions,
      knownFacts: [],
      restrictions: [],
      preliminaryClaims: item.preliminaryClaims,
      warnings: ["1차 판독 단계 — 확정 판독 아님"],
      archived: false,
      uiState: defaultUiState(),
      createdAt: now,
      updatedAt: now,
    };
    const updated = { ...item, promotedTabId: tabId };
    tx(ctx.db, () => {
      steleTabs.put(ctx.db, tab);
      researchSets.put(ctx.db, {
        ...set,
        activeTabOrder: [...set.activeTabOrder, tabId],
        updatedAt: now,
      });
      frontierItems.put(ctx.db, updated);
      auditEvents.record(ctx.db, "FRONTIER_PROMOTE", "FrontierWatchItem", id, { tabId });
    });
    return reply.status(201).send({ item: updated, tab });
  });

  // ── 내보내기 ──
  app.get("/api/research-sets/:id/export", async (req, reply) => {
    const { id } = req.params as { id: string };
    const set = researchSets.get(ctx.db, id);
    if (!set) return notFound(reply, "연구 세트");
    const query = z
      .object({
        format: z.enum(["json", "csv", "epidoc", "report"]),
        audience: z.enum(["INTERNAL", "PUBLIC"]).default("INTERNAL"),
      })
      .parse(req.query);
    const tabs = steleTabs.listBySet(ctx.db, id).filter((t) => !t.archived);
    const assets = tabs.flatMap((t) => steleAssets.listByTab(ctx.db, t.id));
    const gate = checkExportRights(assets, query.audience);
    if (!gate.allowed) {
      auditEvents.record(ctx.db, "EXPORT_BLOCKED", "ResearchSet", id, {
        audience: query.audience,
        blockedAssets: gate.blockedAssets,
      });
      return reply.status(403).send({
        error: "RIGHTS_NOT_CLEARED",
        message:
          "권리 미확인 자산이 있어 외부 공개 내보내기가 차단되었습니다. 관리자 권리 확인 후 다시 시도하세요.",
        details: gate.blockedAssets,
      });
    }
    const cells = tabs.flatMap((t) => glyphCells.listByTab(ctx.db, t.id).map(sanitizeCell));
    // 가상 데모 셀만 가진 탭 — 시드 유래(seedKey) 셀 여부로 판별
    const virtualTabIds = tabs
      .filter((t) =>
        glyphCells.listByTab(ctx.db, t.id).every((c) => Boolean(c.extra.seedKey))
      )
      .map((t) => t.id);
    const hyps = cells.flatMap((c) => {
      const stored = glyphCells.get(ctx.db, c.id)!;
      const runId = stored.extra.latestRunId;
      if (!runId) return [];
      return hypotheses
        .listByCell(ctx.db, c.id)
        .filter((h) => h.id.startsWith(`hyp-${runId}-`));
    });
    const input = {
      researchSet: set,
      tabs,
      sourceRecords: tabs.flatMap((t) => sourceRecords.listByTab(ctx.db, t.id)),
      assets,
      glyphCells: cells,
      hypotheses: hyps,
      modelVersion: MODEL_VERSION,
      corpusVersion: CORPUS_VERSION,
      generatedAt: new Date().toISOString(),
      audience: query.audience,
      virtualTabIds,
    };
    let content: string;
    let contentType: string;
    let ext: string;
    switch (query.format) {
      case "json":
        content = exportJson(input);
        contentType = "application/json";
        ext = "json";
        break;
      case "csv":
        content = exportCsv(input);
        contentType = "text/csv";
        ext = "csv";
        break;
      case "epidoc":
        content = exportEpiDoc(input);
        contentType = "application/xml";
        ext = "xml";
        break;
      default:
        content = exportReport(input);
        contentType = "text/markdown";
        ext = "md";
    }
    auditEvents.record(ctx.db, "EXPORT", "ResearchSet", id, {
      format: query.format,
      audience: query.audience,
      bytes: Buffer.byteLength(content),
    });
    return reply
      .header("content-type", `${contentType}; charset=utf-8`)
      .header(
        "content-disposition",
        `attachment; filename="seokmun-${id}-${query.format}.${ext}"`
      )
      .send(content);
  });

  // ── 감사 로그 ──
  app.get("/api/audit", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(1000).default(100),
        beforeSeq: z.coerce.number().int().positive().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        actor: z.string().optional(),
        action: z.string().optional(),
        since: z.string().optional(),
      })
      .parse(req.query);
    return auditEvents.list(ctx.db, query);
  });

  app.get("/api/audit/verify", async () => auditEvents.verify(ctx.db));

  // ── 평가 (벤치마크 — 정답은 이 경로에서만 읽는다) ──
  app.post("/api/evaluation/run", async () => {
    const cases = benchmarkCases.list(ctx.db);
    const results = [];
    let correctAuto = 0;
    let wrongAuto = 0;
    let abstained = 0;
    for (const bc of cases) {
      const stored = glyphCells.get(ctx.db, bc.glyphCellId);
      if (!stored) continue;
      const input = buildPipelineInput(ctx.db, stored, ctx.priors);
      const result = analyzeGlyphCell(input);
      const outcome = result.gateResult?.outcome ?? "UNKNOWN";
      const predicted =
        outcome === "AUTO_ACCEPTED" ? result.topCandidate?.candidateCharacter ?? null : null;
      if (predicted === null) abstained++;
      else if (predicted === bc.hiddenTruth) correctAuto++;
      else wrongAuto++;
      results.push({
        glyphCellId: bc.glyphCellId,
        outcome,
        predicted,
        correct: predicted === null ? null : predicted === bc.hiddenTruth,
        note: bc.note,
      });
    }
    const report = {
      cases: results,
      metrics: {
        total: results.length,
        autoAccepted: correctAuto + wrongAuto,
        correctAutoAccepts: correctAuto,
        wrongAutoAccepts: wrongAuto,
        abstained,
        autoAcceptPrecision:
          correctAuto + wrongAuto > 0 ? correctAuto / (correctAuto + wrongAuto) : null,
      },
      modelVersion: MODEL_VERSION,
      corpusVersion: CORPUS_VERSION,
      note: "가상 벤치마크(허구 데이터) 기준 평가 — 정답은 분석 파이프라인에 노출되지 않는다.",
    };
    auditEvents.record(ctx.db, "EVALUATION_RUN", "BenchmarkSuite", "demo", report.metrics);
    return report;
  });

  registerThreeDRoutes(app, ctx.db);
  registerShowcaseRoutes(app, ctx.db);
  registerEditingRoutes(app, ctx.db);
  registerReadingRoutes(app, ctx.db);

  // ── 백업 (PI) ──
  app.post("/api/admin/backup", async (req) => {
    const body = z
      .object({ label: z.string().max(100).default(""), includeFiles: z.boolean().default(true) })
      .parse(req.body ?? {});
    const { dir, manifest } = await createBackup(ctx.db, dataDir(), body);
    auditEvents.record(ctx.db, "BACKUP", "System", path.basename(dir), {
      files: manifest.files.length,
      label: body.label,
    });
    return { name: path.basename(dir), createdAt: manifest.createdAt, files: manifest.files.length };
  });

  app.get("/api/admin/backups", async () => listBackups(dataDir()));

  // ── 세트 번들 (설치본 간 이동·보존) ──
  app.get("/api/research-sets/:id/bundle", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!researchSets.get(ctx.db, id)) return notFound(reply, "연구 세트");
    const bundle = exportSetBundle(ctx.db, id);
    auditEvents.record(ctx.db, "EXPORT_BUNDLE", "ResearchSet", id, {
      tables: Object.fromEntries(Object.entries(bundle.tables).map(([k, v]) => [k, v.length])),
    });
    return reply
      .header("content-disposition", `attachment; filename="seokmun-bundle-${id}.json"`)
      .send(bundle);
  });

  app.post("/api/research-sets/import", { bodyLimit: 512 * 1024 * 1024 }, async (req, reply) => {
    const bundle = req.body as SetBundle;
    const digest = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
    const result = importSetBundle(ctx.db, dataDir(), bundle);
    ctx.bm25 = buildSearchIndex(ctx.db);
    auditEvents.record(ctx.db, "IMPORT_BUNDLE", "ResearchSet", bundle.researchSetId, {
      bundleSha256: digest,
      sourceExportedAt: bundle.exportedAt,
      inserted: result.inserted,
      missingFiles: result.missingFiles.length,
    });
    return reply.status(201).send(result);
  });

  // ── 개발용 리셋 (E2E 결정성) ──
  // 명시적 플래그 + dev 인증 모드 + loopback 요청일 때만 동작 (연구실 서버 데이터 보호)
  app.post("/api/dev/reset", async (req, reply) => {
    if (!cfg.enableDevReset || cfg.authMode !== "dev" || !isLoopback(req.ip)) {
      return reply.status(403).send({
        error: "DEV_RESET_DISABLED",
        message:
          "개발용 초기화는 SEOKMUN_ENABLE_DEV_RESET=1 + SEOKMUN_AUTH_MODE=dev + 로컬 요청에서만 허용됩니다",
      });
    }
    wipe(ctx.db);
    seedAll(ctx.db);
    ensureDevUsers(ctx.db);
    ctx.bm25 = buildSearchIndex(ctx.db);
    auditEvents.record(ctx.db, "DEV_RESET", "System", "db", {});
    return { ok: true };
  });

  return app;
}
