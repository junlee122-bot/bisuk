/**
 * 연구 방법론 API — 서지, 문헌 주장(제안→검수), 문헌 메타데이터 편집, 자형 표본, 이체자, 연대 증거,
 * 평가·보정 프로파일, 분석 실행 스냅샷(재현성), 전역 검색.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  BibliographyEntry,
  BibliographyType,
  CalibrationProfile,
  CharacterExemplar,
  CslName,
  DocumentClaim,
  MODEL_VERSION,
  CORPUS_VERSION,
  type PublicUser,
} from "@seokmun/types";
import {
  CalibrationSampleTooSmallError,
  MIN_CALIBRATION_CASES,
  analyzeGlyphCell,
  bibliographyDedupeKey,
  fitCalibrationProfile,
  formatCitation,
  observedPolylines,
  parseBibliography,
  parseUnihanVariants,
  serializeBibtex,
  serializeRis,
  suggestClaims,
  summarizeEvaluation,
  toCslJson,
  verifyCitation,
  VariantRegistry,
  type EvaluationCase,
  type SeedPriors,
} from "@seokmun/engine";
import { buildPipelineInputV2, summarizeResult } from "./analysis";
import { canAccessSet } from "./auth/policy";
import { currentActor, newId } from "./context";
import type { Db } from "./db";
import { tx } from "./db";
import {
  analysisRuns,
  auditEvents,
  benchmarkCases,
  bibliography,
  calibrationProfiles,
  chronology,
  documentClaims,
  documents,
  exemplars,
  glyphCells,
  readings as readingsRepo,
  researchSets,
  steleTabs,
  variantPairs,
  type StoredGlyphCell,
} from "./repo";

type Reply = FastifyReply;

const notFound = (reply: Reply, what: string) =>
  reply.status(404).send({ error: "NOT_FOUND", message: `${what}을(를) 찾을 수 없습니다` });

const conflict = (reply: Reply, current: unknown) =>
  reply.status(409).send({
    error: "VERSION_CONFLICT",
    message: "다른 사람이 먼저 수정했습니다. 최신 내용을 불러온 뒤 다시 시도하세요.",
    current,
  });

const BibBody = z.object({
  citationKey: z.string().max(200).default(""),
  type: BibliographyType,
  title: z.string().min(1).max(1000),
  author: z.array(CslName).default([]),
  editor: z.array(CslName).default([]),
  issued: z
    .object({ year: z.number().int(), month: z.number().int().min(1).max(12).optional() })
    .nullable()
    .default(null),
  containerTitle: z.string().default(""),
  volume: z.string().default(""),
  issue: z.string().default(""),
  page: z.string().default(""),
  publisher: z.string().default(""),
  publisherPlace: z.string().default(""),
  genre: z.string().default(""),
  DOI: z.string().default(""),
  URL: z.string().default(""),
  ISBN: z.string().default(""),
  language: z.string().default("ko"),
  note: z.string().default(""),
});

const Polylines = z
  .array(z.array(z.tuple([z.number().min(-10).max(110), z.number().min(-10).max(110)])).min(2).max(500))
  .min(1)
  .max(60);

export interface ResearchCtx {
  db: Db;
  priors: SeedPriors;
  /** 문헌·이체자 변경 후 검색 색인 재구축 */
  reindex: () => void;
  searchDocuments: (q: string, limit: number) => Array<{ id: string; score: number; snippet: string }>;
}

/** 평가 사례 수집 — 벤치마크 숨김 정답 + 연구실 채택 판독(사람·출판본, 자동 분석 유래 제외) */
export function collectEvaluationCases(
  db: Db,
  priors: SeedPriors,
  opts: { setId?: string; useCalibration: boolean }
): Array<EvaluationCase & { glyphCellId: string; failedRules: string[] }> {
  const truths = new Map<string, { truth: string; source: EvaluationCase["truthSource"] }>();
  for (const b of benchmarkCases.list(db)) truths.set(b.glyphCellId, { truth: b.hiddenTruth, source: "BENCHMARK" });
  const sets = opts.setId ? [opts.setId] : researchSets.list(db).map((s) => s.id);
  const cellsById = new Map<string, StoredGlyphCell>();
  for (const setId of sets) {
    for (const tab of steleTabs.listBySet(db, setId)) {
      if (tab.archived) continue;
      const byId = new Map(readingsRepo.listByTab(db, tab.id).map((r) => [r.id, r]));
      for (const c of glyphCells.listByTab(db, tab.id)) {
        cellsById.set(c.entity.id, c);
        if (truths.has(c.entity.id) || !c.entity.adoptedReadingId) continue;
        const r = byId.get(c.entity.adoptedReadingId);
        if (!r || r.sourceType === "AUTO_ANALYSIS" || r.readingKind !== "CHARACTER" || !r.reading) continue;
        if (!c.entity.strokes || observedPolylines(c.entity.strokes).length === 0) continue;
        truths.set(c.entity.id, { truth: r.reading, source: "ADOPTED_READING" });
      }
    }
  }
  const out: Array<EvaluationCase & { glyphCellId: string; failedRules: string[] }> = [];
  for (const [cellId, t] of truths) {
    const stored = cellsById.get(cellId) ?? glyphCells.get(db, cellId);
    if (!stored) continue;
    if (opts.setId && !cellsById.has(cellId)) continue;
    const { input } = buildPipelineInputV2(db, stored, priors, { useCalibration: opts.useCalibration });
    const result = analyzeGlyphCell(input);
    const s = summarizeResult(result);
    out.push({
      caseId: cellId,
      glyphCellId: cellId,
      truthSource: t.source,
      truth: t.truth,
      outcome: s.outcome,
      topCandidate: s.topCandidate,
      rawScore: s.rawScore ?? 0,
      confidence: s.calibratedConfidence ?? 0,
      failedRules: s.failedRules,
    });
  }
  return out;
}

export function registerResearchRoutes(app: FastifyInstance, ctx: ResearchCtx): void {
  const { db } = ctx;

  // ── 서지 ──
  app.get("/api/bibliography", async (req) => {
    const q = z.object({ q: z.string().optional() }).parse(req.query);
    const list = bibliography.list(db);
    const needle = q.q?.normalize("NFKC").toLowerCase();
    const filtered = needle
      ? list.filter((b) =>
          [b.title, b.containerTitle, b.citationKey, ...b.author.map((a) => a.literal ?? `${a.family ?? ""} ${a.given ?? ""}`)]
            .join(" ")
            .normalize("NFKC")
            .toLowerCase()
            .includes(needle)
        )
      : list;
    return filtered
      .sort((a, b) => a.title.localeCompare(b.title, "ko"))
      .map((b) => ({ ...b, formatted: formatCitation(b) }));
  });

  app.get("/api/bibliography/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = bibliography.get(db, id);
    if (!b) return notFound(reply, "서지");
    const locator = z.object({ locator: z.string().default("") }).parse(req.query).locator;
    return {
      ...b,
      formatted: formatCitation(b, locator),
      usedByReadings: (db.prepare("SELECT COUNT(*) AS n FROM readings WHERE json_extract(data,'$.bibliographyId') = ?").get(id) as { n: number }).n,
      usedByDocuments: documents.list(db).filter((d) => d.entity.bibliographyId === id).map((d) => d.entity.id),
    };
  });

  app.post("/api/bibliography", async (req, reply) => {
    const body = BibBody.parse(req.body);
    const now = new Date().toISOString();
    const entry: BibliographyEntry = { ...body, id: newId("bib"), createdBy: currentActor().name, createdAt: now, updatedAt: now };
    const key = bibliographyDedupeKey(entry);
    const dup = bibliography.list(db).find((b) => bibliographyDedupeKey(b) === key);
    if (dup) {
      return reply.status(409).send({ error: "DUPLICATE_BIBLIOGRAPHY", message: "같은 DOI 또는 제목·연도의 서지가 이미 있습니다", existing: dup });
    }
    bibliography.put(db, entry);
    auditEvents.record(db, "BIBLIOGRAPHY_CREATE", "BibliographyEntry", entry.id, { title: entry.title });
    return reply.status(201).send(entry);
  });

  app.patch("/api/bibliography/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = bibliography.get(db, id);
    if (!current) return notFound(reply, "서지");
    const body = BibBody.partial().extend({ expectedUpdatedAt: z.string().optional() }).parse(req.body);
    if (body.expectedUpdatedAt && body.expectedUpdatedAt !== current.updatedAt) return conflict(reply, current);
    const { expectedUpdatedAt: _e, ...patch } = body;
    const next = BibliographyEntry.parse({ ...current, ...patch, updatedAt: new Date().toISOString() });
    bibliography.put(db, next);
    auditEvents.record(db, "BIBLIOGRAPHY_UPDATE", "BibliographyEntry", id, { fields: Object.keys(patch) });
    return next;
  });

  app.delete("/api/bibliography/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = bibliography.get(db, id);
    if (!current) return notFound(reply, "서지");
    const usedReadings = (db.prepare("SELECT COUNT(*) AS n FROM readings WHERE json_extract(data,'$.bibliographyId') = ?").get(id) as { n: number }).n;
    const usedDocs = documents.list(db).filter((d) => d.entity.bibliographyId === id).length;
    if (usedReadings + usedDocs > 0) {
      return reply.status(409).send({
        error: "BIBLIOGRAPHY_IN_USE",
        message: `판독 ${usedReadings}건·문헌 ${usedDocs}건이 이 서지를 참조합니다. 연결을 먼저 해제하세요.`,
      });
    }
    bibliography.delete(db, id);
    auditEvents.record(db, "BIBLIOGRAPHY_DELETE", "BibliographyEntry", id, { title: current.title });
    return { ok: true };
  });

  app.post("/api/bibliography/import", { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const body = z
      .object({
        text: z.string().min(1),
        format: z.enum(["bibtex", "ris", "csl-json"]).optional(),
        dryRun: z.boolean().default(false),
      })
      .parse(req.body);
    const parsed = parseBibliography(body.text, body.format);
    if (!parsed.format) return reply.status(422).send({ error: "UNKNOWN_FORMAT", message: parsed.warnings[0] });
    const existingKeys = new Map(bibliography.list(db).map((b) => [bibliographyDedupeKey(b), b.id]));
    const now = new Date().toISOString();
    const created: BibliographyEntry[] = [];
    const duplicates: Array<{ title: string; existingId: string }> = [];
    for (const d of parsed.entries) {
      const key = bibliographyDedupeKey(d);
      const existing = existingKeys.get(key);
      if (existing) {
        duplicates.push({ title: d.title, existingId: existing });
        continue;
      }
      const entry: BibliographyEntry = { ...d, id: newId("bib"), createdBy: currentActor().name, createdAt: now, updatedAt: now };
      existingKeys.set(key, entry.id);
      created.push(entry);
    }
    if (!body.dryRun) {
      tx(db, () => {
        for (const e of created) bibliography.put(db, e);
        auditEvents.record(db, "BIBLIOGRAPHY_IMPORT", "BibliographyEntry", "batch", {
          format: parsed.format,
          created: created.length,
          duplicates: duplicates.length,
          warnings: parsed.warnings.length,
        });
      });
    }
    return { format: parsed.format, dryRun: body.dryRun, created, duplicates, warnings: parsed.warnings };
  });

  app.get("/api/bibliography-export", async (req, reply) => {
    const q = z
      .object({ format: z.enum(["bibtex", "ris", "csl-json"]), ids: z.string().optional() })
      .parse(req.query);
    const ids = q.ids ? new Set(q.ids.split(",")) : null;
    const list = bibliography.list(db).filter((b) => !ids || ids.has(b.id));
    const [content, type, ext] =
      q.format === "bibtex"
        ? [serializeBibtex(list), "application/x-bibtex", "bib"]
        : q.format === "ris"
          ? [serializeRis(list), "application/x-research-info-systems", "ris"]
          : [JSON.stringify(toCslJson(list), null, 2), "application/vnd.citationstyles.csl+json", "json"];
    return reply
      .header("content-type", `${type}; charset=utf-8`)
      .header("content-disposition", `attachment; filename="seokmun-bibliography.${ext}"`)
      .send(content);
  });

  // ── 문헌 메타데이터 ──
  const DocPatch = z.object({
    title: z.string().min(1).optional(),
    publisher: z.string().optional(),
    publishedAt: z.string().optional(),
    language: z.string().optional(),
    reliabilityTier: z.number().int().min(1).max(7).optional(),
    independenceGroup: z.string().min(1).optional(),
    derivedFromDocumentId: z.string().nullable().optional(),
    bibliographyId: z.string().nullable().optional(),
    relatedTabIds: z.array(z.string()).optional(),
    content: z.string().min(10).optional(),
  });

  app.get("/api/documents", async () =>
    documents.list(db).map((d) => ({
      id: d.entity.id,
      title: d.entity.title,
      docType: d.entity.docType,
      publisher: d.entity.publisher,
      publishedAt: d.entity.publishedAt,
      isFictional: d.entity.isFictional,
      reliabilityTier: d.entity.reliabilityTier,
      independenceGroup: d.entity.independenceGroup,
      derivedFromDocumentId: d.entity.derivedFromDocumentId,
      bibliographyId: d.entity.bibliographyId,
      relatedTabIds: d.entity.relatedTabIds,
      claimCount: documentClaims.listByDocument(db, d.entity.id).length,
      benchmarkLeak: Boolean(d.extra.benchmarkLeak),
    }))
  );

  app.patch("/api/documents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = documents.get(db, id);
    if (!current) return notFound(reply, "문헌");
    const patch = DocPatch.parse(req.body);
    if (patch.bibliographyId && !bibliography.get(db, patch.bibliographyId)) return notFound(reply, "서지");
    if (patch.derivedFromDocumentId) {
      // 파생 관계 순환 금지
      const all = new Map(documents.list(db).map((d) => [d.entity.id, d.entity]));
      if (!all.has(patch.derivedFromDocumentId)) return notFound(reply, "원 문헌");
      let cur: string | null = patch.derivedFromDocumentId;
      const seen = new Set<string>();
      while (cur) {
        if (cur === id) {
          return reply.status(422).send({ error: "DERIVATION_CYCLE", message: "파생 관계가 순환합니다" });
        }
        if (seen.has(cur)) break;
        seen.add(cur);
        cur = all.get(cur)?.derivedFromDocumentId ?? null;
      }
    }
    const next = { ...current, entity: { ...current.entity, ...patch } };
    documents.put(db, next);
    if (patch.content !== undefined || patch.title !== undefined) ctx.reindex();
    auditEvents.record(db, "DOCUMENT_UPDATE", "CorpusDocument", id, { fields: Object.keys(patch) });
    return next.entity;
  });

  app.delete("/api/documents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = documents.get(db, id);
    if (!current) return notFound(reply, "문헌");
    const derived = documents.list(db).filter((d) => d.entity.derivedFromDocumentId === id);
    if (derived.length > 0) {
      return reply.status(409).send({
        error: "DOCUMENT_HAS_DERIVATIVES",
        message: `이 문헌에서 파생된 문헌 ${derived.length}건이 있습니다. 파생 관계를 먼저 정리하세요.`,
      });
    }
    tx(db, () => {
      for (const c of documentClaims.listByDocument(db, id)) documentClaims.delete(db, c.id);
      db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      auditEvents.record(db, "DOCUMENT_DELETE", "CorpusDocument", id, { title: current.entity.title });
    });
    ctx.reindex();
    return { ok: true };
  });

  // ── 문헌 주장(claim) ──
  const ClaimBody = z.object({
    targetGlyphCellId: z.string().min(1),
    character: z.string().min(1).max(4),
    stance: z.enum(["SUPPORT", "COUNTER"]),
    quote: z.string().min(1).max(2000),
    locator: z.string().max(200).default(""),
  });

  function claimTargetOk(cellId: string): StoredGlyphCell | null {
    return glyphCells.get(db, cellId);
  }

  app.get("/api/documents/:id/claims", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = documents.get(db, id);
    if (!doc) return notFound(reply, "문헌");
    return documentClaims.listByDocument(db, id).map((c) => ({
      ...c,
      check: verifyCitation(doc.entity.content, c.quote),
    }));
  });

  app.get("/api/glyphs/:id/claims", async (req) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(db, id);
    const keys = [id, stored?.extra.seedKey].filter(Boolean) as string[];
    return keys.flatMap((k) => documentClaims.listByCell(db, k));
  });

  app.post("/api/documents/:id/claims", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = documents.get(db, id);
    if (!doc) return notFound(reply, "문헌");
    const body = ClaimBody.parse(req.body);
    const cell = claimTargetOk(body.targetGlyphCellId);
    if (!cell) return notFound(reply, "대상 문자 셀");
    const check = verifyCitation(doc.entity.content, body.quote, {
      target: { character: body.character, lineIndex: cell.entity.lineIndex, sequenceIndex: cell.entity.sequenceIndex },
    });
    if (!check.verified) {
      return reply.status(422).send({ error: "CITATION_NOT_VERIFIED", message: check.reason, check });
    }
    const claim: DocumentClaim = {
      id: newId("claim"),
      documentId: id,
      ...body,
      // 사람이 문헌을 보고 직접 입력한 주장은 입력자 검수로 간주
      status: "CONFIRMED",
      origin: "MANUAL",
      createdBy: currentActor().name,
      reviewedBy: currentActor().name,
      createdAt: new Date().toISOString(),
    };
    documentClaims.put(db, claim);
    auditEvents.record(db, "CLAIM_CREATE", "DocumentClaim", claim.id, {
      documentId: id,
      targetGlyphCellId: claim.targetGlyphCellId,
      character: claim.character,
      stance: claim.stance,
      matchType: check.matchType,
    });
    return reply.status(201).send({ ...claim, check });
  });

  app.post("/api/documents/:id/claims/suggest", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = documents.get(db, id);
    if (!doc) return notFound(reply, "문헌");
    const body = z.object({ tabId: z.string(), save: z.boolean().default(true) }).parse(req.body);
    const tab = steleTabs.get(db, body.tabId);
    if (!tab) return notFound(reply, "탭");
    if (!canAccessSet(db, req.user, tab.researchSetId, "RESEARCHER")) {
      return reply.status(403).send({ error: "SET_ACCESS_DENIED", message: "이 연구 세트에 대한 권한이 없습니다" });
    }
    const cells = glyphCells.listByTab(db, tab.id).map((c) => ({
      id: c.entity.id,
      lineIndex: c.entity.lineIndex,
      sequenceIndex: c.entity.sequenceIndex,
    }));
    const suggestions = suggestClaims(doc.entity.content, cells);
    const existing = documentClaims.listByDocument(db, id);
    const fresh = suggestions.filter(
      (s) =>
        !existing.some(
          (e) => e.targetGlyphCellId === s.targetGlyphCellId && e.character === s.character && e.quote === s.quote
        )
    );
    const now = new Date().toISOString();
    const saved: DocumentClaim[] = fresh.map((s) => ({
      id: newId("claim"),
      documentId: id,
      targetGlyphCellId: s.targetGlyphCellId,
      character: s.character,
      stance: s.stance,
      quote: s.quote,
      locator: "",
      status: "SUGGESTED",
      origin: "AUTO_SUGGESTED",
      createdBy: currentActor().name,
      reviewedBy: null,
      createdAt: now,
    }));
    if (body.save && saved.length > 0) {
      tx(db, () => {
        for (const c of saved) documentClaims.put(db, c);
        auditEvents.record(db, "CLAIM_SUGGEST", "CorpusDocument", id, { tabId: tab.id, suggested: saved.length });
      });
    }
    return {
      suggestions: saved.map((c, i) => ({ ...c, reason: fresh[i]!.reason, confidence: fresh[i]!.confidence })),
      skippedExisting: suggestions.length - fresh.length,
      note: "자동 제안은 SUGGESTED 상태이며, 연구원이 확인하기 전에는 분석 근거로 쓰이지 않습니다.",
    };
  });

  const reviewClaim = (status: "CONFIRMED" | "REJECTED") => async (req: { params: unknown }, reply: Reply) => {
    const { id } = req.params as { id: string };
    const c = documentClaims.get(db, id);
    if (!c) return notFound(reply, "문헌 주장");
    if (status === "CONFIRMED") {
      const doc = documents.get(db, c.documentId);
      if (!doc) return notFound(reply, "문헌");
      const check = verifyCitation(doc.entity.content, c.quote);
      if (!check.verified) return reply.status(422).send({ error: "CITATION_NOT_VERIFIED", message: check.reason });
    }
    const next: DocumentClaim = { ...c, status, reviewedBy: currentActor().name };
    documentClaims.put(db, next);
    auditEvents.record(db, status === "CONFIRMED" ? "CLAIM_CONFIRM" : "CLAIM_REJECT", "DocumentClaim", id, {
      documentId: c.documentId,
      character: c.character,
    });
    return next;
  };
  app.post("/api/claims/:id/confirm", reviewClaim("CONFIRMED"));
  app.post("/api/claims/:id/reject", reviewClaim("REJECTED"));

  app.patch("/api/claims/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = documentClaims.get(db, id);
    if (!c) return notFound(reply, "문헌 주장");
    const patch = ClaimBody.partial().parse(req.body);
    const doc = documents.get(db, c.documentId);
    if (patch.quote && doc) {
      const check = verifyCitation(doc.entity.content, patch.quote);
      if (!check.verified) return reply.status(422).send({ error: "CITATION_NOT_VERIFIED", message: check.reason });
    }
    // 내용이 바뀌면 다시 검수 대기 (사람이 직접 고친 경우 입력자 검수)
    const next: DocumentClaim = DocumentClaim.parse({ ...c, ...patch, reviewedBy: currentActor().name, status: c.status === "REJECTED" ? "SUGGESTED" : c.status });
    documentClaims.put(db, next);
    auditEvents.record(db, "CLAIM_UPDATE", "DocumentClaim", id, { fields: Object.keys(patch) });
    return next;
  });

  app.delete("/api/claims/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = documentClaims.get(db, id);
    if (!c) return notFound(reply, "문헌 주장");
    documentClaims.delete(db, id);
    auditEvents.record(db, "CLAIM_DELETE", "DocumentClaim", id, { documentId: c.documentId });
    return { ok: true };
  });

  // ── 자형 표본 ──
  app.get("/api/exemplars", async (req) => {
    const q = z.object({ character: z.string().optional() }).parse(req.query);
    return q.character ? exemplars.listByChar(db, q.character) : exemplars.list(db);
  });

  app.post("/api/exemplars", async (req, reply) => {
    const body = z
      .object({
        character: z.string().min(1).max(4),
        polylines: Polylines,
        sourceLabel: z.string().max(300).default(""),
        period: z.string().max(100).default(""),
      })
      .parse(req.body);
    const e: CharacterExemplar = CharacterExemplar.parse({
      ...body,
      id: newId("exm"),
      sourceGlyphCellId: null,
      createdBy: currentActor().name,
      createdAt: new Date().toISOString(),
    });
    exemplars.put(db, e);
    auditEvents.record(db, "EXEMPLAR_CREATE", "CharacterExemplar", e.id, { character: e.character, strokes: e.polylines.length });
    return reply.status(201).send(e);
  });

  /** 판독이 확정된 셀의 추적 획으로 표본 등록 — 마모 획은 제외하지 않고 전체 획을 쓴다 */
  app.post("/api/glyphs/:id/exemplar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(db, id);
    if (!stored) return notFound(reply, "문자 셀");
    if (stored.extra.hiddenBenchmark) {
      return reply.status(409).send({ error: "BENCHMARK_CELL", message: "벤치마크 셀은 표본으로 쓸 수 없습니다 (정답 누출)" });
    }
    const body = z.object({ character: z.string().min(1).max(4), sourceLabel: z.string().default(""), period: z.string().default("") }).parse(req.body);
    const strokes = stored.entity.strokes;
    const observed = strokes ? observedPolylines(strokes) : [];
    if (observed.length === 0) {
      return reply.status(422).send({ error: "NO_STROKES", message: "추적된 관측 획이 없습니다. 먼저 획을 추적하세요." });
    }
    const tab = steleTabs.get(db, stored.entity.steleTabId);
    const e: CharacterExemplar = {
      id: newId("exm"),
      character: body.character,
      polylines: observed,
      sourceLabel: body.sourceLabel || `${tab?.title ?? stored.entity.steleTabId} ${stored.entity.lineIndex}행 ${stored.entity.sequenceIndex}자`,
      sourceGlyphCellId: id,
      period: body.period || tab?.periodEstimate || "",
      createdBy: currentActor().name,
      createdAt: new Date().toISOString(),
    };
    exemplars.put(db, e);
    auditEvents.record(db, "EXEMPLAR_CREATE", "CharacterExemplar", e.id, { character: e.character, fromCell: id });
    return reply.status(201).send(e);
  });

  app.delete("/api/exemplars/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT data FROM exemplars WHERE id = ?").get(id) as { data: string } | undefined;
    if (!row) return notFound(reply, "표본");
    exemplars.delete(db, id);
    auditEvents.record(db, "EXEMPLAR_DELETE", "CharacterExemplar", id, {});
    return { ok: true };
  });

  // ── 이체자 ──
  app.get("/api/variant-pairs", async (req) => {
    const q = z.object({ character: z.string().optional() }).parse(req.query);
    const pairs = variantPairs.list(db);
    if (!q.character) return { count: pairs.length, pairs: pairs.slice(0, 500) };
    const reg = new VariantRegistry(pairs);
    return {
      count: pairs.length,
      character: q.character,
      variants: reg.expand(q.character),
      pairs: pairs.filter((p) => p.a === q.character || p.b === q.character),
    };
  });

  app.post("/api/variant-pairs", async (req) => {
    const body = z
      .object({
        pairs: z
          .array(z.object({ a: z.string().min(1).max(4), b: z.string().min(1).max(4), kind: z.string().default("LAB"), source: z.string().default("") }))
          .min(1)
          .max(5000),
      })
      .parse(req.body);
    const inserted = variantPairs.putMany(
      db,
      body.pairs.filter((p) => p.a !== p.b).map((p) => ({ ...p, source: p.source || currentActor().name }))
    );
    auditEvents.record(db, "VARIANTS_ADD", "VariantPair", "batch", { requested: body.pairs.length, inserted });
    ctx.reindex();
    return { inserted };
  });

  app.post("/api/variant-pairs/import-unihan", { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const body = z.object({ text: z.string().min(1) }).parse(req.body);
    const { pairs, skipped } = parseUnihanVariants(body.text);
    const inserted = variantPairs.putMany(db, pairs);
    auditEvents.record(db, "VARIANTS_IMPORT_UNIHAN", "VariantPair", "batch", { parsed: pairs.length, inserted, skipped });
    ctx.reindex();
    return { parsed: pairs.length, inserted, skipped };
  });

  app.delete("/api/variant-pairs", async (req) => {
    const body = z.object({ a: z.string(), b: z.string(), kind: z.string() }).parse(req.body);
    variantPairs.delete(db, body);
    auditEvents.record(db, "VARIANTS_DELETE", "VariantPair", `${body.a}-${body.b}`, body);
    ctx.reindex();
    return { ok: true };
  });

  // ── 연대 증거 ──
  app.get("/api/chronology", async () => chronology.list(db));

  app.put("/api/chronology/:character", async (req) => {
    const { character } = req.params as { character: string };
    const body = z.object({ earliestYear: z.number().int().min(-3000).max(3000), source: z.string().min(1).max(500) }).parse(req.body);
    chronology.put(db, { character, ...body });
    auditEvents.record(db, "CHRONOLOGY_SET", "ChronologyAttestation", character, body);
    return { character, ...body };
  });

  app.delete("/api/chronology/:character", async (req) => {
    const { character } = req.params as { character: string };
    chronology.delete(db, character);
    auditEvents.record(db, "CHRONOLOGY_DELETE", "ChronologyAttestation", character, {});
    return { ok: true };
  });

  // ── 평가·보정 ──
  app.post("/api/evaluation/v2", async (req) => {
    const body = z.object({ setId: z.string().optional() }).parse(req.body ?? {});
    const cases = collectEvaluationCases(db, ctx.priors, { ...(body.setId ? { setId: body.setId } : {}), useCalibration: true });
    const summary = summarizeEvaluation(cases);
    const active = calibrationProfiles.getActive(db);
    auditEvents.record(db, "EVALUATION_RUN_V2", "EvaluationSuite", body.setId ?? "all", {
      n: summary.n,
      bySource: summary.bySource,
      autoAccepted: summary.autoAccepted,
      calibrationProfileId: active?.id ?? null,
    });
    return {
      summary,
      cases,
      calibrationProfile: active,
      minCasesForCalibration: MIN_CALIBRATION_CASES,
      modelVersion: MODEL_VERSION,
      corpusVersion: CORPUS_VERSION,
      note:
        "정답 출처: 벤치마크 숨김 정답(가상) + 연구실이 채택한 판독(연구원·출판 판독문, 자동 분석 유래 제외). 비율은 Wilson 95% 구간과 함께 읽으십시오.",
    };
  });

  app.get("/api/calibration/profiles", async () => {
    const active = calibrationProfiles.getActive(db);
    return calibrationProfiles.list(db).map((p) => ({ ...p, active: p.id === active?.id }));
  });

  app.post("/api/calibration/fit", async (req, reply) => {
    const body = z
      .object({ method: z.enum(["ISOTONIC", "PLATT"]).default("ISOTONIC"), setId: z.string().optional(), activate: z.boolean().default(false), note: z.string().default("") })
      .parse(req.body ?? {});
    const cases = collectEvaluationCases(db, ctx.priors, { ...(body.setId ? { setId: body.setId } : {}), useCalibration: false });
    try {
      const profile: CalibrationProfile = fitCalibrationProfile(
        cases.map((c) => ({ score: c.rawScore, label: c.topCandidate === c.truth ? 1 : 0 })),
        body.method,
        {
          id: newId("calib"),
          fittedBy: currentActor().name,
          fittedAt: new Date().toISOString(),
          note: body.note || `평가 사례 ${cases.length}건 (${[...new Set(cases.map((c) => c.truthSource))].join("+")})`,
        }
      );
      calibrationProfiles.put(db, profile, body.activate);
      auditEvents.record(db, "CALIBRATION_FIT", "CalibrationProfile", profile.id, {
        method: profile.method,
        n: profile.n,
        ece: profile.ece,
        activated: body.activate,
      });
      return reply.status(201).send({ profile, active: body.activate });
    } catch (e) {
      if (e instanceof CalibrationSampleTooSmallError) {
        return reply.status(422).send({ error: "INSUFFICIENT_CASES", message: e.message, n: e.n, required: MIN_CALIBRATION_CASES });
      }
      throw e;
    }
  });

  app.post("/api/calibration/:id/activate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = calibrationProfiles.list(db).find((x) => x.id === id);
    if (!p) return notFound(reply, "보정 프로파일");
    calibrationProfiles.put(db, p, true);
    auditEvents.record(db, "CALIBRATION_ACTIVATE", "CalibrationProfile", id, { method: p.method, n: p.n });
    return { ok: true, active: id };
  });

  app.post("/api/calibration/deactivate", async () => {
    calibrationProfiles.deactivateAll(db);
    auditEvents.record(db, "CALIBRATION_DEACTIVATE", "CalibrationProfile", "all", {});
    return { ok: true };
  });

  // ── 분석 실행 스냅샷 (재현성) ──
  app.get("/api/glyphs/:id/runs", async (req) => {
    const { id } = req.params as { id: string };
    return analysisRuns.listByCell(db, id);
  });

  app.get("/api/analysis-runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = analysisRuns.get(db, id);
    if (!run) return notFound(reply, "분석 실행");
    return run;
  });

  /** 같은 셀을 현재 데이터로 다시 돌려(저장 없이) 입력·결과가 어떻게 달라졌는지 비교 */
  app.post("/api/analysis-runs/:id/rerun", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = analysisRuns.get(db, id);
    if (!run) return notFound(reply, "분석 실행");
    const stored = glyphCells.get(db, run.glyphCellId);
    if (!stored) return notFound(reply, "문자 셀");
    const built = buildPipelineInputV2(db, stored, ctx.priors);
    const result = analyzeGlyphCell(built.input);
    const now = summarizeResult(result);
    const before = (run.inputSnapshot as { componentHashes?: Record<string, string>; summary?: ReturnType<typeof summarizeResult> }) ?? {};
    const prevHashes = before.componentHashes ?? {};
    const changedComponents = Object.keys({ ...prevHashes, ...built.componentHashes }).filter(
      (k) => prevHashes[k] !== built.componentHashes[k]
    );
    return {
      run,
      current: { inputHash: built.inputHash, componentHashes: built.componentHashes, summary: now },
      sameInput: built.inputHash === run.inputHash,
      changedComponents,
      sameOutcome: now.outcome === run.outcome && now.topCandidate === run.topCandidate,
      reproduced: built.inputHash === run.inputHash && now.outcome === run.outcome && now.topCandidate === run.topCandidate,
    };
  });

  // ── 전역 검색 (Ctrl+K) ──
  app.get("/api/search", async (req) => {
    const q = z
      .object({ q: z.string().min(1).max(200), setId: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(8) })
      .parse(req.query);
    const needle = q.q.normalize("NFKC").trim().toLowerCase();
    const user = req.user as PublicUser | null;
    const sets = researchSets.list(db).filter((s) => (!q.setId || s.id === q.setId) && canAccessSet(db, user, s.id, "GUEST"));
    const tabs: Array<{ id: string; setId: string; title: string; match: string }> = [];
    const cells: Array<{ id: string; tabId: string; setId: string; label: string; reading: string; status: string }> = [];
    const readingHits: Array<{ id: string; cellId: string; tabId: string; setId: string; token: string; author: string; status: string }> = [];
    const hasHan = /\p{Script=Han}/u.test(needle);
    const chars = hasHan ? [...needle].filter((c) => /\p{Script=Han}/u.test(c)) : [];
    for (const set of sets) {
      for (const tab of steleTabs.listBySet(db, set.id)) {
        if (tab.archived) continue;
        const hay = [tab.title, tab.canonicalName, ...tab.alternativeNames, tab.location, tab.periodEstimate].join(" ").toLowerCase();
        if (hay.includes(needle) && tabs.length < q.limit) tabs.push({ id: tab.id, setId: set.id, title: tab.title, match: tab.canonicalName });
        if (!hasHan) continue;
        const rs = readingsRepo.listByTab(db, tab.id);
        const byId = new Map(rs.map((r) => [r.id, r]));
        for (const c of glyphCells.listByTab(db, tab.id)) {
          if (c.extra.hiddenBenchmark && !c.entity.adoptedReadingId) continue;
          const adopted = c.entity.adoptedReadingId ? byId.get(c.entity.adoptedReadingId)?.reading : null;
          const reading = adopted ?? c.entity.publishedReading ?? "";
          if (reading && chars.includes(reading) && cells.length < q.limit * 3) {
            cells.push({
              id: c.entity.id,
              tabId: tab.id,
              setId: set.id,
              label: `${tab.title} ${c.entity.lineIndex}행 ${c.entity.sequenceIndex}자`,
              reading,
              status: c.entity.readingStatus,
            });
          }
        }
        for (const r of rs) {
          if (r.reading && chars.includes(r.reading) && readingHits.length < q.limit) {
            readingHits.push({ id: r.id, cellId: r.glyphCellId, tabId: tab.id, setId: set.id, token: r.reading, author: r.sourceLabel || r.authorName, status: r.reviewStatus });
          }
        }
      }
    }
    const docs = ctx.searchDocuments(q.q, q.limit).map((h) => {
      const d = documents.get(db, h.id);
      return { id: h.id, title: d?.entity.title ?? h.id, snippet: h.snippet, score: Math.round(h.score * 1000) / 1000, isFictional: d?.entity.isFictional ?? false };
    });
    const bib = bibliography
      .list(db)
      .filter((b) =>
        [b.title, b.containerTitle, b.citationKey, ...b.author.map((a) => a.literal ?? `${a.family ?? ""} ${a.given ?? ""}`)]
          .join(" ")
          .normalize("NFKC")
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, q.limit)
      .map((b) => ({ id: b.id, title: b.title, formatted: formatCitation(b) }));
    return { query: q.q, tabs, cells: cells.slice(0, q.limit * 3), readings: readingHits, documents: docs, bibliography: bib };
  });
}
