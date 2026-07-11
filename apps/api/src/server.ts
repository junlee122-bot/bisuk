import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  inspectUpload,
  jitterPolylines,
  observedPolylines,
  strokeSetSimilarity,
  toPipelineCell,
  type BreakCurve,
  type SeedPriors,
} from "@seokmun/engine";
import { dataDir, openDb, wipe, type Db } from "./db";
import { buildPipelineInput, runAndPersistAnalysis } from "./analysis";
import { defaultUiState, isSeeded, seedAll } from "./seed";
import {
  auditEvents,
  benchmarkCases,
  comparisons,
  crossMatches,
  documents,
  evidenceRepo,
  frontierItems,
  glyphCells,
  hypotheses,
  researchSets,
  sourceRecords,
  steleAssets,
  steleTabs,
} from "./repo";

const ALLOWED_UPLOAD_EXT = new Set(["ply", "stl", "asc", "xyz", "obj", "txt"]);
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

export function buildServer(): FastifyInstance {
  const db = openDb();
  if (!isSeeded(db)) seedAll(db);
  const ctx: Ctx = { db, priors: loadPriors(), bm25: buildSearchIndex(db) };

  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024 * 1024,
  });
  void app.register(cors, { origin: true });

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );

  app.setErrorHandler((rawErr, _req, reply) => {
    if (rawErr instanceof z.ZodError) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "요청 본문이 유효하지 않습니다",
        details: rawErr.issues,
      });
    }
    const err = rawErr as { statusCode?: number; name?: string; message?: string };
    const status = typeof err.statusCode === "number" ? err.statusCode : 500;
    return reply.status(status).send({
      error: err.name ?? "INTERNAL_ERROR",
      message: err.message ?? "internal error",
    });
  });

  const notFound = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }, what: string) =>
    reply.status(404).send({ error: "NOT_FOUND", message: `${what}을(를) 찾을 수 없습니다` });

  // ── 헬스 ──
  app.get("/api/health", async () => ({
    ok: true,
    modelVersion: MODEL_VERSION,
    corpusVersion: CORPUS_VERSION,
  }));

  // ── 연구 세트 ──
  app.get("/api/research-sets", async () => {
    const sets = researchSets.list(ctx.db);
    return sets.map((s) => ({ set: s, stats: setStats(ctx.db, s) }));
  });

  app.post("/api/research-sets", async (req, reply) => {
    const body = CreateResearchSetBody.parse(req.body);
    const now = new Date().toISOString();
    const id = `rs-${Date.now()}`;
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
    const updated: ResearchSet = {
      ...set,
      activeTabOrder: body.activeTabOrder,
      activeTabId: body.activeTabId !== undefined ? body.activeTabId : set.activeTabId,
      pinnedTabIds: body.pinnedTabIds ?? set.pinnedTabIds,
      updatedAt: new Date().toISOString(),
    };
    researchSets.put(ctx.db, updated);
    auditEvents.record(ctx.db, "REORDER_TABS", "ResearchSet", id, {
      order: body.activeTabOrder,
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
    const tabId = `tab-${Date.now()}`;
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
    steleTabs.put(ctx.db, tab);
    researchSets.put(ctx.db, {
      ...set,
      activeTabOrder: [...set.activeTabOrder, tabId],
      updatedAt: now,
    });
    auditEvents.record(ctx.db, "CREATE_TAB", "SteleTab", tabId, { title: body.title });
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
      glyphCells: glyphCells.listByTab(ctx.db, id).map((c) => c.entity),
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
    steleTabs.put(ctx.db, { ...tab, archived: true, updatedAt: new Date().toISOString() });
    auditEvents.record(ctx.db, "ARCHIVE_TAB", "SteleTab", id, {});
    return { ok: true };
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
    return glyphCells.listByTab(ctx.db, id).map((c) => c.entity);
  });

  // ── 자산 업로드 (importer) ──
  app.post("/api/stele-tabs/:id/assets/upload", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(ctx.db, id);
    if (!tab) return notFound(reply, "탭");
    const query = InitUploadBody.omit({ byteSize: true }).parse(req.query);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.status(400).send({
        error: "EMPTY_BODY",
        message: "application/octet-stream 본문으로 파일을 전송해야 합니다",
      });
    }
    const ext = query.filename.toLowerCase().split(".").pop() ?? "";
    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
      return reply.status(400).send({
        error: "UNSUPPORTED_FORMAT",
        message: `지원하지 않는 확장자(${ext}) — PLY/STL/ASC/XYZ/OBJ 만 등록할 수 있습니다`,
      });
    }
    const checksum = createHash("sha256").update(body).digest("hex");
    const assetId = `asset-upload-${Date.now()}`;
    const dir = path.join(dataDir(), "originals", assetId);
    mkdirSync(dir, { recursive: true });
    const storageKey = path.join("originals", assetId, path.basename(query.filename));
    writeFileSync(path.join(dataDir(), storageKey), body, { flag: "wx" });
    const qualityReport = inspectUpload(query.filename, body);
    const asset: SteleAsset = {
      id: assetId,
      steleTabId: id,
      assetType: ext === "asc" || ext === "xyz" ? "POINT_CLOUD" : "MESH",
      provenance: "REAL_USER_UPLOAD",
      demoLabel: null,
      originalFilename: query.filename,
      mimeType: "application/octet-stream",
      format: qualityReport.format,
      byteSize: body.length,
      checksumSha256: checksum,
      sourceRecordId: query.sourceRecordId,
      licenseType: null,
      licenseVerifiedAt: null,
      licenseVerifiedBy: null,
      usagePurpose: query.usagePurpose,
      coordinateSystem: null,
      unit: qualityReport.unitGuess,
      qualityLevel: "FULL",
      isOriginal: true,
      parentAssetId: null,
      processingStatus: "READY",
      rightsState: "VERIFY_REQUIRED",
      qualityReport,
      storageKey,
      meshParams: null,
      createdAt: new Date().toISOString(),
    };
    steleAssets.put(ctx.db, asset);
    auditEvents.record(ctx.db, "UPLOAD_ASSET", "SteleAsset", assetId, {
      filename: query.filename,
      byteSize: body.length,
      checksum,
      usagePurpose: query.usagePurpose,
      rightsState: "VERIFY_REQUIRED",
    });
    return reply.status(201).send(asset);
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
    const updated: SteleAsset = {
      ...asset,
      licenseType: body.licenseType,
      rightsState: body.rightsState,
      licenseVerifiedAt: new Date().toISOString(),
      licenseVerifiedBy: body.verifiedBy,
    };
    steleAssets.put(ctx.db, updated);
    auditEvents.record(ctx.db, "CONFIRM_RIGHTS", "SteleAsset", id, {
      licenseType: body.licenseType,
      rightsState: body.rightsState,
      verifiedBy: body.verifiedBy,
      notes: body.notes,
    });
    return updated;
  });

  // ── 글리프 분석 / Dossier ──
  app.post("/api/glyphs/:id/analyze", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(ctx.db, id);
    if (!stored) return notFound(reply, "문자 셀");
    return runAndPersistAnalysis(ctx.db, stored, ctx.priors);
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
      glyphCell: stored.entity,
      tab,
      conclusion,
      alternates: allHyp.slice(1),
      evidence,
      crossSteleMatches: crossMatches
        .listByCell(ctx.db, id)
        .filter((m) => (runId ? m.id.startsWith(`xm-${runId}-`) : false)),
      sourceGenealogy: buildLineages(uniqueDocs),
      decision: conclusion?.gateResult ?? null,
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
    const rows: GlyphMatrixResponse["rows"] = [];
    let researchSetId = "";
    for (const cellId of body.glyphCellIds) {
      const stored = glyphCells.get(ctx.db, cellId);
      if (!stored) return notFound(reply, `문자 셀 ${cellId}`);
      const sourceTab = steleTabs.get(ctx.db, stored.entity.steleTabId);
      if (!sourceTab) return notFound(reply, "탭");
      researchSetId = sourceTab.researchSetId;
      const sourceObserved = stored.entity.strokes
        ? jitterPolylines(
            observedPolylines(stored.entity.strokes),
            stored.extra.styleJitter ?? 0,
            stored.entity.id
          )
        : [];
      const columns: GlyphMatrixResponse["rows"][number]["columns"] = [];
      for (const tabId of body.tabIds) {
        const tab = steleTabs.get(ctx.db, tabId);
        if (!tab) return notFound(reply, `탭 ${tabId}`);
        const tabCells = glyphCells.listByTab(ctx.db, tabId);
        if (tabId === stored.entity.steleTabId) {
          columns.push({
            tab,
            cells: [
              {
                glyphCell: stored.entity,
                match: null,
                publishedReading: stored.entity.publishedReading,
                dataProvenance: "VIRTUAL_DEMO",
              },
            ],
          });
          continue;
        }
        let best: { cell: (typeof tabCells)[number]; score: number } | null = null;
        for (const candidate of tabCells) {
          if (!candidate.entity.strokes) continue;
          const candObserved = jitterPolylines(
            observedPolylines(candidate.entity.strokes),
            candidate.extra.styleJitter ?? 0,
            candidate.entity.id
          );
          if (sourceObserved.length === 0 || candObserved.length === 0) continue;
          const score = strokeSetSimilarity(sourceObserved, candObserved);
          if (!best || score > best.score) best = { cell: candidate, score };
        }
        if (!best || best.score < 0.2) {
          columns.push({ tab, cells: [{ glyphCell: null, match: null, publishedReading: null, dataProvenance: "VIRTUAL_DEMO" }] });
          continue;
        }
        columns.push({
          tab,
          cells: [
            {
              glyphCell: best.cell.entity,
              match: {
                id: `mx-${cellId}-${best.cell.entity.id}`,
                sourceGlyphCellId: cellId,
                targetGlyphCellId: best.cell.entity.id,
                targetSteleTabId: tabId,
                matchType: "SIMILAR_FORM",
                visualScore: Math.round(best.score * 1000) / 1000,
                geometryScore: 0,
                strokeScore: 0,
                scriptScore: 0,
                periodScore: 0,
                contextScore: 0,
                combinedScore: Math.round(best.score * 1000) / 1000,
                normalizationMethod: "stroke-endpoint-tolerance-10",
                modelVersion: MODEL_VERSION,
                createdAt: new Date().toISOString(),
              },
              publishedReading: best.cell.entity.publishedReading,
              dataProvenance: "VIRTUAL_DEMO",
            },
          ],
        });
      }
      rows.push({ sourceGlyphCell: stored.entity, sourceTab, columns });
    }
    const comparisonId = `cmp-${Date.now()}`;
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
      if (query.stance !== "ALL") {
        const hasStance = doc.extra.claims.some((c) => c.stance === query.stance);
        if (!hasStance) continue;
      }
      if (query.tabId && !doc.entity.relatedTabIds.includes(query.tabId)) continue;
      out.push({
        document: doc.entity,
        score: Math.round(hit.score * 1000) / 1000,
        snippet: hit.snippet,
        matchOffsets: hit.matchOffsets,
        claims: doc.extra.claims,
        benchmarkLeak: Boolean(doc.extra.benchmarkLeak),
      });
      if (out.length >= query.limit) break;
    }
    return out;
  });

  app.get("/api/documents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = documents.get(ctx.db, id);
    if (!doc) return notFound(reply, "문헌");
    return { ...doc.entity, claims: doc.extra.claims };
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
    const tabId = `tab-frontier-${Date.now()}`;
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
    steleTabs.put(ctx.db, tab);
    researchSets.put(ctx.db, {
      ...set,
      activeTabOrder: [...set.activeTabOrder, tabId],
      updatedAt: now,
    });
    const updated = { ...item, promotedTabId: tabId };
    frontierItems.put(ctx.db, updated);
    auditEvents.record(ctx.db, "FRONTIER_PROMOTE", "FrontierWatchItem", id, { tabId });
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
    const cells = tabs.flatMap((t) =>
      glyphCells.listByTab(ctx.db, t.id).map((c) => c.entity)
    );
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
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(req.query);
    return auditEvents.list(ctx.db, query.limit);
  });

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

  // ── 개발용 리셋 (E2E 결정성) ──
  app.post("/api/dev/reset", async (_req, reply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.status(403).send({ error: "FORBIDDEN", message: "운영 환경에서는 사용 불가" });
    }
    wipe(ctx.db);
    seedAll(ctx.db);
    ctx.bm25 = buildSearchIndex(ctx.db);
    auditEvents.record(ctx.db, "DEV_RESET", "System", "db", {});
    return { ok: true };
  });

  return app;
}
