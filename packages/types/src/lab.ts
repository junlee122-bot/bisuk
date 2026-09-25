import { z } from "zod";

/**
 * 연구실 운영 엔티티 — 사용자·역할, 판독자별 판독(Reading), 검토 흐름,
 * 토론(Comment), 변경 이력(EntityVersion), 서지(Bibliography), 문헌 주장(DocumentClaim),
 * 자형 표본(Exemplar), 이체자 관계, 연대 증거, 보정 프로파일, 분석 스냅샷.
 */

// ── 사용자·역할 ──
/** PI: 권리 확정·판독 승인·삭제 / RESEARCHER: 입력·제안 / GUEST: 읽기 전용 */
export const UserRole = z.enum(["PI", "RESEARCHER", "GUEST"]);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().min(1),
  role: UserRole,
  active: z.boolean().default(true),
  /** 인증 제공자 — 로컬 비밀번호 / 리버스 프록시 SSO 헤더 / 개발 모드 */
  authProvider: z.enum(["LOCAL", "PROXY_HEADER", "DEV"]).default("LOCAL"),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable().default(null),
});
export type User = z.infer<typeof User>;

export const PublicUser = User.pick({ id: true, email: true, displayName: true, role: true });
export type PublicUser = z.infer<typeof PublicUser>;

/** 연구 세트 구성원 — PRIVATE 세트는 구성원·PI만 접근 */
export const SetMembership = z.object({
  researchSetId: z.string(),
  userId: z.string(),
  /** 세트 안에서의 역할 (전역 역할보다 낮출 수만 있음) */
  role: UserRole,
  addedAt: z.string(),
});
export type SetMembership = z.infer<typeof SetMembership>;

// ── 판독(Reading) ──
export const ReadingSourceType = z.enum([
  /** 연구실 구성원이 직접 제안한 판독 */
  "RESEARCHER",
  /** 출판된 판독문(선행 연구·보고서)의 판독 */
  "PUBLISHED_EDITION",
  /** 자동 분석 결과를 판독안으로 기록한 것 (사람 검토 전 확정 불가) */
  "AUTO_ANALYSIS",
]);
export type ReadingSourceType = z.infer<typeof ReadingSourceType>;

export const ReadingKind = z.enum([
  "CHARACTER",
  /** 획은 보이나 판독 불가 */
  "ILLEGIBLE",
  /** 결락(글자 자리 자체가 소실) */
  "LACUNA",
]);
export type ReadingKind = z.infer<typeof ReadingKind>;

export const ReadingCertainty = z.enum(["CERTAIN", "PROBABLE", "POSSIBLE", "UNCERTAIN"]);
export type ReadingCertainty = z.infer<typeof ReadingCertainty>;

export const ReviewStatus = z.enum(["DRAFT", "PROPOSED", "ACCEPTED", "REJECTED", "SUPERSEDED"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const Reading = z.object({
  id: z.string(),
  glyphCellId: z.string(),
  steleTabId: z.string(),
  readingKind: ReadingKind.default("CHARACTER"),
  /** 판독 글자 (CHARACTER일 때 1자, 이체자면 원형을 기재하고 variantForm에 이체) */
  reading: z.string().nullable().default(null),
  variantForm: z.string().nullable().default(null),
  certainty: ReadingCertainty.default("PROBABLE"),
  /** 0~1 주관 신뢰도 (선택) */
  confidence: z.number().min(0).max(1).nullable().default(null),
  rationale: z.string().default(""),
  /** 편집 기호: 복원(보충)·불확실 표시 — Leiden [ ] / 밑점 */
  supplied: z.boolean().default(false),
  unclear: z.boolean().default(false),
  sourceType: ReadingSourceType,
  /** 표시용 출전 라벨 (예: "허흥식 1984", "연구실 2026 판독") */
  sourceLabel: z.string().default(""),
  bibliographyId: z.string().nullable().default(null),
  /** 출전 쪽/행 등 인용 위치 (예: "p.123", "도판 5") */
  citationLocator: z.string().default(""),
  authorId: z.string(),
  authorName: z.string(),
  reviewStatus: ReviewStatus.default("PROPOSED"),
  reviewerId: z.string().nullable().default(null),
  reviewerName: z.string().nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
  reviewNote: z.string().default(""),
  version: z.number().int().default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Reading = z.infer<typeof Reading>;

export const CreateReadingBody = Reading.pick({
  readingKind: true,
  reading: true,
  variantForm: true,
  certainty: true,
  confidence: true,
  rationale: true,
  supplied: true,
  unclear: true,
  sourceType: true,
  sourceLabel: true,
  bibliographyId: true,
  citationLocator: true,
})
  .partial({
    readingKind: true,
    variantForm: true,
    certainty: true,
    confidence: true,
    rationale: true,
    supplied: true,
    unclear: true,
    sourceLabel: true,
    bibliographyId: true,
    citationLocator: true,
  })
  .extend({
    /** DRAFT로 저장할지(기본 PROPOSED) */
    draft: z.boolean().optional(),
  });
export type CreateReadingBody = z.infer<typeof CreateReadingBody>;

export const ReviewReadingBody = z.object({
  decision: z.enum(["ACCEPT", "REJECT"]),
  note: z.string().default(""),
  /** 낙관적 잠금 — 클라이언트가 본 판독 version */
  expectedVersion: z.number().int().optional(),
});
export type ReviewReadingBody = z.infer<typeof ReviewReadingBody>;

// ── 토론(Comment) ──
export const CommentTargetType = z.enum(["GLYPH_CELL", "READING", "TAB", "DOCUMENT"]);
export type CommentTargetType = z.infer<typeof CommentTargetType>;

export const Comment = z.object({
  id: z.string(),
  targetType: CommentTargetType,
  targetId: z.string(),
  parentId: z.string().nullable().default(null),
  authorId: z.string(),
  authorName: z.string(),
  body: z.string().min(1).max(10000),
  resolved: z.boolean().default(false),
  createdAt: z.string(),
  editedAt: z.string().nullable().default(null),
});
export type Comment = z.infer<typeof Comment>;

// ── 변경 이력 (스냅샷) ──
export const EntityVersion = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  version: z.number().int(),
  snapshot: z.record(z.unknown()),
  action: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  reason: z.string().default(""),
  ts: z.string(),
});
export type EntityVersion = z.infer<typeof EntityVersion>;

// ── 서지 (CSL-JSON 부분집합) ──
export const CslName = z.object({
  family: z.string().optional(),
  given: z.string().optional(),
  /** 기관명·한국식 성명 등 분리 불가 이름 */
  literal: z.string().optional(),
});
export type CslName = z.infer<typeof CslName>;

export const BibliographyType = z.enum([
  "article-journal",
  "book",
  "chapter",
  "thesis",
  "report",
  "paper-conference",
  "webpage",
  "dataset",
  "manuscript",
]);
export type BibliographyType = z.infer<typeof BibliographyType>;

export const BibliographyEntry = z.object({
  id: z.string(),
  /** BibTeX 인용 키 등 사람이 쓰는 키 */
  citationKey: z.string().default(""),
  type: BibliographyType,
  title: z.string().min(1),
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
  /** 학위논문 종류 등 (예: "박사학위논문") */
  genre: z.string().default(""),
  DOI: z.string().default(""),
  URL: z.string().default(""),
  ISBN: z.string().default(""),
  language: z.string().default("ko"),
  note: z.string().default(""),
  createdBy: z.string().default("system"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BibliographyEntry = z.infer<typeof BibliographyEntry>;

// ── 문헌 주장(claim) — 제안→검수 ──
export const DocumentClaimStatus = z.enum(["SUGGESTED", "CONFIRMED", "REJECTED"]);
export type DocumentClaimStatus = z.infer<typeof DocumentClaimStatus>;

export const DocumentClaim = z.object({
  id: z.string(),
  documentId: z.string(),
  targetGlyphCellId: z.string(),
  character: z.string().min(1),
  stance: z.enum(["SUPPORT", "COUNTER"]),
  quote: z.string().min(1),
  /** 문헌 내 쪽 위치 (예: "p.45") */
  locator: z.string().default(""),
  status: DocumentClaimStatus.default("CONFIRMED"),
  /** 제안 출처: 시드 주석 / 자동 제안 / 사람 입력 */
  origin: z.enum(["SEED_ANNOTATION", "AUTO_SUGGESTED", "MANUAL"]).default("MANUAL"),
  createdBy: z.string().default("system"),
  reviewedBy: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type DocumentClaim = z.infer<typeof DocumentClaim>;

// ── 자형 표본·이체자·연대 ──
export const CharacterExemplar = z.object({
  id: z.string(),
  character: z.string().min(1),
  /** 0~100 좌표계 획 */
  polylines: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
  sourceLabel: z.string().default(""),
  sourceGlyphCellId: z.string().nullable().default(null),
  period: z.string().default(""),
  createdBy: z.string().default("system"),
  createdAt: z.string(),
});
export type CharacterExemplar = z.infer<typeof CharacterExemplar>;

export const VariantPair = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  /** Unihan 관계명 또는 사용자 지정 */
  kind: z.string().default("SEMANTIC"),
  source: z.string().default("user"),
});
export type VariantPair = z.infer<typeof VariantPair>;

export const ChronologyAttestation = z.object({
  character: z.string().min(1),
  /** 최초 확인 연도 (서기, 음수는 기원전) */
  earliestYear: z.number().int(),
  source: z.string().default(""),
});
export type ChronologyAttestation = z.infer<typeof ChronologyAttestation>;

// ── 보정 프로파일 ──
export const CalibrationProfile = z.object({
  id: z.string(),
  method: z.enum(["ISOTONIC", "PLATT"]),
  /** 적합에 쓴 평가 사례 수 */
  n: z.number().int(),
  ece: z.number(),
  /** ISOTONIC: 단조 계단 [raw 상한, 보정값] / PLATT: [a, b] */
  params: z.array(z.array(z.number())),
  fittedAt: z.string(),
  fittedBy: z.string(),
  note: z.string().default(""),
});
export type CalibrationProfile = z.infer<typeof CalibrationProfile>;

// ── 분석 실행 스냅샷 (재현성) ──
export const AnalysisRunRecord = z.object({
  id: z.string(),
  glyphCellId: z.string(),
  /** 입력 정규화 JSON의 sha256 */
  inputHash: z.string(),
  /** 재실행에 필요한 전체 입력 (파이프라인 입력 직렬화) */
  inputSnapshot: z.record(z.unknown()),
  parameters: z.record(z.unknown()),
  outcome: z.string(),
  topCandidate: z.string().nullable(),
  modelVersion: z.string(),
  corpusVersion: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type AnalysisRunRecord = z.infer<typeof AnalysisRunRecord>;

/** Decision Gate 규칙 상태 — 미구현/데이터 없음은 '통과'가 아니라 NOT_EVALUATED */
export const RuleStatus = z.enum(["PASS", "FAIL", "NOT_EVALUATED"]);
export type RuleStatus = z.infer<typeof RuleStatus>;
