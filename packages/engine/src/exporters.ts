/**
 * 내보내기 — JSON / CSV / EpiDoc XML / 연구 보고서(Markdown).
 * 모든 형식에 출처·권리·모델 버전 manifest를 포함한다.
 * 권리 미확인 업로드 원본은 PUBLIC 내보내기에서 차단한다.
 *
 * 판독문 우선순위: 연구실 채택 판독(PI 승인) > 원문 관측 > 자동 확정(기계, cert ≤ medium) > 결락·판독 불가.
 * EpiDoc은 EpiDoc 9.x / TEI P5 스키마로 검증되는 구조(면별 textpart, lb, gap 병합, unclear, supplied, app)로 쓴다.
 */
import type {
  BibliographyEntry,
  GlyphCell,
  Reading,
  ResearchSet,
  RestorationHypothesis,
  SourceRecord,
  SteleAsset,
  SteleTab,
} from "@seokmun/types";
import { formatBibliographyList } from "./bibliography";
import { buildReadingComparison, formatReadingToken } from "./readingTable";

export interface ExportInput {
  researchSet: ResearchSet;
  tabs: SteleTab[];
  sourceRecords: SourceRecord[];
  assets: SteleAsset[];
  glyphCells: GlyphCell[];
  hypotheses: RestorationHypothesis[];
  modelVersion: string;
  corpusVersion: string;
  generatedAt: string;
  audience: "INTERNAL" | "PUBLIC";
  /** 가상 데모 자산만 가진 탭 id — EpiDoc subtype 표기에 사용 */
  virtualTabIds?: string[];
  /** 판독자별 판독 (출판 판독문 포함) */
  readings?: Reading[];
  bibliography?: BibliographyEntry[];
  documents?: Array<{
    id: string;
    title: string;
    isFictional: boolean;
    bibliographyId: string | null;
    publisher: string;
    publishedAt: string;
  }>;
  /** faceId → 표시 이름 (없으면 id에서 추정) */
  faceLabels?: Record<string, string>;
}

/**
 * 외부 공개 재배포 허용 목록 — 명시적으로 재배포가 허용된 상태만 통과한다.
 * VIEW_ONLY·RESEARCH_ONLY·METADATA_ONLY·KOGL_TYPE_4 등 나머지는 전부 차단
 * (거부 목록이 아닌 허용 목록 방식).
 */
const REDISTRIBUTABLE_RIGHTS = new Set([
  "OPEN_FOR_REUSE",
  "ATTRIBUTION_REQUIRED",
  "NONCOMMERCIAL",
]);

export function isRedistributable(asset: SteleAsset): boolean {
  if (asset.provenance === "VIRTUAL_DEMO") return true;
  return REDISTRIBUTABLE_RIGHTS.has(asset.rightsState);
}

export interface RightsGateResult {
  allowed: boolean;
  blockedAssets: Array<{ id: string; filename: string | null; rightsState: string }>;
}

export function checkExportRights(
  assets: SteleAsset[],
  audience: "INTERNAL" | "PUBLIC"
): RightsGateResult {
  if (audience === "INTERNAL") return { allowed: true, blockedAssets: [] };
  const blocked = assets
    .filter((a) => !isRedistributable(a))
    .map((a) => ({
      id: a.id,
      filename: a.originalFilename,
      rightsState: a.rightsState,
    }));
  return { allowed: blocked.length === 0, blockedAssets: blocked };
}

export function buildManifest(input: ExportInput) {
  return {
    exportedAt: input.generatedAt,
    audience: input.audience,
    modelVersion: input.modelVersion,
    corpusVersion: input.corpusVersion,
    researchSet: { id: input.researchSet.id, name: input.researchSet.name },
    rightsPolicy: input.researchSet.rightsPolicy,
    sources: input.sourceRecords.map((s) => ({
      id: s.id,
      publisher: s.publisher,
      url: s.url,
      rightsState: s.rightsState,
      reliabilityTier: s.reliabilityTier,
    })),
    assets: input.assets.map((a) => ({
      id: a.id,
      provenance: a.provenance,
      demoLabel: a.demoLabel,
      filename: a.originalFilename,
      checksumSha256: a.checksumSha256,
      rightsState: a.rightsState,
      licenseType: a.licenseType,
      includedInExport: isRedistributable(a),
    })),
    counts: {
      glyphCells: input.glyphCells.length,
      adoptedReadings: input.glyphCells.filter((c) => c.adoptedReadingId).length,
      readings: input.readings?.length ?? 0,
      bibliography: input.bibliography?.length ?? 0,
    },
    disclaimer:
      "VIRTUAL_DEMO 자산과 허구 문헌은 데모용 창작물이며 실제 유물 데이터·실제 판독 결과가 아니다.",
  };
}

// ── 공통: 면 이름·셀 라벨·판독문 토큰 ──

const FACE_WORDS: Array<[RegExp, string]> = [
  [/front|obverse|전면|앞/i, "전면"],
  [/back|reverse|후면|뒤/i, "후면"],
  [/left|좌/i, "좌측면"],
  [/right|우/i, "우측면"],
  [/top|상/i, "상면"],
  [/frag(?:ment)?[-_]?(\d+)|조각\s*(\d+)/i, "조각"],
  [/text|body|본문/i, "본문"],
];

export function faceLabelFor(faceId: string, labels?: Record<string, string>): string {
  if (labels?.[faceId]) return labels[faceId]!;
  for (const [re, word] of FACE_WORDS) {
    const m = re.exec(faceId);
    if (m) return word === "조각" ? `조각 ${m[1] ?? m[2] ?? ""}`.trim() : word;
  }
  return faceId;
}

export function cellLabel(cell: Pick<GlyphCell, "faceId" | "lineIndex" | "sequenceIndex">, labels?: Record<string, string>): string {
  return `${faceLabelFor(cell.faceId, labels)} ${cell.lineIndex}행 ${cell.sequenceIndex}자`;
}

type Cert = "high" | "medium" | "low";

export type EditionToken =
  | { kind: "text"; text: string; source: "ADOPTED" | "OBSERVED" }
  | { kind: "unclear"; text: string; cert: Cert; resp: "lab" | "machine" | null }
  | { kind: "supplied"; text: string; cert: Cert; resp: "lab" | "machine"; reason: "lost" | "undefined" }
  | { kind: "choice"; reg: string; orig: string; unclear: boolean; supplied: boolean; cert: Cert }
  | { kind: "gap"; reason: "lost" | "illegible" };

const CERTAINTY_TO_CERT: Record<Reading["certainty"], Cert> = {
  CERTAIN: "high",
  PROBABLE: "medium",
  POSSIBLE: "low",
  UNCERTAIN: "low",
};

export function bestHypothesisByCell(hypotheses: RestorationHypothesis[]): Map<string, RestorationHypothesis> {
  const out = new Map<string, RestorationHypothesis>();
  for (const h of hypotheses) {
    const prev = out.get(h.glyphCellId);
    if (!prev || h.calibratedConfidence > prev.calibratedConfidence) out.set(h.glyphCellId, h);
  }
  return out;
}

/** 셀 하나의 판독문 토큰 */
export function editionTokenFor(
  cell: GlyphCell,
  adopted: Reading | undefined,
  hypothesis: RestorationHypothesis | undefined
): EditionToken {
  if (adopted) {
    if (adopted.readingKind === "LACUNA") return { kind: "gap", reason: "lost" };
    if (adopted.readingKind === "ILLEGIBLE" || !adopted.reading) return { kind: "gap", reason: "illegible" };
    const cert = CERTAINTY_TO_CERT[adopted.certainty];
    if (adopted.variantForm && adopted.variantForm !== adopted.reading) {
      return { kind: "choice", reg: adopted.reading, orig: adopted.variantForm, unclear: adopted.unclear, supplied: adopted.supplied, cert };
    }
    if (adopted.supplied) return { kind: "supplied", text: adopted.reading, cert, resp: "lab", reason: "lost" };
    if (adopted.unclear) return { kind: "unclear", text: adopted.reading, cert, resp: "lab" };
    return { kind: "text", text: adopted.reading, source: "ADOPTED" };
  }
  if (cell.readingStatus === "OBSERVED" && cell.publishedReading) {
    return { kind: "text", text: cell.publishedReading, source: "OBSERVED" };
  }
  if (hypothesis?.status === "AUTO_ACCEPTED") {
    // 기계 판독은 사람 검토 전이므로 확실도를 medium 이하로 둔다
    return { kind: "supplied", text: hypothesis.candidateCharacter, cert: "medium", resp: "machine", reason: "lost" };
  }
  if (cell.readingStatus === "PARTIALLY_OBSERVED" && cell.publishedReading) {
    return { kind: "unclear", text: cell.publishedReading, cert: "medium", resp: null };
  }
  if (cell.readingStatus === "TEXTUAL_SUPPLEMENT" && cell.publishedReading) {
    return { kind: "supplied", text: cell.publishedReading, cert: "low", resp: "lab", reason: "lost" };
  }
  return { kind: "gap", reason: cell.observabilityScore < 0.05 ? "lost" : "illegible" };
}

/** Leiden 약식 표기 (보고서·판독문 미리보기용) */
export function leidenText(tok: EditionToken): string {
  switch (tok.kind) {
    case "text":
      return tok.text;
    case "unclear":
      return `${tok.text}?`;
    case "supplied":
      return `[${tok.text}]`;
    case "choice": {
      let t = `${tok.reg}(${tok.orig})`;
      if (tok.unclear) t = `${t}?`;
      return tok.supplied ? `[${t}]` : t;
    }
    case "gap":
      return tok.reason === "lost" ? "□" : "▨";
  }
}

function orderedCellsByFaceLine(cells: GlyphCell[]): Array<{ faceId: string; lines: Array<[number, GlyphCell[]]> }> {
  const faces = new Map<string, Map<number, GlyphCell[]>>();
  const faceOrder: string[] = [];
  for (const c of [...cells].sort(
    (a, b) => a.faceId.localeCompare(b.faceId) || a.lineIndex - b.lineIndex || a.sequenceIndex - b.sequenceIndex
  )) {
    if (!faces.has(c.faceId)) {
      faces.set(c.faceId, new Map());
      faceOrder.push(c.faceId);
    }
    const lines = faces.get(c.faceId)!;
    const list = lines.get(c.lineIndex) ?? [];
    list.push(c);
    lines.set(c.lineIndex, list);
  }
  return faceOrder.map((faceId) => ({
    faceId,
    lines: [...faces.get(faceId)!.entries()].sort((a, b) => a[0] - b[0]),
  }));
}

function adoptedMap(input: ExportInput): Map<string, Reading> {
  const byId = new Map((input.readings ?? []).map((r) => [r.id, r]));
  const out = new Map<string, Reading>();
  for (const c of input.glyphCells) {
    const r = c.adoptedReadingId ? byId.get(c.adoptedReadingId) : undefined;
    if (r) out.set(c.id, r);
  }
  return out;
}

function activeReadings(input: ExportInput): Map<string, Reading[]> {
  const out = new Map<string, Reading[]>();
  for (const r of input.readings ?? []) {
    if (r.reviewStatus === "REJECTED" || r.reviewStatus === "SUPERSEDED" || r.reviewStatus === "DRAFT") continue;
    const list = out.get(r.glyphCellId) ?? [];
    list.push(r);
    out.set(r.glyphCellId, list);
  }
  return out;
}

function readerLabel(r: Reading): string {
  return r.sourceLabel || r.authorName;
}

// ── JSON ──

export function exportJson(input: ExportInput): string {
  return JSON.stringify(
    {
      manifest: buildManifest(input),
      tabs: input.tabs,
      glyphCells: input.glyphCells.map((c) => ({ ...c, label: cellLabel(c, input.faceLabels) })),
      hypotheses: input.hypotheses,
      readings: input.readings ?? [],
      bibliography: input.bibliography ?? [],
      documents: input.documents ?? [],
    },
    null,
    2
  );
}

// ── CSV ──

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 셀 단위 CSV (UTF-8 BOM, CRLF — 한국어 Excel 호환) */
export function exportCsv(input: ExportInput): string {
  const header = [
    "tab_id",
    "tab_title",
    "face",
    "cell_label",
    "glyph_cell_id",
    "line",
    "seq",
    "bbox_x",
    "bbox_y",
    "bbox_w",
    "bbox_h",
    "damage_grade",
    "observability",
    "reading_status",
    "published_reading",
    "adopted_reading",
    "adopted_source",
    "edition_text",
    "accepted_character",
    "calibrated_confidence",
    "decision",
    "alternates",
    "readings_by_source",
    "model_version",
  ];
  const hypByCell = bestHypothesisByCell(input.hypotheses);
  const hypsByCell = new Map<string, RestorationHypothesis[]>();
  for (const h of input.hypotheses) {
    const list = hypsByCell.get(h.glyphCellId) ?? [];
    list.push(h);
    hypsByCell.set(h.glyphCellId, list);
  }
  const adopted = adoptedMap(input);
  const readingsByCell = activeReadings(input);
  const tabById = new Map(input.tabs.map((t) => [t.id, t]));
  const cells = [...input.glyphCells].sort(
    (a, b) =>
      a.steleTabId.localeCompare(b.steleTabId) ||
      a.faceId.localeCompare(b.faceId) ||
      a.lineIndex - b.lineIndex ||
      a.sequenceIndex - b.sequenceIndex
  );
  const rows = cells.map((g) => {
    const h = hypByCell.get(g.id);
    const t = tabById.get(g.steleTabId);
    const a = adopted.get(g.id);
    const alternates = (hypsByCell.get(g.id) ?? [])
      .filter((x) => x !== h)
      .sort((x, y) => y.calibratedConfidence - x.calibratedConfidence)
      .map((x) => `${x.candidateCharacter} ${x.calibratedConfidence}`)
      .join("; ");
    const bySource = (readingsByCell.get(g.id) ?? [])
      .map((r) => `${readerLabel(r)}: ${formatReadingToken(r)}${r.id === g.adoptedReadingId ? " (채택)" : ""}`)
      .join(" | ");
    return [
      g.steleTabId,
      t?.title ?? "",
      faceLabelFor(g.faceId, input.faceLabels),
      cellLabel(g, input.faceLabels),
      g.id,
      g.lineIndex,
      g.sequenceIndex,
      ...g.bbox2d.map((v) => Math.round(v * 10000) / 10000),
      g.damageGrade,
      g.observabilityScore,
      g.readingStatus,
      g.publishedReading ?? "",
      a ? formatReadingToken(a) : "",
      a ? `${a.sourceType}:${readerLabel(a)}` : "",
      leidenText(editionTokenFor(g, a, h)),
      h?.status === "AUTO_ACCEPTED" ? h.candidateCharacter : "",
      h?.calibratedConfidence ?? "",
      h?.status ?? "",
      alternates,
      bySource,
      input.modelVersion,
    ]
      .map(csvEscape)
      .join(",");
  });
  return `﻿${[header.join(","), ...rows].join("\r\n")}\r\n`;
}

// ── EpiDoc (TEI XML) ──

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** xml:id용 NCName */
export function toXmlId(prefix: string, raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${prefix}${cleaned}`;
}

interface RespIds {
  lab: string;
  auto: string;
}

function tokenXml(tok: EditionToken, ids: RespIds): string {
  const resp = (r: "lab" | "machine" | null) => (r === "machine" ? ` resp="#${ids.auto}"` : r === "lab" ? ` resp="#${ids.lab}"` : "");
  switch (tok.kind) {
    case "text":
      return xmlEscape(tok.text);
    case "unclear":
      return `<unclear cert="${tok.cert}"${resp(tok.resp)}>${xmlEscape(tok.text)}</unclear>`;
    case "supplied":
      return `<supplied reason="${tok.reason}" cert="${tok.cert}"${resp(tok.resp)}>${xmlEscape(tok.text)}</supplied>`;
    case "choice": {
      let reg = xmlEscape(tok.reg);
      let orig = xmlEscape(tok.orig);
      if (tok.unclear) {
        reg = `<unclear>${reg}</unclear>`;
        orig = `<unclear>${orig}</unclear>`;
      }
      const inner = `<choice><orig>${orig}</orig><reg>${reg}</reg></choice>`;
      return tok.supplied ? `<supplied reason="lost" cert="${tok.cert}" resp="#${ids.lab}">${inner}</supplied>` : inner;
    }
    case "gap":
      return "";
  }
}

function lineXml(tokens: EditionToken[], ids: RespIds): string {
  // 연속된 같은 사유의 gap은 하나로 합친다 (quantity)
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === "gap") {
      let n = 1;
      while (i + n < tokens.length) {
        const nx = tokens[i + n]!;
        if (nx.kind !== "gap" || nx.reason !== t.reason) break;
        n++;
      }
      out.push(`<gap reason="${t.reason}" quantity="${n}" unit="character"/>`);
      i += n;
    } else {
      out.push(tokenXml(t, ids));
      i++;
    }
  }
  return out.join("");
}

function biblXml(e: BibliographyEntry, indent: string, xmlId: string): string {
  const parts: string[] = [];
  for (const a of e.author) {
    parts.push(
      a.literal
        ? `<author>${xmlEscape(a.literal)}</author>`
        : `<author>${a.family ? `<surname>${xmlEscape(a.family)}</surname>` : ""}${a.given ? `<forename>${xmlEscape(a.given)}</forename>` : ""}</author>`
    );
  }
  for (const ed of e.editor) parts.push(`<editor>${xmlEscape(ed.literal ?? [ed.family, ed.given].filter(Boolean).join(", "))}</editor>`);
  const level = e.type === "article-journal" || e.type === "chapter" || e.type === "paper-conference" ? "a" : "m";
  parts.push(`<title level="${level}">${xmlEscape(e.title)}</title>`);
  if (e.containerTitle) parts.push(`<title level="${e.type === "article-journal" ? "j" : "m"}">${xmlEscape(e.containerTitle)}</title>`);
  if (e.volume) parts.push(`<biblScope unit="volume">${xmlEscape(e.volume)}</biblScope>`);
  if (e.issue) parts.push(`<biblScope unit="issue">${xmlEscape(e.issue)}</biblScope>`);
  if (e.page) parts.push(`<biblScope unit="page">${xmlEscape(e.page)}</biblScope>`);
  if (e.publisher) parts.push(`<publisher>${xmlEscape(e.publisher)}</publisher>`);
  if (e.publisherPlace) parts.push(`<pubPlace>${xmlEscape(e.publisherPlace)}</pubPlace>`);
  if (e.issued) parts.push(`<date when="${String(e.issued.year).padStart(4, "0")}">${e.issued.year}</date>`);
  if (e.DOI) parts.push(`<idno type="DOI">${xmlEscape(e.DOI)}</idno>`);
  if (e.URL) parts.push(`<ptr target="${xmlEscape(e.URL)}"/>`);
  return `${indent}<bibl xml:id="${xmlId}">${parts.join("")}</bibl>`;
}

function langOf(e: { language: string }): string {
  return e.language || "ko";
}

/** 탭 하나의 EpiDoc <TEI> 요소 (XML 선언 없이) */
function epiDocTei(input: ExportInput, tab: SteleTab, indent = ""): string {
  const I = (n: number) => indent + "  ".repeat(n);
  const cells = input.glyphCells.filter((g) => g.steleTabId === tab.id);
  const hypByCell = bestHypothesisByCell(input.hypotheses.filter((h) => cells.some((c) => c.id === h.glyphCellId)));
  const adopted = adoptedMap(input);
  const readingsByCell = activeReadings(input);
  const tabReadings = (input.readings ?? []).filter((r) => r.steleTabId === tab.id);
  const virtualTabs = new Set(input.virtualTabIds ?? input.tabs.map((t) => t.id));
  const subtype = virtualTabs.has(tab.id) ? "virtual-demo" : "user-data";
  const bibById = new Map((input.bibliography ?? []).map((b) => [b.id, b]));

  // xml:id는 teiCorpus 안에서 문서 전체 유일해야 하므로 탭 id를 접두어로 붙인다
  const tabKey = toXmlId("", tab.id);
  const labId = `lab-${tabKey}`;
  const autoId = `auto-${tabKey}`;
  const bibId = (id: string) => toXmlId(`bib-${tabKey}-`, id);
  // 판독자 목록 → respStmt xml:id
  const readers = new Map<string, string>();
  for (const r of tabReadings) {
    const key = `${r.sourceType}:${readerLabel(r)}`;
    if (!readers.has(key)) readers.set(key, `rdr-${tabKey}-${readers.size + 1}`);
  }
  const usedBib = new Set<string>();
  for (const r of tabReadings) if (r.bibliographyId && bibById.has(r.bibliographyId)) usedBib.add(r.bibliographyId);
  for (const d of input.documents ?? []) if (d.bibliographyId && bibById.has(d.bibliographyId)) usedBib.add(d.bibliographyId);

  const L: string[] = [];
  L.push(`${I(0)}<TEI xmlns="http://www.tei-c.org/ns/1.0" xml:lang="ko" xml:id="${toXmlId("tab-", tab.id)}">`);
  L.push(`${I(1)}<teiHeader>`);
  L.push(`${I(2)}<fileDesc>`);
  L.push(`${I(3)}<titleStmt>`);
  L.push(`${I(4)}<title>${xmlEscape(tab.title)}</title>`);
  L.push(`${I(4)}<respStmt xml:id="${labId}"><resp>판독 검토·채택</resp><name>${xmlEscape(input.researchSet.name)} 연구실</name></respStmt>`);
  L.push(`${I(4)}<respStmt xml:id="${autoId}"><resp>자동 판독 제안 (사람 검토 전, 확실도 medium 이하)</resp><name>Seokmun pipeline ${xmlEscape(input.modelVersion)}</name></respStmt>`);
  for (const [key, id] of readers) {
    L.push(`${I(4)}<respStmt xml:id="${id}"><resp>판독 (${xmlEscape(key.split(":")[0]!)})</resp><name>${xmlEscape(key.slice(key.indexOf(":") + 1))}</name></respStmt>`);
  }
  L.push(`${I(3)}</titleStmt>`);
  L.push(`${I(3)}<publicationStmt>`);
  L.push(`${I(4)}<authority>${xmlEscape(input.researchSet.name)} (Seokmun Studio)</authority>`);
  L.push(`${I(4)}<idno type="filename">${xmlEscape(tab.id)}.xml</idno>`);
  L.push(`${I(4)}<availability><p>권리 상태: ${xmlEscape(tab.rightsState)}. 자산별 권리는 내보내기 manifest 참조. ${input.audience === "PUBLIC" ? "외부 공개본 — 재배포 미허용 자산 제외." : "내부 연구용."}</p></availability>`);
  L.push(`${I(4)}<date when="${input.generatedAt.slice(0, 10)}">${input.generatedAt.slice(0, 10)}</date>`);
  L.push(`${I(3)}</publicationStmt>`);
  L.push(`${I(3)}<sourceDesc>`);
  L.push(`${I(4)}<msDesc>`);
  L.push(`${I(5)}<msIdentifier>${tab.location ? `<settlement>${xmlEscape(tab.location)}</settlement>` : ""}<idno>${xmlEscape(tab.id)}</idno>${
    tab.alternativeNames.length ? `<msName>${xmlEscape(tab.canonicalName)}</msName>` : ""
  }</msIdentifier>`);
  if (tab.material) {
    L.push(`${I(5)}<physDesc><objectDesc><supportDesc><support><material>${xmlEscape(tab.material)}</material></support></supportDesc></objectDesc></physDesc>`);
  }
  L.push(`${I(5)}<history><origin>${tab.location ? `<origPlace>${xmlEscape(tab.location)}</origPlace>` : ""}<origDate>${xmlEscape(tab.periodEstimate || "연대 미상")}</origDate></origin></history>`);
  L.push(`${I(4)}</msDesc>`);
  if (input.sourceRecords.some((s) => s.steleTabId === tab.id)) {
    L.push(`${I(4)}<listBibl type="sources">`);
    for (const s of input.sourceRecords.filter((x) => x.steleTabId === tab.id)) {
      L.push(`${I(5)}<bibl xml:id="${toXmlId("src-", s.id)}"><publisher>${xmlEscape(s.publisher)}</publisher>${s.url ? `<ptr target="${xmlEscape(s.url)}"/>` : ""}<note>rights: ${xmlEscape(s.rightsState)}</note></bibl>`);
    }
    L.push(`${I(4)}</listBibl>`);
  }
  L.push(`${I(3)}</sourceDesc>`);
  L.push(`${I(2)}</fileDesc>`);
  L.push(`${I(2)}<encodingDesc>`);
  L.push(`${I(3)}<projectDesc><p n="seokmun-pipeline">Seokmun Studio 내보내기 — 분석 모델 ${xmlEscape(input.modelVersion)}, 코퍼스 ${xmlEscape(input.corpusVersion)}.</p></projectDesc>`);
  L.push(`${I(3)}<editorialDecl><p>판독 우선순위: 연구실 채택 판독(PI 승인) &gt; 원문 관측 &gt; 자동 확정. 자동 확정(resp #${autoId})은 사람 검토 전 기계 제안이며 cert를 medium 이하로 둔다. 판독자별 이견은 apparatus에 lem/rdg로 기록한다.</p></editorialDecl>`);
  L.push(`${I(2)}</encodingDesc>`);
  L.push(`${I(2)}<profileDesc>`);
  L.push(`${I(3)}<langUsage><language ident="lzh">고전 한문</language><language ident="ko">한국어</language></langUsage>`);
  L.push(`${I(2)}</profileDesc>`);
  L.push(`${I(2)}<revisionDesc>`);
  L.push(`${I(3)}<change when="${input.generatedAt.slice(0, 10)}">Seokmun 내보내기 (${xmlEscape(input.modelVersion)})</change>`);
  L.push(`${I(2)}</revisionDesc>`);
  L.push(`${I(1)}</teiHeader>`);
  L.push(`${I(1)}<text>`);
  L.push(`${I(2)}<body>`);
  L.push(`${I(3)}<div type="edition" subtype="${subtype}" xml:lang="lzh" xml:space="preserve">`);
  const apparatus: string[] = [];
  const faces = orderedCellsByFaceLine(cells);
  if (faces.length === 0) {
    L.push(`${I(4)}<ab><gap reason="lost" extent="unknown" unit="character"/></ab>`);
  }
  for (const face of faces) {
    const faceLabel = faceLabelFor(face.faceId, input.faceLabels);
    L.push(`${I(4)}<div type="textpart" subtype="face" n="${xmlEscape(faceLabel)}">`);
    L.push(`${I(5)}<ab>`);
    for (const [lineIndex, lineCells] of face.lines) {
      const tokens = lineCells.map((c) => editionTokenFor(c, adopted.get(c.id), hypByCell.get(c.id)));
      L.push(`${I(6)}<lb n="${lineIndex}"/>${lineXml(tokens, { lab: labId, auto: autoId })}`);
      for (const c of lineCells) {
        const rs = readingsByCell.get(c.id) ?? [];
        const distinct = new Set(rs.map((r) => (r.readingKind === "CHARACTER" ? r.reading ?? "?" : r.readingKind)));
        if (distinct.size < 2) continue;
        const adoptedR = adopted.get(c.id);
        const src = (r: Reading) =>
          r.bibliographyId && bibById.has(r.bibliographyId) ? ` source="#${bibId(r.bibliographyId)}"` : "";
        const who = (r: Reading) => ` resp="#${readers.get(`${r.sourceType}:${readerLabel(r)}`)}"`;
        const rdgText = (r: Reading) =>
          r.readingKind === "CHARACTER" && r.reading ? xmlEscape(r.reading) : `<gap reason="${r.readingKind === "LACUNA" ? "lost" : "illegible"}" quantity="1" unit="character"/>`;
        const parts: string[] = [];
        if (adoptedR) parts.push(`<lem${who(adoptedR)}${src(adoptedR)}>${rdgText(adoptedR)}</lem>`);
        for (const r of rs) if (r !== adoptedR) parts.push(`<rdg${who(r)}${src(r)}>${rdgText(r)}</rdg>`);
        apparatus.push(`${I(5)}<app loc="${xmlEscape(`${faceLabel} ${lineIndex}.${c.sequenceIndex}`)}">${parts.join("")}</app>`);
      }
    }
    L.push(`${I(5)}</ab>`);
    L.push(`${I(4)}</div>`);
  }
  L.push(`${I(3)}</div>`);
  if (apparatus.length > 0) {
    L.push(`${I(3)}<div type="apparatus">`);
    L.push(`${I(4)}<listApp>`);
    L.push(...apparatus);
    L.push(`${I(4)}</listApp>`);
    L.push(`${I(3)}</div>`);
  }
  if (usedBib.size > 0) {
    L.push(`${I(3)}<div type="bibliography">`);
    L.push(`${I(4)}<listBibl>`);
    for (const id of usedBib) L.push(biblXml(bibById.get(id)!, I(5), bibId(id)));
    L.push(`${I(4)}</listBibl>`);
    L.push(`${I(3)}</div>`);
  }
  L.push(`${I(2)}</body>`);
  L.push(`${I(1)}</text>`);
  L.push(`${I(0)}</TEI>`);
  return L.join("\n");
}

/**
 * EpiDoc(TEI) XML.
 * 탭(비석) 하나면 <TEI>, 여럿이면 <teiCorpus> 안에 비석별 <TEI>.
 *  원문 관측 → 문자, 불확실 → <unclear cert>, 복원 → <supplied reason cert resp>,
 *  결락·판독 불가 → <gap reason quantity> (연속 병합), 이견 → apparatus <app><lem/><rdg/></app>.
 */
export function exportEpiDoc(input: ExportInput, opts: { tabId?: string } = {}): string {
  const tabs = opts.tabId ? input.tabs.filter((t) => t.id === opts.tabId) : input.tabs;
  const decl = `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-model href="https://epidoc.stoa.org/schema/9.8/tei-epidoc.rng" schematypens="http://relaxng.org/ns/structure/1.0"?>`;
  if (tabs.length === 1) return `${decl}\n${epiDocTei(input, tabs[0]!)}\n`;
  const L: string[] = [decl];
  L.push(`<teiCorpus xmlns="http://www.tei-c.org/ns/1.0" xml:lang="ko">`);
  L.push(`  <teiHeader>`);
  L.push(`    <fileDesc>`);
  L.push(`      <titleStmt><title>${xmlEscape(input.researchSet.name)} — Seokmun 비석 판독문 모음</title></titleStmt>`);
  L.push(`      <publicationStmt><authority>${xmlEscape(input.researchSet.name)} (Seokmun Studio)</authority><date when="${input.generatedAt.slice(0, 10)}">${input.generatedAt.slice(0, 10)}</date></publicationStmt>`);
  L.push(`      <sourceDesc><p>비석별 출처는 각 TEI 헤더 참조.</p></sourceDesc>`);
  L.push(`    </fileDesc>`);
  L.push(`  </teiHeader>`);
  for (const tab of tabs) L.push(epiDocTei(input, tab, "  "));
  L.push(`</teiCorpus>`);
  return `${L.join("\n")}\n`;
}

// ── 보고서 (Markdown) ──

export function exportReport(input: ExportInput): string {
  const manifest = buildManifest(input);
  const hypByCell = bestHypothesisByCell(input.hypotheses);
  const adopted = adoptedMap(input);
  const lines: string[] = [];
  lines.push(`# ${input.researchSet.name} — 연구 실행 보고서`);
  lines.push("");
  lines.push(`> 생성: ${input.generatedAt} · 모델 ${input.modelVersion} · 코퍼스 ${input.corpusVersion}`);
  lines.push(`> 대상: ${input.audience === "PUBLIC" ? "외부 공개" : "내부 연구"}`);
  lines.push("");
  lines.push(
    `**주의**: VIRTUAL_DEMO로 표시된 자산과 [가상 문헌] 표기가 있는 근거는 데모용 창작물이며 실제 비석 데이터·실제 판독 결과가 아니다.`
  );
  lines.push("");
  lines.push(`판독문 표기: 문자 = 판독, \`字?\` = 불확실, \`[字]\` = 복원(보충), \`字(異)\` = 이체자, □ = 결락, ▨ = 판독 불가.`);
  lines.push(`우선순위: 연구실 채택 판독 > 원문 관측 > 자동 확정(기계 제안, 검토 전).`);
  lines.push("");
  lines.push(`## 탭 요약`);
  for (const tab of input.tabs) {
    const cells = input.glyphCells.filter((g) => g.steleTabId === tab.id);
    const unresolved = cells.filter((g) =>
      ["UNKNOWN", "CONFLICTING", "PARTIALLY_OBSERVED", "ILLEGIBLE"].includes(g.readingStatus)
    ).length;
    const adoptedN = cells.filter((c) => adopted.has(c.id)).length;
    lines.push(
      `- **${tab.title}** — 역할: ${tab.roles.join(", ")} · 자산 모드: ${tab.assetMode} · 권리: ${tab.rightsState} · 문자 셀 ${cells.length}개 (미해결 ${unresolved}, 연구실 채택 ${adoptedN})`
    );
  }
  lines.push("");
  lines.push(`## 판독문`);
  for (const tab of input.tabs) {
    const cells = input.glyphCells.filter((g) => g.steleTabId === tab.id);
    if (cells.length === 0) continue;
    lines.push(`### ${tab.title}`);
    for (const face of orderedCellsByFaceLine(cells)) {
      lines.push(`**${faceLabelFor(face.faceId, input.faceLabels)}**`);
      lines.push("```text");
      for (const [lineIndex, lineCells] of face.lines) {
        const text = lineCells.map((c) => leidenText(editionTokenFor(c, adopted.get(c.id), hypByCell.get(c.id)))).join("");
        lines.push(`${String(lineIndex).padStart(2, " ")}  ${text}`);
      }
      lines.push("```");
    }
    lines.push("");
  }
  lines.push(`## 판독 결정 (자동 분석)`);
  const cellById = new Map(input.glyphCells.map((g) => [g.id, g]));
  for (const h of input.hypotheses) {
    const cell = cellById.get(h.glyphCellId);
    if (!cell) continue;
    const failed = h.gateResult?.failedRules ?? [];
    const notEvaluated = (h.gateResult?.ruleTrace ?? []).filter((r) => r.status === "NOT_EVALUATED").map((r) => r.rule);
    lines.push(
      `- ${cellLabel(cell, input.faceLabels)} (\`${h.glyphCellId}\`) → **${h.status}** (후보 ${h.candidateCharacter}, 신뢰도 ${h.calibratedConfidence}${h.gateResult?.calibration ? `, 보정 ${h.gateResult.calibration.kind}` : ""})` +
        (failed.length > 0 ? ` — 게이트 실패 사유: ${failed.join(", ")}` : "") +
        (notEvaluated.length > 0 ? ` — 미평가 규칙: ${notEvaluated.join(", ")}` : "")
    );
  }
  lines.push("");
  if ((input.readings ?? []).length > 0) {
    lines.push(`## 판독자별 비교`);
    for (const tab of input.tabs) {
      const cells = input.glyphCells.filter((g) => g.steleTabId === tab.id);
      const table = buildReadingComparison(
        cells,
        (input.readings ?? []).filter((r) => r.steleTabId === tab.id),
        { faceLabels: Object.fromEntries(cells.map((c) => [c.faceId, faceLabelFor(c.faceId, input.faceLabels)])) }
      );
      const rows = table.rows.filter((r) => Object.keys(r.values).length > 0);
      if (rows.length === 0) continue;
      lines.push(`### ${tab.title}`);
      lines.push(`| 위치 | ${table.columns.map((c) => c.label).join(" | ")} | 채택 |`);
      lines.push(`|---|${table.columns.map(() => "---").join("|")}|---|`);
      for (const r of rows) {
        lines.push(
          `| ${r.faceLabel} ${r.lineIndex}행 ${r.sequenceIndex}자${r.disagreement ? " ⚠" : ""} | ${table.columns
            .map((c) => r.values[c.key] ?? "")
            .join(" | ")} | ${r.adopted ?? ""} |`
        );
      }
      lines.push("");
    }
  }
  const bib = input.bibliography ?? [];
  if (bib.length > 0) {
    lines.push(`## 참고문헌`);
    for (const line of formatBibliographyList(bib)) lines.push(`- ${line}`);
    lines.push("");
  }
  const fictional = (input.documents ?? []).filter((d) => d.isFictional);
  if (fictional.length > 0) {
    lines.push(`## 가상 문헌 (데모)`);
    for (const d of fictional) lines.push(`- [가상 문헌] ${d.title} — ${d.publisher}, ${d.publishedAt}`);
    lines.push("");
  }
  lines.push(`## 출처·권리 manifest`);
  lines.push("```json");
  lines.push(JSON.stringify(manifest, null, 2));
  lines.push("```");
  return lines.join("\n");
}

