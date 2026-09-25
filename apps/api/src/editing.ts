/**
 * 편집 API — 실제 비석을 처음부터 등록·판독할 수 있게 하는 입력 경로.
 * 모든 수정은 변경 전 스냅샷(entity_versions)과 감사 로그를 남기고,
 * expectedVersion(낙관적 잠금)이 어긋나면 409로 동시 수정 충돌을 알린다.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  AssetMode,
  FrontierStatus,
  GlyphStrokes,
  ReadingStatus,
  RightsState,
  TabRole,
  type FrontierWatchItem,
  type GlyphCell,
  type Reading,
  type SourceRecord,
  type SteleAsset,
  type SteleTab,
} from "@seokmun/types";
import {
  featureVector,
  layoutTranscriptionGrid,
  observedPolylines,
  parseTranscription,
  transcriptionCellStatus,
  type Polyline,
} from "@seokmun/engine";
import { newId } from "./context";
import type { Db } from "./db";
import { tx } from "./db";
import {
  auditEvents,
  bibliography,
  comments,
  documentClaims,
  entityVersions,
  frontierItems,
  glyphCells,
  readings,
  sourceRecords,
  steleAssets,
  steleTabs,
  type StoredGlyphCell,
} from "./repo";
import { sanitizeCell } from "./sanitize";

type Reply = FastifyReply;

const notFound = (reply: Reply, what: string) =>
  reply.status(404).send({ error: "NOT_FOUND", message: `${what}을(를) 찾을 수 없습니다` });

const conflict = (reply: Reply, current: unknown) =>
  reply.status(409).send({
    error: "VERSION_CONFLICT",
    message: "다른 사람이 먼저 수정했습니다. 최신 내용을 불러온 뒤 다시 시도하세요.",
    current,
  });

/** 자동 분석 결과로만 설정되는 상태 — 사람이 직접 지정하지 못한다 */
const MANUAL_STATUSES = ["OBSERVED", "PARTIALLY_OBSERVED", "ILLEGIBLE", "UNKNOWN", "TEXTUAL_SUPPLEMENT"] as const;

const BBox = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export function registerEditingRoutes(app: FastifyInstance, db: Db): void {
  const snapshot = (entityType: string, id: string, version: number, data: unknown, action: string, reason = "") =>
    entityVersions.record(db, entityType, id, version, data as Record<string, unknown>, action, reason);

  // ── 탭 메타데이터 ──
  const TabPatch = z
    .object({
      title: z.string().min(1).max(200),
      canonicalName: z.string().max(300),
      alternativeNames: z.array(z.string().max(200)).max(50),
      roles: z.array(TabRole).min(1),
      assetMode: AssetMode,
      periodEstimate: z.string().max(200),
      location: z.string().max(300),
      material: z.string().max(200),
      scriptType: z.string().max(200),
      writingDirection: z.string().max(100),
      rightsState: RightsState,
      questions: z.array(z.string().max(1000)).max(100),
      knownFacts: z.array(z.string().max(1000)).max(200),
      restrictions: z.array(z.string().max(1000)).max(100),
      preliminaryClaims: z.array(z.string().max(1000)).max(100),
      warnings: z.array(z.string().max(1000)).max(100),
    })
    .partial()
    .extend({ expectedUpdatedAt: z.string().optional(), reason: z.string().max(500).optional() });

  app.patch("/api/stele-tabs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(db, id);
    if (!tab) return notFound(reply, "탭");
    const { expectedUpdatedAt, reason, ...patch } = TabPatch.parse(req.body);
    if (expectedUpdatedAt && expectedUpdatedAt !== tab.updatedAt) return conflict(reply, tab);
    if (patch.rightsState && patch.rightsState !== tab.rightsState && req.user?.role !== "PI") {
      return reply.status(403).send({ error: "FORBIDDEN", message: "탭 권리 상태 변경은 PI만 할 수 있습니다" });
    }
    const updated: SteleTab = { ...tab, ...patch, updatedAt: new Date().toISOString() };
    tx(db, () => {
      snapshot("SteleTab", id, versionOf(db, "SteleTab", id), tab, "UPDATE_TAB", reason ?? "");
      steleTabs.put(db, updated);
      auditEvents.record(db, "UPDATE_TAB", "SteleTab", id, { fields: Object.keys(patch) });
    });
    return updated;
  });

  // ── 출처 레코드 ──
  const SourceBody = z.object({
    type: z.string().min(1).max(100),
    publisher: z.string().min(1).max(300),
    url: z
      .string()
      .max(2000)
      .refine((u) => u === "" || /^https?:\/\//i.test(u), "http(s) URL만 허용합니다"),
    expectedFormats: z.array(z.string().max(50)).max(30).default([]),
    acquisition: z.string().max(1000).default("사용자 직접 확인 (자동 수집 없음)"),
    rightsState: RightsState.default("VERIFY_REQUIRED"),
    reliabilityTier: z.number().int().min(1).max(7).default(4),
    independenceGroup: z.string().max(200).default(""),
    retrievedAt: z.string().nullable().default(null),
    notes: z.string().max(5000).default(""),
  });

  app.post("/api/stele-tabs/:id/source-records", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!steleTabs.get(db, id)) return notFound(reply, "탭");
    const body = SourceBody.parse(req.body);
    const rec: SourceRecord = { id: newId("src"), steleTabId: id, ...body };
    tx(db, () => {
      sourceRecords.put(db, rec);
      auditEvents.record(db, "CREATE_SOURCE_RECORD", "SourceRecord", rec.id, { tabId: id, publisher: rec.publisher });
    });
    return reply.status(201).send(rec);
  });

  app.patch("/api/source-records/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = sourceRecords.get(db, id);
    if (!rec) return notFound(reply, "출처 레코드");
    const patch = SourceBody.partial().parse(req.body);
    if (patch.rightsState && patch.rightsState !== rec.rightsState && req.user?.role !== "PI") {
      return reply.status(403).send({ error: "FORBIDDEN", message: "출처 권리 상태 변경은 PI만 할 수 있습니다" });
    }
    const updated: SourceRecord = { ...rec, ...patch };
    tx(db, () => {
      snapshot("SourceRecord", id, versionOf(db, "SourceRecord", id), rec, "UPDATE_SOURCE_RECORD");
      sourceRecords.put(db, updated);
      auditEvents.record(db, "UPDATE_SOURCE_RECORD", "SourceRecord", id, { fields: Object.keys(patch) });
    });
    return updated;
  });

  app.delete("/api/source-records/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = sourceRecords.get(db, id);
    if (!rec) return notFound(reply, "출처 레코드");
    const used = steleAssets.listByTab(db, rec.steleTabId).filter((a) => a.sourceRecordId === id);
    if (used.length > 0) {
      return reply.status(409).send({
        error: "IN_USE",
        message: `이 출처에 연결된 자산이 ${used.length}건 있어 삭제할 수 없습니다`,
      });
    }
    tx(db, () => {
      snapshot("SourceRecord", id, versionOf(db, "SourceRecord", id), rec, "DELETE_SOURCE_RECORD");
      sourceRecords.delete(db, id);
      auditEvents.record(db, "DELETE_SOURCE_RECORD", "SourceRecord", id, {});
    });
    return { ok: true };
  });

  // ── 문자 셀 ──
  const CellCreate = z.object({
    faceId: z.string().min(1).max(50).default("front"),
    lineIndex: z.number().int().min(1).max(999),
    sequenceIndex: z.number().int().min(1).max(999),
    bbox2d: BBox.default([0, 0, 0.05, 0.05]),
    bboxAssetId: z.string().nullable().default(null),
    observabilityScore: z.number().min(0).max(1).default(0.5),
    damageGrade: z.number().int().min(0).max(5).default(0),
    readingStatus: z.enum(MANUAL_STATUSES).default("UNKNOWN"),
    publishedReading: z.string().max(8).nullable().default(null),
    note: z.string().max(5000).default(""),
  });

  function positionTaken(tabId: string, faceId: string, line: number, seq: number, exceptId?: string) {
    return glyphCells
      .listByTab(db, tabId)
      .some(
        (c) =>
          c.entity.id !== exceptId &&
          c.entity.faceId === faceId &&
          c.entity.lineIndex === line &&
          c.entity.sequenceIndex === seq
      );
  }

  app.post("/api/stele-tabs/:id/glyphs", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!steleTabs.get(db, id)) return notFound(reply, "탭");
    const body = CellCreate.parse(req.body);
    if (positionTaken(id, body.faceId, body.lineIndex, body.sequenceIndex)) {
      return reply.status(409).send({
        error: "POSITION_TAKEN",
        message: `${body.faceId} ${body.lineIndex}행 ${body.sequenceIndex}자 위치에 이미 셀이 있습니다`,
      });
    }
    if (body.bboxAssetId && !steleAssets.get(db, body.bboxAssetId)) {
      return reply.status(400).send({ error: "UNKNOWN_ASSET", message: "기준 자산이 없습니다" });
    }
    const cell: GlyphCell = {
      id: newId("cell"),
      steleTabId: id,
      ...body,
      acceptedCandidateId: null,
      featureVector: [],
      strokes: null,
      strokeProvenance: null,
      adoptedReadingId: null,
      version: 1,
    };
    tx(db, () => {
      glyphCells.put(db, { entity: cell, extra: { seedKey: "" } });
      auditEvents.record(db, "CREATE_GLYPH_CELL", "GlyphCell", cell.id, {
        tabId: id,
        position: [body.faceId, body.lineIndex, body.sequenceIndex],
      });
    });
    return reply.status(201).send(cell);
  });

  const CellPatch = z
    .object({
      faceId: z.string().min(1).max(50),
      lineIndex: z.number().int().min(1).max(999),
      sequenceIndex: z.number().int().min(1).max(999),
      bbox2d: BBox,
      bboxAssetId: z.string().nullable(),
      observabilityScore: z.number().min(0).max(1),
      damageGrade: z.number().int().min(0).max(5),
      readingStatus: z.enum(MANUAL_STATUSES),
      publishedReading: z.string().max(8).nullable(),
      note: z.string().max(5000),
    })
    .partial()
    .extend({ expectedVersion: z.number().int().optional(), reason: z.string().max(500).optional() });

  app.patch("/api/glyphs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(db, id);
    if (!stored) return notFound(reply, "문자 셀");
    const { expectedVersion, reason, ...patch } = CellPatch.parse(req.body);
    if (expectedVersion !== undefined && expectedVersion !== stored.entity.version) {
      return conflict(reply, sanitizeCell(stored));
    }
    const next = { ...stored.entity, ...patch };
    if (
      (patch.faceId || patch.lineIndex || patch.sequenceIndex) &&
      positionTaken(stored.entity.steleTabId, next.faceId, next.lineIndex, next.sequenceIndex, id)
    ) {
      return reply.status(409).send({ error: "POSITION_TAKEN", message: "그 위치에 이미 다른 셀이 있습니다" });
    }
    const updated: StoredGlyphCell = {
      entity: { ...next, version: stored.entity.version + 1 },
      extra: stored.extra,
    };
    tx(db, () => {
      snapshot("GlyphCell", id, stored.entity.version, stored, "UPDATE_GLYPH_CELL", reason ?? "");
      glyphCells.put(db, updated);
      auditEvents.record(db, "UPDATE_GLYPH_CELL", "GlyphCell", id, {
        fields: Object.keys(patch),
        version: updated.entity.version,
      });
    });
    return sanitizeCell(updated);
  });

  // 획 트레이싱 — 사람이 이미지 위에서 그린 획. 트레이싱 자체가 해석이므로 작성자·기준 이미지를 기록
  const StrokesBody = z.object({
    polylines: GlyphStrokes.shape.polylines.max(64),
    erodedStrokeIndexes: z.array(z.number().int().min(0)).default([]),
    sourceAssetId: z.string().nullable().default(null),
    note: z.string().max(2000).default(""),
    expectedVersion: z.number().int().optional(),
  });

  app.put("/api/glyphs/:id/strokes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(db, id);
    if (!stored) return notFound(reply, "문자 셀");
    if (stored.extra.hiddenBenchmark) {
      return reply.status(409).send({
        error: "BENCHMARK_LOCKED",
        message: "벤치마크 셀의 획은 평가 무결성을 위해 편집할 수 없습니다",
      });
    }
    const body = StrokesBody.parse(req.body);
    if (body.expectedVersion !== undefined && body.expectedVersion !== stored.entity.version) {
      return conflict(reply, sanitizeCell(stored));
    }
    const valid = body.polylines.every((pl) =>
      pl.length >= 2 && pl.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100)
    );
    if (!valid) {
      return reply.status(400).send({ error: "BAD_STROKES", message: "획은 2점 이상, 좌표는 0~100 범위여야 합니다" });
    }
    const eroded = body.erodedStrokeIndexes.filter((i) => i < body.polylines.length);
    const strokes = { polylines: body.polylines, erodedStrokeIndexes: eroded };
    const user = req.user!;
    const updated: StoredGlyphCell = {
      entity: {
        ...stored.entity,
        strokes,
        featureVector: featureVector(observedPolylines(strokes) as Polyline[]).map((v) => Math.round(v * 10000) / 10000),
        strokeProvenance: {
          tracedBy: `${user.displayName} (${user.id})`,
          tracedAt: new Date().toISOString(),
          sourceAssetId: body.sourceAssetId,
          note: body.note,
        },
        version: stored.entity.version + 1,
      },
      extra: stored.extra,
    };
    tx(db, () => {
      snapshot("GlyphCell", id, stored.entity.version, stored, "TRACE_STROKES");
      glyphCells.put(db, updated);
      auditEvents.record(db, "TRACE_STROKES", "GlyphCell", id, {
        strokes: body.polylines.length,
        eroded: eroded.length,
        sourceAssetId: body.sourceAssetId,
      });
    });
    return sanitizeCell(updated);
  });

  app.delete("/api/glyphs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(db, id);
    if (!stored) return notFound(reply, "문자 셀");
    const force = (req.query as { force?: string }).force === "1";
    const rs = readings.listByCell(db, id);
    const claims = documentClaims.listByCell(db, id);
    if ((rs.length > 0 || claims.length > 0) && !force) {
      return reply.status(409).send({
        error: "HAS_DEPENDENTS",
        message: `이 셀에 판독 ${rs.length}건·문헌 주장 ${claims.length}건이 연결되어 있습니다 (?force=1로 함께 삭제)`,
      });
    }
    tx(db, () => {
      snapshot("GlyphCell", id, stored.entity.version, stored, "DELETE_GLYPH_CELL");
      for (const r of rs) {
        snapshot("Reading", r.id, r.version, r, "DELETE_WITH_CELL");
        readings.delete(db, r.id);
      }
      for (const c of comments.listByTarget(db, "GLYPH_CELL", id)) comments.delete(db, c.id);
      for (const c of claims) documentClaims.delete(db, c.id);
      glyphCells.delete(db, id);
      auditEvents.record(db, "DELETE_GLYPH_CELL", "GlyphCell", id, { readings: rs.length, claims: claims.length });
    });
    return { ok: true };
  });

  app.get("/api/glyphs/:id/history", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!glyphCells.get(db, id)) return notFound(reply, "문자 셀");
    return entityVersions.list(db, "GlyphCell", id).map((v) => {
      const snap = v.snapshot as unknown as StoredGlyphCell;
      // 벤치마크 셀의 숨김 획은 이력으로도 노출하지 않는다
      return snap?.entity ? { ...v, snapshot: { entity: sanitizeCell(snap) } } : v;
    });
  });

  app.post("/api/glyphs/:id/revert", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stored = glyphCells.get(db, id);
    if (!stored) return notFound(reply, "문자 셀");
    const body = z.object({ versionId: z.string(), reason: z.string().max(500).default("") }).parse(req.body);
    const version = entityVersions.list(db, "GlyphCell", id).find((v) => v.id === body.versionId);
    if (!version) return notFound(reply, "이력 버전");
    const snap = version.snapshot as unknown as StoredGlyphCell;
    const restored: StoredGlyphCell = {
      entity: { ...snap.entity, version: stored.entity.version + 1 },
      extra: stored.extra,
    };
    tx(db, () => {
      snapshot("GlyphCell", id, stored.entity.version, stored, "REVERT_GLYPH_CELL", body.reason);
      glyphCells.put(db, restored);
      auditEvents.record(db, "REVERT_GLYPH_CELL", "GlyphCell", id, {
        toVersion: version.version,
        versionId: version.id,
        reason: body.reason,
      });
    });
    return sanitizeCell(restored);
  });

  // ── 판독문 일괄 가져오기 (미리보기 → 생성) ──
  const ImportBody = z.object({
    text: z.string().min(1).max(200_000),
    mode: z.enum(["preview", "create"]).default("preview"),
    /** 이미 셀이 있는 위치: 판독만 추가(merge) / 충돌로 중단(fail) */
    onExisting: z.enum(["merge", "fail"]).default("fail"),
    writingDirection: z.enum(["vertical-rtl", "horizontal-ltr"]).default("vertical-rtl"),
    /** 판독 출전 — 있으면 PUBLISHED_EDITION 판독으로 기록 */
    sourceLabel: z.string().max(200).default(""),
    bibliographyId: z.string().nullable().default(null),
    citationLocator: z.string().max(200).default(""),
    bboxAssetId: z.string().nullable().default(null),
  });

  app.post("/api/stele-tabs/:id/transcription-import", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(db, id);
    if (!tab) return notFound(reply, "탭");
    const body = ImportBody.parse(req.body);
    if (body.bibliographyId && !bibliography.get(db, body.bibliographyId)) {
      return reply.status(400).send({ error: "UNKNOWN_BIBLIOGRAPHY", message: "서지 항목이 없습니다" });
    }
    const parsed = parseTranscription(body.text);
    const existing = glyphCells.listByTab(db, id);
    const key = (f: string, l: number, s: number) => `${f}|${l}|${s}`;
    const existingByPos = new Map(existing.map((c) => [key(c.entity.faceId, c.entity.lineIndex, c.entity.sequenceIndex), c]));
    const plan: Array<{
      faceId: string;
      faceLabel: string;
      lineIndex: number;
      sequenceIndex: number;
      reading: string | null;
      kind: string;
      supplied: boolean;
      unclear: boolean;
      existingCellId: string | null;
      bbox: [number, number, number, number];
    }> = [];
    for (const face of parsed.faces) {
      const grid = layoutTranscriptionGrid(face, body.writingDirection);
      for (const line of face.lines) {
        for (const c of line.cells) {
          const ex = existingByPos.get(key(face.faceId, line.lineIndex, c.sequenceIndex));
          plan.push({
            faceId: face.faceId,
            faceLabel: face.label,
            lineIndex: line.lineIndex,
            sequenceIndex: c.sequenceIndex,
            reading: c.reading,
            kind: c.kind,
            supplied: c.supplied,
            unclear: c.unclear,
            existingCellId: ex?.entity.id ?? null,
            bbox: grid.get(`${line.lineIndex}:${c.sequenceIndex}`) ?? [0, 0, 0.05, 0.05],
          });
        }
      }
    }
    const collisions = plan.filter((p) => p.existingCellId).length;
    if (body.mode === "preview") {
      return { parsed: { stats: parsed.stats, warnings: parsed.warnings, faces: parsed.faces.map((f) => ({ faceId: f.faceId, label: f.label, lines: f.lines.length })) }, plan, collisions };
    }
    if (collisions > 0 && body.onExisting === "fail") {
      return reply.status(409).send({
        error: "CELLS_EXIST",
        message: `이미 셀이 있는 위치가 ${collisions}곳 있습니다 — 판독만 추가하려면 onExisting=merge`,
        collisions,
      });
    }
    const user = req.user!;
    const now = new Date().toISOString();
    const sourceType = body.sourceLabel ? "PUBLISHED_EDITION" : "RESEARCHER";
    let createdCells = 0;
    let createdReadings = 0;
    tx(db, () => {
      for (const p of plan) {
        let cellId = p.existingCellId;
        const status = transcriptionCellStatus({
          sequenceIndex: p.sequenceIndex,
          reading: p.reading,
          kind: p.kind as "CHARACTER" | "ILLEGIBLE" | "LACUNA",
          supplied: p.supplied,
          unclear: p.unclear,
          raw: "",
        });
        if (!cellId) {
          cellId = newId("cell");
          const cell: GlyphCell = {
            id: cellId,
            steleTabId: id,
            faceId: p.faceId,
            lineIndex: p.lineIndex,
            sequenceIndex: p.sequenceIndex,
            bbox2d: p.bbox,
            bboxAssetId: body.bboxAssetId,
            observabilityScore: status === "OBSERVED" ? 0.8 : status === "PARTIALLY_OBSERVED" ? 0.5 : 0.2,
            damageGrade: status === "OBSERVED" ? 0 : status === "UNKNOWN" ? 5 : 3,
            readingStatus: status,
            acceptedCandidateId: null,
            publishedReading: sourceType === "PUBLISHED_EDITION" ? p.reading : null,
            featureVector: [],
            strokes: null,
            strokeProvenance: null,
            adoptedReadingId: null,
            note: `판독문 가져오기 (${p.faceLabel})`,
            version: 1,
          };
          glyphCells.put(db, { entity: cell, extra: { seedKey: "" } });
          createdCells++;
        } else if (sourceType === "PUBLISHED_EDITION") {
          const ex = glyphCells.get(db, cellId)!;
          if (!ex.entity.publishedReading && p.reading) {
            snapshot("GlyphCell", cellId, ex.entity.version, ex, "IMPORT_PUBLISHED_READING");
            glyphCells.put(db, {
              entity: { ...ex.entity, publishedReading: p.reading, version: ex.entity.version + 1 },
              extra: ex.extra,
            });
          }
        }
        const reading: Reading = {
          id: newId("rdg"),
          glyphCellId: cellId,
          steleTabId: id,
          readingKind: p.kind as Reading["readingKind"],
          reading: p.reading,
          variantForm: null,
          certainty: p.unclear ? "UNCERTAIN" : p.supplied ? "POSSIBLE" : "PROBABLE",
          confidence: null,
          rationale: "",
          supplied: p.supplied,
          unclear: p.unclear,
          sourceType,
          sourceLabel: body.sourceLabel || `${user.displayName} 판독`,
          bibliographyId: body.bibliographyId,
          citationLocator: body.citationLocator,
          authorId: user.id,
          authorName: user.displayName,
          // 출판 판독문은 "기록이 확인된 판독"(ACCEPTED)이지만 연구실 채택(adopt)과는 별개
          reviewStatus: sourceType === "PUBLISHED_EDITION" ? "ACCEPTED" : "PROPOSED",
          reviewerId: null,
          reviewerName: null,
          reviewedAt: null,
          reviewNote: "",
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        readings.put(db, reading);
        createdReadings++;
      }
      auditEvents.record(db, "IMPORT_TRANSCRIPTION", "SteleTab", id, {
        createdCells,
        createdReadings,
        sourceLabel: body.sourceLabel,
        stats: parsed.stats,
        warnings: parsed.warnings.length,
      });
    });
    return reply.status(201).send({ createdCells, createdReadings, warnings: parsed.warnings, stats: parsed.stats });
  });

  // ── 자산: 단위·축척 확정, 축척 막대, 정렬 ──
  app.patch("/api/assets/:id/scale", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = steleAssets.get(db, id);
    if (!asset) return notFound(reply, "자산");
    const body = z
      .object({
        unit: z.enum(["mm", "cm", "m", "px"]),
        metersPerUnit: z.number().positive().optional(),
        note: z.string().max(1000).default(""),
      })
      .parse(req.body);
    const byUnit: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1 };
    const mpu = body.unit === "px" ? body.metersPerUnit : (body.metersPerUnit ?? byUnit[body.unit]);
    if (!mpu) {
      return reply.status(400).send({ error: "NEED_SCALE", message: "픽셀 단위는 축척(metersPerUnit) 또는 축척 막대가 필요합니다" });
    }
    const user = req.user!;
    const updated: SteleAsset = {
      ...asset,
      unit: body.unit,
      scaleCalibration: {
        unit: body.unit,
        metersPerUnit: mpu,
        method: "USER_CONFIRMED",
        confirmedBy: `${user.displayName} (${user.id})`,
        confirmedAt: new Date().toISOString(),
        note: body.note,
      },
    };
    tx(db, () => {
      snapshot("SteleAsset", id, versionOf(db, "SteleAsset", id), asset, "CONFIRM_SCALE");
      steleAssets.put(db, updated);
      auditEvents.record(db, "CONFIRM_SCALE", "SteleAsset", id, { unit: body.unit, metersPerUnit: mpu });
    });
    return updated;
  });

  app.post("/api/assets/:id/scale-bar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = steleAssets.get(db, id);
    if (!asset) return notFound(reply, "자산");
    const P = z.array(z.number()).min(2).max(3);
    const body = z
      .object({ p1: P, p2: P, realLengthMm: z.number().positive().max(100_000), note: z.string().max(1000).default("") })
      .parse(req.body);
    const d = Math.hypot(...body.p1.map((v, i) => v - (body.p2[i] ?? 0)));
    if (d <= 0) return reply.status(400).send({ error: "ZERO_LENGTH", message: "두 점이 같습니다" });
    const mpu = body.realLengthMm / 1000 / d;
    const isImage = asset.assetType === "IMAGE" || asset.assetType === "RUBBING";
    const user = req.user!;
    const updated: SteleAsset = {
      ...asset,
      unit: isImage ? "px" : (asset.unit ?? "unit"),
      scaleCalibration: {
        unit: isImage ? "px" : "m",
        metersPerUnit: mpu,
        method: "SCALE_BAR",
        confirmedBy: `${user.displayName} (${user.id})`,
        confirmedAt: new Date().toISOString(),
        note: body.note || `축척 막대 ${body.realLengthMm}mm = ${d.toFixed(3)} 단위`,
      },
    };
    tx(db, () => {
      snapshot("SteleAsset", id, versionOf(db, "SteleAsset", id), asset, "SCALE_BAR");
      steleAssets.put(db, updated);
      auditEvents.record(db, "SCALE_BAR", "SteleAsset", id, { realLengthMm: body.realLengthMm, units: d, metersPerUnit: mpu });
    });
    return updated;
  });

  app.patch("/api/assets/:id/alignment", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = steleAssets.get(db, id);
    if (!asset) return notFound(reply, "자산");
    const body = z.object({ rotationDeg: z.tuple([z.number(), z.number(), z.number()]) }).parse(req.body);
    const user = req.user!;
    const updated: SteleAsset = {
      ...asset,
      alignment: { rotationDeg: body.rotationDeg, setBy: `${user.displayName} (${user.id})`, setAt: new Date().toISOString() },
    };
    tx(db, () => {
      snapshot("SteleAsset", id, versionOf(db, "SteleAsset", id), asset, "SET_ALIGNMENT");
      steleAssets.put(db, updated);
      auditEvents.record(db, "SET_ALIGNMENT", "SteleAsset", id, body);
    });
    return updated;
  });

  // ── Frontier 항목 등록 (새 발견 보도를 연구실이 직접 등록) ──
  app.post("/api/frontier", async (req, reply) => {
    const body = z
      .object({
        provisionalName: z.string().min(1).max(200),
        discoveryDate: z.string().nullable().default(null),
        announcementDate: z.string().nullable().default(null),
        locationPrecision: z.string().max(300).default(""),
        reportingInstitution: z.string().max(300).default(""),
        assetAvailability: z.array(z.string().max(200)).max(30).default([]),
        rightsState: RightsState.default("VERIFY_REQUIRED"),
        status: FrontierStatus.default("NEWS_MENTION"),
        preliminaryClaims: z.array(z.string().max(1000)).max(50).default([]),
        unknownQuestions: z.array(z.string().max(1000)).max(50).default([]),
        relatedStelae: z.array(z.string().max(200)).max(50).default([]),
        nextExpectedEvent: z.string().max(500).default(""),
      })
      .parse(req.body);
    const item: FrontierWatchItem = {
      id: newId("frontier"),
      ...body,
      lastCheckedAt: new Date().toISOString(),
      promotedTabId: null,
      frontierIndex: null,
    };
    tx(db, () => {
      frontierItems.put(db, item);
      auditEvents.record(db, "CREATE_FRONTIER_ITEM", "FrontierWatchItem", item.id, { name: item.provisionalName });
    });
    return reply.status(201).send(item);
  });

}

/** 스냅샷 버전 번호 — 버전 필드가 없는 엔터티는 이력 개수 + 1 */
function versionOf(db: Db, entityType: string, id: string): number {
  return entityVersions.list(db, entityType, id).length + 1;
}
