/**
 * 판독(Reading)·검토·토론 API.
 * - 연구원은 판독을 제안(PROPOSED)하고, PI가 승인하면 셀의 채택 판독이 된다
 * - 채택 판독이 있는 셀은 자동 분석이 상태를 덮어쓰지 않는다 (analysis.ts)
 * - 모든 변경은 이전 스냅샷을 남기고 낙관적 잠금(expectedVersion)을 지원한다
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CommentTargetType,
  CreateReadingBody,
  ReviewReadingBody,
  type Comment,
  type GlyphCell,
  type Reading,
  type ReadingStatus,
} from "@seokmun/types";
import { buildReadingComparison, exportReadingComparisonCsv } from "@seokmun/engine";
import { newId } from "./context";
import type { Db } from "./db";
import { tx } from "./db";
import {
  auditEvents,
  bibliography,
  comments,
  entityVersions,
  glyphCells,
  hypotheses,
  readings,
  steleTabs,
  type StoredGlyphCell,
} from "./repo";
import { canAccessSet, commentTargetSet } from "./auth/policy";
import { sanitizeCell } from "./sanitize";

const notFound = (reply: FastifyReply, what: string) =>
  reply.status(404).send({ error: "NOT_FOUND", message: `${what}을(를) 찾을 수 없습니다` });

/** 채택 판독 → 셀 상태 */
export function statusForAdoptedReading(r: Reading): ReadingStatus {
  if (r.readingKind === "LACUNA") return "UNKNOWN";
  if (r.readingKind === "ILLEGIBLE") return "ILLEGIBLE";
  if (r.supplied) return "TEXTUAL_SUPPLEMENT";
  if (r.unclear || r.certainty === "UNCERTAIN" || r.certainty === "POSSIBLE") return "PARTIALLY_OBSERVED";
  return "OBSERVED";
}

function validateReadingShape(body: { readingKind?: string; reading?: string | null }): string | null {
  const kind = body.readingKind ?? "CHARACTER";
  if (kind === "CHARACTER") {
    if (!body.reading) return "글자 판독에는 글자가 필요합니다";
    if (Array.from(body.reading.normalize("NFC").replace(/[︀-️\u{E0100}-\u{E01EF}]/gu, "")).length !== 1) {
      return "판독 글자는 한 자여야 합니다 (이체자는 variantForm에)";
    }
  } else if (body.reading) {
    return "판독 불가·결락에는 글자를 넣지 않습니다";
  }
  return null;
}

export function registerReadingRoutes(app: FastifyInstance, db: Db): void {
  const cellOr404 = (id: string) => glyphCells.get(db, id);

  // ── 셀의 판독 목록 ──
  app.get("/api/glyphs/:id/readings", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cell = cellOr404(id);
    if (!cell) return notFound(reply, "문자 셀");
    const list = readings.listByCell(db, id);
    const counts = comments.countByTargets(db, "READING", list.map((r) => r.id));
    return {
      cell: sanitizeCell(cell),
      adoptedReadingId: cell.entity.adoptedReadingId,
      readings: list.map((r) => ({ ...r, commentCount: counts.get(r.id) ?? 0 })),
    };
  });

  app.post("/api/glyphs/:id/readings", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cell = cellOr404(id);
    if (!cell) return notFound(reply, "문자 셀");
    const body = CreateReadingBody.parse(req.body);
    const shape = validateReadingShape(body);
    if (shape) return reply.status(400).send({ error: "BAD_READING", message: shape });
    if (body.bibliographyId && !bibliography.get(db, body.bibliographyId)) {
      return reply.status(400).send({ error: "UNKNOWN_BIBLIOGRAPHY", message: "서지 항목이 없습니다" });
    }
    if (body.sourceType === "AUTO_ANALYSIS") {
      return reply.status(400).send({
        error: "USE_FROM_ANALYSIS",
        message: "자동 분석 판독은 /readings/from-analysis 로 기록합니다",
      });
    }
    const user = req.user!;
    const now = new Date().toISOString();
    const r: Reading = {
      id: newId("rdg"),
      glyphCellId: id,
      steleTabId: cell.entity.steleTabId,
      readingKind: body.readingKind ?? "CHARACTER",
      reading: body.reading ?? null,
      variantForm: body.variantForm ?? null,
      certainty: body.certainty ?? "PROBABLE",
      confidence: body.confidence ?? null,
      rationale: body.rationale ?? "",
      supplied: body.supplied ?? false,
      unclear: body.unclear ?? false,
      sourceType: body.sourceType,
      sourceLabel: body.sourceLabel || (body.sourceType === "RESEARCHER" ? user.displayName : ""),
      bibliographyId: body.bibliographyId ?? null,
      citationLocator: body.citationLocator ?? "",
      authorId: user.id,
      authorName: user.displayName,
      // 출판 판독문 기록은 "기록 확인"(ACCEPTED) — 채택과는 별개. 연구원 판독은 제안 상태로 시작
      reviewStatus: body.draft ? "DRAFT" : body.sourceType === "PUBLISHED_EDITION" ? "ACCEPTED" : "PROPOSED",
      reviewerId: null,
      reviewerName: null,
      reviewedAt: null,
      reviewNote: "",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (r.sourceType === "PUBLISHED_EDITION" && !r.sourceLabel) {
      return reply.status(400).send({ error: "NEED_SOURCE", message: "출판 판독문은 출전(sourceLabel)이 필요합니다" });
    }
    tx(db, () => {
      readings.put(db, r);
      auditEvents.record(db, "CREATE_READING", "Reading", r.id, {
        glyphCellId: id,
        reading: r.reading,
        kind: r.readingKind,
        sourceType: r.sourceType,
        reviewStatus: r.reviewStatus,
      });
    });
    return reply.status(201).send(r);
  });

  // 최신 자동 분석의 1위 후보를 "자동 분석 판독안"으로 기록 (사람 검토 전 채택 불가)
  app.post("/api/glyphs/:id/readings/from-analysis", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cell = cellOr404(id);
    if (!cell) return notFound(reply, "문자 셀");
    const runId = cell.extra.latestRunId;
    if (!runId) return reply.status(409).send({ error: "NO_ANALYSIS", message: "먼저 분석을 실행하세요" });
    const top = hypotheses
      .listByRun(db, runId)
      .sort((a, b) => b.calibratedConfidence - a.calibratedConfidence)[0];
    if (!top) return reply.status(409).send({ error: "NO_CANDIDATE", message: "분석 후보가 없습니다" });
    const user = req.user!;
    const now = new Date().toISOString();
    const r: Reading = {
      id: newId("rdg"),
      glyphCellId: id,
      steleTabId: cell.entity.steleTabId,
      readingKind: "CHARACTER",
      reading: top.candidateCharacter,
      variantForm: top.variantForm,
      certainty: top.status === "AUTO_ACCEPTED" ? "PROBABLE" : "UNCERTAIN",
      confidence: top.calibratedConfidence,
      rationale: `자동 분석 ${runId} — 결정 ${top.status}, 보정 신뢰도 ${top.calibratedConfidence.toFixed(3)}`,
      supplied: true,
      unclear: false,
      sourceType: "AUTO_ANALYSIS",
      sourceLabel: `자동 분석 (${top.modelVersion})`,
      bibliographyId: null,
      citationLocator: runId,
      authorId: user.id,
      authorName: user.displayName,
      reviewStatus: "PROPOSED",
      reviewerId: null,
      reviewerName: null,
      reviewedAt: null,
      reviewNote: "",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    tx(db, () => {
      readings.put(db, r);
      auditEvents.record(db, "CREATE_READING", "Reading", r.id, { glyphCellId: id, fromRun: runId, reading: r.reading });
    });
    return reply.status(201).send(r);
  });

  const ReadingPatch = CreateReadingBody.omit({ sourceType: true, draft: true })
    .partial()
    .extend({ expectedVersion: z.number().int().optional() });

  app.patch("/api/readings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = readings.get(db, id);
    if (!r) return notFound(reply, "판독");
    const user = req.user!;
    const isAuthor = r.authorId === user.id;
    const editable = r.reviewStatus === "DRAFT" || r.reviewStatus === "PROPOSED";
    if (!(user.role === "PI" || (isAuthor && editable))) {
      return reply.status(403).send({
        error: "FORBIDDEN",
        message: "작성자는 검토 전(초안·제안) 판독만 고칠 수 있습니다. 검토된 판독은 PI만 수정합니다.",
      });
    }
    const { expectedVersion, ...patch } = ReadingPatch.parse(req.body);
    if (expectedVersion !== undefined && expectedVersion !== r.version) {
      return reply.status(409).send({ error: "VERSION_CONFLICT", message: "다른 사람이 먼저 수정했습니다", current: r });
    }
    const next: Reading = { ...r, ...patch, version: r.version + 1, updatedAt: new Date().toISOString() };
    const shape = validateReadingShape(next);
    if (shape) return reply.status(400).send({ error: "BAD_READING", message: shape });
    tx(db, () => {
      entityVersions.record(db, "Reading", id, r.version, r as unknown as Record<string, unknown>, "UPDATE_READING");
      readings.put(db, next);
      auditEvents.record(db, "UPDATE_READING", "Reading", id, { fields: Object.keys(patch) });
    });
    return next;
  });

  app.post("/api/readings/:id/submit", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = readings.get(db, id);
    if (!r) return notFound(reply, "판독");
    if (r.authorId !== req.user!.id && req.user!.role !== "PI") {
      return reply.status(403).send({ error: "FORBIDDEN", message: "작성자만 제출할 수 있습니다" });
    }
    if (r.reviewStatus !== "DRAFT") return reply.status(409).send({ error: "NOT_DRAFT", message: "초안만 제출할 수 있습니다" });
    const next: Reading = { ...r, reviewStatus: "PROPOSED", version: r.version + 1, updatedAt: new Date().toISOString() };
    tx(db, () => {
      readings.put(db, next);
      auditEvents.record(db, "SUBMIT_READING", "Reading", id, {});
    });
    return next;
  });

  // ── PI 검토: 승인 = 셀의 채택 판독 ──
  app.post("/api/readings/:id/review", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = readings.get(db, id);
    if (!r) return notFound(reply, "판독");
    const body = ReviewReadingBody.parse(req.body);
    if (body.expectedVersion !== undefined && body.expectedVersion !== r.version) {
      return reply.status(409).send({ error: "VERSION_CONFLICT", message: "검토 중 판독이 수정되었습니다", current: r });
    }
    if (r.reviewStatus === "DRAFT") {
      return reply.status(409).send({ error: "IS_DRAFT", message: "제출되지 않은 초안은 검토할 수 없습니다" });
    }
    const stored = glyphCells.get(db, r.glyphCellId);
    if (!stored) return notFound(reply, "문자 셀");
    const user = req.user!;
    const now = new Date().toISOString();
    const reviewed: Reading = {
      ...r,
      reviewStatus: body.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
      reviewerId: user.id,
      reviewerName: user.displayName,
      reviewedAt: now,
      reviewNote: body.note,
      version: r.version + 1,
      updatedAt: now,
    };
    let cellAfter: GlyphCell = stored.entity;
    tx(db, () => {
      entityVersions.record(db, "Reading", id, r.version, r as unknown as Record<string, unknown>, `REVIEW_${body.decision}`, body.note);
      readings.put(db, reviewed);
      const prevAdoptedId = stored.entity.adoptedReadingId;
      if (body.decision === "ACCEPT") {
        // 이전 채택 판독 — 연구원·자동 판독은 대체(SUPERSEDED), 출판 판독문 기록은 그대로 유지
        if (prevAdoptedId && prevAdoptedId !== id) {
          const prev = readings.get(db, prevAdoptedId);
          if (prev && prev.sourceType !== "PUBLISHED_EDITION") {
            entityVersions.record(db, "Reading", prev.id, prev.version, prev as unknown as Record<string, unknown>, "SUPERSEDED");
            readings.put(db, { ...prev, reviewStatus: "SUPERSEDED", version: prev.version + 1, updatedAt: now });
          }
        }
        cellAfter = {
          ...stored.entity,
          adoptedReadingId: id,
          readingStatus: statusForAdoptedReading(reviewed),
          version: stored.entity.version + 1,
        };
      } else if (prevAdoptedId === id) {
        cellAfter = { ...stored.entity, adoptedReadingId: null, version: stored.entity.version + 1 };
      }
      if (cellAfter !== stored.entity) {
        entityVersions.record(db, "GlyphCell", stored.entity.id, stored.entity.version, stored as unknown as Record<string, unknown>, `ADOPT_${body.decision}`, body.note);
        glyphCells.put(db, { entity: cellAfter, extra: stored.extra } as StoredGlyphCell);
      }
      auditEvents.record(db, body.decision === "ACCEPT" ? "ACCEPT_READING" : "REJECT_READING", "Reading", id, {
        glyphCellId: r.glyphCellId,
        reading: r.reading,
        previousAdoptedReadingId: prevAdoptedId,
        note: body.note,
      });
    });
    return { reading: reviewed, cell: sanitizeCell({ entity: cellAfter, extra: stored.extra }) };
  });

  app.delete("/api/readings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = readings.get(db, id);
    if (!r) return notFound(reply, "판독");
    const user = req.user!;
    const ownDraft = r.authorId === user.id && (r.reviewStatus === "DRAFT" || r.reviewStatus === "PROPOSED");
    if (!(ownDraft || user.role === "PI")) {
      return reply.status(403).send({ error: "FORBIDDEN", message: "검토 전 본인 판독 또는 PI만 삭제할 수 있습니다" });
    }
    const cell = glyphCells.get(db, r.glyphCellId);
    if (cell?.entity.adoptedReadingId === id) {
      return reply.status(409).send({ error: "ADOPTED", message: "채택된 판독은 삭제할 수 없습니다 — 먼저 다른 판독을 채택하거나 기각하세요" });
    }
    tx(db, () => {
      entityVersions.record(db, "Reading", id, r.version, r as unknown as Record<string, unknown>, "DELETE_READING");
      readings.delete(db, id);
      auditEvents.record(db, "DELETE_READING", "Reading", id, { glyphCellId: r.glyphCellId });
    });
    return { ok: true };
  });

  app.get("/api/readings/:id/history", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!readings.get(db, id)) return notFound(reply, "판독");
    return entityVersions.list(db, "Reading", id);
  });

  // ── 검토 대기열 (PI·연구원 공통 열람, 접근 가능한 세트만) ──
  app.get("/api/review-queue", async (req) => {
    const pending = readings.listPendingReview(db);
    const out = [];
    for (const r of pending) {
      const tab = steleTabs.get(db, r.steleTabId);
      if (!tab || !canAccessSet(db, req.user, tab.researchSetId, "GUEST")) continue;
      const cell = glyphCells.get(db, r.glyphCellId);
      out.push({
        reading: r,
        tab: { id: tab.id, title: tab.title, researchSetId: tab.researchSetId },
        cell: cell ? { id: cell.entity.id, faceId: cell.entity.faceId, lineIndex: cell.entity.lineIndex, sequenceIndex: cell.entity.sequenceIndex } : null,
      });
    }
    return out;
  });

  // ── 판독자별 비교표 ──
  app.get("/api/stele-tabs/:id/reading-comparison", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tab = steleTabs.get(db, id);
    if (!tab) return notFound(reply, "탭");
    const q = z.object({ format: z.enum(["json", "csv"]).default("json") }).parse(req.query);
    const cells = glyphCells.listByTab(db, id).map((c) => c.entity);
    const table = buildReadingComparison(cells, readings.listByTab(db, id));
    if (q.format === "csv") {
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${tab.title}-판독비교.csv`)}`)
        .send(exportReadingComparisonCsv(table));
    }
    return table;
  });

  // ── 토론(댓글) ──
  app.get("/api/comments", async (req, reply) => {
    const q = z.object({ targetType: CommentTargetType, targetId: z.string().min(1) }).parse(req.query);
    const setId = commentTargetSet(db, q.targetType, q.targetId);
    if (setId === undefined && q.targetType !== "DOCUMENT") return notFound(reply, "대상");
    if (setId && !canAccessSet(db, req.user, setId, "GUEST")) {
      return reply.status(403).send({ error: "SET_ACCESS_DENIED", message: "이 연구 세트에 대한 권한이 없습니다" });
    }
    return comments.listByTarget(db, q.targetType, q.targetId);
  });

  app.post("/api/comments", async (req, reply) => {
    const body = z
      .object({
        targetType: CommentTargetType,
        targetId: z.string().min(1),
        parentId: z.string().nullable().default(null),
        body: z.string().trim().min(1).max(10000),
      })
      .parse(req.body);
    const setId = commentTargetSet(db, body.targetType, body.targetId);
    if (setId === undefined && body.targetType !== "DOCUMENT") return notFound(reply, "대상");
    if (setId && !canAccessSet(db, req.user, setId, "RESEARCHER")) {
      return reply.status(403).send({ error: "SET_ACCESS_DENIED", message: "이 연구 세트에 쓸 권한이 없습니다" });
    }
    if (body.parentId) {
      const parent = comments.get(db, body.parentId);
      if (!parent || parent.targetId !== body.targetId) {
        return reply.status(400).send({ error: "BAD_PARENT", message: "같은 대상의 댓글에만 답글을 달 수 있습니다" });
      }
    }
    const user = req.user!;
    const c: Comment = {
      id: newId("cmt"),
      targetType: body.targetType,
      targetId: body.targetId,
      parentId: body.parentId,
      authorId: user.id,
      authorName: user.displayName,
      body: body.body,
      resolved: false,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    tx(db, () => {
      comments.put(db, c);
      auditEvents.record(db, "CREATE_COMMENT", "Comment", c.id, { targetType: c.targetType, targetId: c.targetId });
    });
    return reply.status(201).send(c);
  });

  app.patch("/api/comments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = comments.get(db, id);
    if (!c) return notFound(reply, "댓글");
    const body = z.object({ body: z.string().trim().min(1).max(10000).optional(), resolved: z.boolean().optional() }).parse(req.body);
    const user = req.user!;
    if (body.body !== undefined && c.authorId !== user.id) {
      return reply.status(403).send({ error: "FORBIDDEN", message: "작성자만 내용을 고칠 수 있습니다" });
    }
    if (body.resolved !== undefined && c.authorId !== user.id && user.role !== "PI") {
      return reply.status(403).send({ error: "FORBIDDEN", message: "작성자 또는 PI만 해결 상태를 바꿀 수 있습니다" });
    }
    const next: Comment = {
      ...c,
      ...(body.body !== undefined ? { body: body.body, editedAt: new Date().toISOString() } : {}),
      ...(body.resolved !== undefined ? { resolved: body.resolved } : {}),
    };
    tx(db, () => {
      if (body.body !== undefined) {
        entityVersions.record(db, "Comment", id, 1, c as unknown as Record<string, unknown>, "EDIT_COMMENT");
      }
      comments.put(db, next);
      auditEvents.record(db, "UPDATE_COMMENT", "Comment", id, { resolved: next.resolved, edited: body.body !== undefined });
    });
    return next;
  });

  app.delete("/api/comments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = comments.get(db, id);
    if (!c) return notFound(reply, "댓글");
    if (c.authorId !== req.user!.id && req.user!.role !== "PI") {
      return reply.status(403).send({ error: "FORBIDDEN", message: "작성자 또는 PI만 삭제할 수 있습니다" });
    }
    tx(db, () => {
      entityVersions.record(db, "Comment", id, 1, c as unknown as Record<string, unknown>, "DELETE_COMMENT");
      comments.delete(db, id);
      auditEvents.record(db, "DELETE_COMMENT", "Comment", id, {});
    });
    return { ok: true };
  });
}
