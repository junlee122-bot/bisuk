/**
 * 자율 판독 파이프라인 (데모 결정적 구현).
 *
 * 단계 (PRD §14):
 *  1. 대상 비석의 관측 획만으로 독립 시각 후보 생성 (다른 비석 판독 주입 금지)
 *  2. 문헌 주석에서 후보 추가 (LITERATURE origin)
 *  3. 교차 비석 유사 글자 매칭 (비교 단계에서만 사용)
 *  4. 인용 검증 + 출처 계보 병합 (재인용은 독립 근거로 세지 않음)
 *  5. 보정 신뢰도 계산 → Decision Gate
 *
 * 벤치마크 누출 문서(benchmarkLeak)와 그 파생 문서는 근거에서 제외하고 제외 사실을 보고한다.
 *
 * v2 선택 입력 (없으면 데모 동작 유지):
 *  - exemplars: 연구실 등록 자형 표본 (글자별 복수) — 시각 점수는 표본 중 최고값
 *  - variantRegistry: 인용 이체자 접기 + 이체자끼리는 경쟁 후보로 보지 않음(차순위 계산)
 *  - contextModel: 판독문 n-gram 문맥 점수 (학습량 부족하면 휴리스틱으로 대체·표시)
 *  - chronology: 비석 연대·글자 최초 확인 연도 → 연대 모순 규칙 실제 평가
 *  - calibration: 평가셋으로 적합한 보정 프로파일
 *  - demoMode(기본 true): false이고 보정 프로파일이 없으면 자동 확정하지 않는다
 */
import type {
  CalibrationProfile,
  CrossSteleMatch,
  DecisionGateInput,
  DecisionGateResult,
  GlyphStrokes,
} from "@seokmun/types";
import { applyCalibration } from "./calibration";
import { ENGINE_ANALYSIS_VERSION } from "./canonicalJson";
import { verifyCitation, type CitationMatchType, type TargetSpecificity } from "./citation";
import type { CharContextModel } from "./contextModel";
import { GATE_THRESHOLDS, runDecisionGate } from "./decisionGate";
import {
  SIMILARITY_V2,
  bestExemplarSimilarity,
  cosineSimilarity,
  featureVector,
  jitterPolylines,
  observedPolylines,
  strokeSetSimilarity,
  type Polyline,
} from "./glyphFeatures";
import {
  buildLineages,
  countIndependentLineages,
  countVerifiedPrimaryOrDirect,
  type GenealogyDoc,
  type LineageGroup,
} from "./genealogy";
import type { VariantRegistry } from "./variants";

export interface PipelineGlyphCell {
  id: string;
  steleTabId: string;
  lineIndex: number;
  sequenceIndex: number;
  observabilityScore: number;
  damageGrade: number;
  readingStatus: string;
  publishedReading: string | null;
  strokes: GlyphStrokes | null;
  styleJitter?: number;
  /** 숨김 벤치마크 셀 — 판독이 분석에 흘러들면 누출로 판정 */
  hiddenBenchmark?: boolean;
}

export interface PipelineTab {
  id: string;
  title: string;
  periodEstimate: string;
  scriptFamily: "GOGURYEO" | "SILLA" | "OTHER";
}

export interface PipelineDocument {
  id: string;
  title: string;
  content: string;
  reliabilityTier: number;
  independenceGroup: string;
  derivedFromDocumentId: string | null;
  benchmarkLeak?: boolean;
  claims: Array<{
    targetGlyphCellId: string;
    character: string;
    stance: "SUPPORT" | "COUNTER";
    quote: string;
  }>;
}

export interface PipelineInput {
  cell: PipelineGlyphCell;
  tab: PipelineTab;
  allTabs: PipelineTab[];
  cellsByTab: Map<string, PipelineGlyphCell[]>;
  priors: Record<string, { polylines: Array<Array<[number, number]>> }>;
  documents: PipelineDocument[];
  modelVersion: string;
  corpusVersion: string;
  /** 글자별 추가 자형 표본 (연구실 등록) */
  exemplars?: Record<string, Array<{ id: string; polylines: Polyline[] }>>;
  variantRegistry?: VariantRegistry;
  contextModel?: CharContextModel;
  chronology?: {
    /** 비석 추정 연대 (서기), 모르면 null */
    tabYear: number | null;
    earliestYearByChar: Record<string, number>;
    /** 허용 오차 (년) — 최초 확인 연도가 비석 연대+허용 오차보다 늦으면 모순 */
    toleranceYears?: number;
  };
  calibration?: CalibrationProfile | null;
  /** 기본 true — 데모 휴리스틱 보정 허용. false면 보정 프로파일 없이는 자동 확정 불가 */
  demoMode?: boolean;
  /** 시각 후보 수 (동점 포함), 기본 4 */
  topK?: number;
}

export interface PipelineCandidate {
  candidateCharacter: string;
  origin: "VISUAL" | "INTRA_STELE" | "CROSS_STELE" | "LITERATURE";
  visualScore: number;
  geometryScore: number;
  contextScore: number;
  crossSteleScore: number;
  textualScore: number;
  intraSteleScore: number;
  /** 보정 전 통합 점수 */
  rawScore: number;
  calibratedConfidence: number;
  /** 시각 점수를 낸 표본 ("prior" 또는 표본 id) */
  bestExemplar: string | null;
  /** 이체자 동치류 대표 (레지스트리가 있을 때) */
  variantGroup: string | null;
}

export interface PipelineEvidence {
  kind: "SUPPORT" | "COUNTER";
  candidateCharacter: string;
  documentId: string;
  quote: string;
  quoteOffset: number | null;
  citationVerified: boolean;
  citationContext: string;
  citationMatchType: CitationMatchType;
  targetSpecificity: TargetSpecificity;
  independenceGroup: string;
  reliabilityTier: number;
  derivedFromDocumentId: string | null;
  documentTitle: string;
}

export interface PipelineResult {
  candidates: PipelineCandidate[];
  crossSteleMatches: Array<Omit<CrossSteleMatch, "id" | "createdAt">>;
  evidence: PipelineEvidence[];
  topCandidate: PipelineCandidate | null;
  gateInput: DecisionGateInput | null;
  gateResult: DecisionGateResult | null;
  independentLineageCount: number;
  verifiedPrimaryOrDirectSourceCount: number;
  excludedLeakDocumentIds: string[];
  /** 누출 문서에서 파생되어 제외된 문서 */
  excludedDerivedFromLeakDocumentIds: string[];
  lineages: LineageGroup[];
  /** 재현용 파라미터 스냅샷 */
  parameters: Record<string, unknown>;
  /** 독립 근거가 아니라 다른 점수에서 계산된 보고용 축 */
  derivedAxes: string[];
  supports: {
    visual: number;
    geometric: number;
    intraStele: number;
    crossStele: number;
    textual: number;
    historical: number;
    counterStrength: number;
  } | null;
}

function cellPolylines(cell: PipelineGlyphCell, observedOnly: boolean): Polyline[] {
  if (!cell.strokes) return [];
  const lines = observedOnly
    ? observedPolylines(cell.strokes)
    : cell.strokes.polylines;
  return jitterPolylines(lines, cell.styleJitter ?? 0, cell.id);
}

function scriptScore(a: PipelineTab, b: PipelineTab): number {
  if (a.scriptFamily === b.scriptFamily) return 0.85;
  if (a.scriptFamily === "OTHER" || b.scriptFamily === "OTHER") return 0.5;
  return 0.65;
}

function periodScore(a: PipelineTab, b: PipelineTab): number {
  // 데모 근사: 같은 계열 시대 표기가 비어 있지 않으면 근접으로 간주
  if (!a.periodEstimate || !b.periodEstimate) return 0.5;
  const ga = a.periodEstimate.includes("고구려");
  const gb = b.periodEstimate.includes("고구려");
  const sa = a.periodEstimate.includes("신라");
  const sb = b.periodEstimate.includes("신라");
  if ((ga && gb) || (sa && sb)) return 0.9;
  if ((ga || sa) && (gb || sb)) return 0.7;
  return 0.5;
}

/** 이웃 셀 관측 여부 기반 문맥 점수 */
function contextScoreFor(
  cell: PipelineGlyphCell,
  sameTabCells: PipelineGlyphCell[]
): number {
  const prev = sameTabCells.find(
    (c) => c.lineIndex === cell.lineIndex && c.sequenceIndex === cell.sequenceIndex - 1
  );
  const next = sameTabCells.find(
    (c) => c.lineIndex === cell.lineIndex && c.sequenceIndex === cell.sequenceIndex + 1
  );
  const isObs = (c?: PipelineGlyphCell) => c?.readingStatus === "OBSERVED";
  if (isObs(prev) && isObs(next)) return 0.7;
  if (isObs(prev) || isObs(next)) return 0.5;
  return 0.3;
}

export function analyzeGlyphCell(input: PipelineInput): PipelineResult {
  const { cell, tab, priors, documents } = input;
  const demoMode = input.demoMode ?? true;
  const topK = Math.max(1, input.topK ?? 4);
  const registry = input.variantRegistry;
  const sameTabCells = input.cellsByTab.get(tab.id) ?? [];
  const observed = cellPolylines(cell, true);
  /** 분석에 판독이 쓰인 숨김 벤치마크 셀 (있으면 누출) */
  const leakedHiddenCells = new Set<string>();
  const readingOf = (c: PipelineGlyphCell | undefined): string | null => {
    if (!c || !c.publishedReading) return null;
    if (c.readingStatus !== "OBSERVED" && c.readingStatus !== "HUMAN_ACCEPTED" && c.readingStatus !== "AUTO_ACCEPTED")
      return null;
    if (c.hiddenBenchmark) leakedHiddenCells.add(c.id);
    return c.publishedReading;
  };

  // 문맥: 학습된 n-gram 모델이 충분하면 후보별 점수, 아니면 데모 휴리스틱(셀 단위)
  const useContextModel = Boolean(input.contextModel?.usable);
  const contextMethod = useContextModel ? "CHAR_NGRAM" : demoMode ? "DEMO_NEIGHBOR_HEURISTIC" : "NEUTRAL";
  const baseCtx = contextMethod === "DEMO_NEIGHBOR_HEURISTIC" ? contextScoreFor(cell, sameTabCells) : 0.5;
  const neighbor = (d: number) =>
    sameTabCells.find((c) => c.lineIndex === cell.lineIndex && c.sequenceIndex === cell.sequenceIndex + d);
  const prevChar = useContextModel ? readingOf(neighbor(-1)) : null;
  const nextChar = useContextModel ? readingOf(neighbor(1)) : null;

  // ── 1. 독립 시각 후보 (대상 비석 관측 획 + 자형 참조표·등록 표본만 사용) ──
  const visualScores = new Map<string, number>();
  const bestExemplarByChar = new Map<string, string>();
  if (observed.length > 0) {
    const chars = new Set([...Object.keys(priors), ...Object.keys(input.exemplars ?? {})]);
    for (const char of chars) {
      const sources: Array<{ id: string; polylines: Polyline[] }> = [];
      if (priors[char]) sources.push({ id: "prior", polylines: priors[char]!.polylines as Polyline[] });
      for (const ex of input.exemplars?.[char] ?? []) sources.push(ex);
      const best = bestExemplarSimilarity(observed, sources.map((x) => x.polylines));
      if (best.score > 0.3) {
        visualScores.set(char, Math.round(best.score * 1000) / 1000);
        bestExemplarByChar.set(char, sources[best.index]!.id);
      }
    }
  }
  // CJK localeCompare는 ICU 구성에 따라 달라지므로 코드포인트 비교로 결정성 확보
  const cmpChar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const visualRanked = [...visualScores.entries()].sort(
    (a, b) => b[1] - a[1] || cmpChar(a[0], b[0])
  );
  // 상위 K개 + K번째와 동점인 후보 (동점 절단으로 후보가 임의로 빠지지 않게)
  const kth = visualRanked[Math.min(topK, visualRanked.length) - 1]?.[1];
  const candidateChars = new Set(
    visualRanked.filter(([, v], i) => i < topK || (kth !== undefined && v === kth)).map(([c]) => c)
  );

  // ── 2. 문헌 주석 후보 + 근거 수집 (누출 문서·그 파생 문서 제외) ──
  const excludedLeakDocumentIds: string[] = [];
  const excludedDerivedFromLeakDocumentIds: string[] = [];
  const docById = new Map(documents.map((d) => [d.id, d]));
  const derivesFromLeak = (doc: PipelineDocument): boolean => {
    const seen = new Set<string>();
    let cur = doc.derivedFromDocumentId ? docById.get(doc.derivedFromDocumentId) : undefined;
    while (cur && !seen.has(cur.id)) {
      if (cur.benchmarkLeak) return true;
      seen.add(cur.id);
      cur = cur.derivedFromDocumentId ? docById.get(cur.derivedFromDocumentId) : undefined;
    }
    return false;
  };
  const evidence: PipelineEvidence[] = [];
  for (const doc of documents) {
    const claims = doc.claims.filter((c) => c.targetGlyphCellId === cell.id);
    if (claims.length === 0) continue;
    if (doc.benchmarkLeak) {
      excludedLeakDocumentIds.push(doc.id);
      continue;
    }
    if (derivesFromLeak(doc)) {
      excludedDerivedFromLeakDocumentIds.push(doc.id);
      continue;
    }
    for (const claim of claims) {
      candidateChars.add(claim.character);
      const check = verifyCitation(doc.content, claim.quote, {
        ...(registry ? { registry } : {}),
        target: { character: claim.character, lineIndex: cell.lineIndex, sequenceIndex: cell.sequenceIndex },
      });
      evidence.push({
        kind: claim.stance,
        candidateCharacter: claim.character,
        documentId: doc.id,
        quote: claim.quote,
        quoteOffset: check.offset,
        citationVerified: check.verified,
        citationContext: check.context,
        citationMatchType: check.matchType,
        targetSpecificity: check.targetSpecificity,
        independenceGroup: doc.independenceGroup,
        reliabilityTier: doc.reliabilityTier,
        derivedFromDocumentId: doc.derivedFromDocumentId,
        documentTitle: doc.title,
      });
    }
  }

  // ── 3. 교차 비석 매칭 (비교 단계 — 독립 후보 생성 이후에만) ──
  const crossSteleMatches: PipelineResult["crossSteleMatches"] = [];
  const crossBest = new Map<string, number>();
  const targetFeature = featureVector(observed);
  for (const otherTab of input.allTabs) {
    if (otherTab.id === tab.id) continue;
    const otherCells = input.cellsByTab.get(otherTab.id) ?? [];
    for (const other of otherCells) {
      if (other.readingStatus !== "OBSERVED" || !other.publishedReading) continue;
      if (!candidateChars.has(other.publishedReading)) continue;
      readingOf(other);
      const otherLines = cellPolylines(other, true);
      if (observed.length === 0 || otherLines.length === 0) continue;
      const visual = strokeSetSimilarity(observed, otherLines);
      const geometry = cosineSimilarity(targetFeature, featureVector(otherLines));
      const stroke =
        Math.min(observed.length, otherLines.length) /
        Math.max(1, Math.max(observed.length, otherLines.length));
      const script = scriptScore(tab, otherTab);
      const period = periodScore(tab, otherTab);
      const combined =
        Math.round(
          (0.4 * visual + 0.15 * geometry + 0.1 * stroke + 0.15 * script + 0.1 * period + 0.1 * baseCtx) *
            1000
        ) / 1000;
      crossSteleMatches.push({
        sourceGlyphCellId: cell.id,
        targetGlyphCellId: other.id,
        targetSteleTabId: otherTab.id,
        matchType: "SAME_CHARACTER",
        visualScore: Math.round(visual * 1000) / 1000,
        geometryScore: Math.round(Math.max(0, geometry) * 1000) / 1000,
        strokeScore: Math.round(stroke * 1000) / 1000,
        scriptScore: script,
        periodScore: period,
        contextScore: baseCtx,
        combinedScore: Math.max(0, combined),
        normalizationMethod: "stroke-resampled-v2",
        modelVersion: input.modelVersion,
      });
      const prev = crossBest.get(other.publishedReading) ?? 0;
      if (combined > prev) crossBest.set(other.publishedReading, combined);
    }
  }
  crossSteleMatches.sort(
    (a, b) =>
      b.combinedScore - a.combinedScore ||
      a.targetGlyphCellId.localeCompare(b.targetGlyphCellId)
  );

  // ── 4. 계보·인용 통계 (후보별) ──
  const supportDocsByChar = new Map<string, GenealogyDoc[]>();
  const counterDocsByChar = new Map<string, GenealogyDoc[]>();
  for (const ev of evidence) {
    if (!ev.citationVerified) continue;
    const target = ev.kind === "SUPPORT" ? supportDocsByChar : counterDocsByChar;
    const list = target.get(ev.candidateCharacter) ?? [];
    // 같은 문서의 복수 인용은 근거 문서 1건으로만 계산한다
    if (!list.some((d) => d.id === ev.documentId)) {
      list.push({
        id: ev.documentId,
        title: ev.documentTitle,
        independenceGroup: ev.independenceGroup,
        derivedFromDocumentId: ev.derivedFromDocumentId,
        reliabilityTier: ev.reliabilityTier,
      });
    }
    target.set(ev.candidateCharacter, list);
  }

  const universe: GenealogyDoc[] = documents.map((d) => ({
    id: d.id,
    title: d.title,
    independenceGroup: d.independenceGroup,
    derivedFromDocumentId: d.derivedFromDocumentId,
    reliabilityTier: d.reliabilityTier,
  }));
  const textualScoreFor = (char: string): number => {
    const docs = supportDocsByChar.get(char) ?? [];
    if (docs.length === 0) return 0;
    const lineages = countIndependentLineages(docs, universe);
    const hasDirect = countVerifiedPrimaryOrDirect(docs) > 0;
    return Math.min(1, 0.5 + 0.2 * Math.min(2, lineages - 1) + (hasDirect ? 0.2 : 0));
  };

  // ── 5. 후보 통합 점수 + 보정 신뢰도 ──
  const ctxByChar = useContextModel
    ? input.contextModel!.scoreCandidates(prevChar, nextChar, [...candidateChars])
    : null;
  const calibrationKind: "FITTED" | "DEMO_HEURISTIC" | "UNCALIBRATED" = input.calibration
    ? "FITTED"
    : demoMode
      ? "DEMO_HEURISTIC"
      : "UNCALIBRATED";
  const candidates: PipelineCandidate[] = [...candidateChars].map((char) => {
    const ctx = ctxByChar?.get(char) ?? baseCtx;
    const rawVisual = visualScores.get(char) ?? 0;
    const visual = Math.max(rawVisual, supportDocsByChar.has(char) ? 0.05 : rawVisual);
    const cross = Math.max(0, crossBest.get(char) ?? 0);
    const textual = textualScoreFor(char);
    // 같은 비석 안의 동일 판독 글자 유사도 (보고용)
    let intra = 0;
    for (const other of sameTabCells) {
      if (other.id === cell.id) continue;
      if (other.readingStatus !== "OBSERVED" || other.publishedReading !== char) continue;
      const sim = strokeSetSimilarity(observed, cellPolylines(other, true));
      intra = Math.max(intra, sim);
    }
    const raw = 0.45 * visual + 0.2 * cross + 0.25 * textual + 0.1 * ctx;
    const calibratedValue =
      calibrationKind === "FITTED"
        ? applyCalibration(input.calibration!, raw)
        : calibrationKind === "DEMO_HEURISTIC"
          ? 0.85 * raw + 0.15 * cell.observabilityScore
          : raw;
    const calibrated = Math.round(calibratedValue * 1000) / 1000;
    const origin: PipelineCandidate["origin"] =
      rawVisual > 0 ? "VISUAL" : supportDocsByChar.has(char) ? "LITERATURE" : "CROSS_STELE";
    return {
      candidateCharacter: char,
      origin,
      visualScore: Math.round(visual * 1000) / 1000,
      geometryScore: Math.round(Math.min(1, observed.length > 0 ? 0.4 + 0.4 * visual : 0) * 1000) / 1000,
      contextScore: ctx,
      crossSteleScore: Math.round(cross * 1000) / 1000,
      textualScore: Math.round(textual * 1000) / 1000,
      intraSteleScore: Math.round(intra * 1000) / 1000,
      rawScore: Math.round(raw * 1000) / 1000,
      calibratedConfidence: calibrated,
      bestExemplar: bestExemplarByChar.get(char) ?? null,
      variantGroup: registry && registry.classOf(char).length > 1 ? registry.representative(char) : null,
    };
  });
  candidates.sort(
    (a, b) =>
      b.calibratedConfidence - a.calibratedConfidence ||
      cmpChar(a.candidateCharacter, b.candidateCharacter)
  );

  const parameters: Record<string, unknown> = {
    engineVersion: ENGINE_ANALYSIS_VERSION,
    weights: { visual: 0.45, crossStele: 0.2, textual: 0.25, context: 0.1 },
    crossSteleWeights: { visual: 0.4, geometry: 0.15, stroke: 0.1, script: 0.15, period: 0.1, context: 0.1 },
    visualThreshold: 0.3,
    topK,
    similarity: { version: 2, ...SIMILARITY_V2 },
    contextMethod,
    contextCorpusChars: input.contextModel?.totalChars ?? 0,
    calibrationKind,
    calibrationProfileId: input.calibration?.id ?? null,
    demoMode,
    gateThresholds: GATE_THRESHOLDS,
    exemplarCount: Object.values(input.exemplars ?? {}).reduce((s, l) => s + l.length, 0),
    variantClasses: registry ? registry.size : 0,
    chronologyAvailable: Boolean(input.chronology),
  };
  const derivedAxes = ["geometric", "historical"];

  const top = candidates[0] ?? null;
  if (!top) {
    return {
      candidates,
      crossSteleMatches,
      evidence,
      topCandidate: null,
      gateInput: null,
      gateResult: null,
      independentLineageCount: 0,
      verifiedPrimaryOrDirectSourceCount: 0,
      excludedLeakDocumentIds,
      excludedDerivedFromLeakDocumentIds,
      lineages: [],
      parameters,
      derivedAxes,
      supports: null,
    };
  }

  // 이체자끼리는 경쟁 판독이 아니다 — 차순위는 1위와 다른 동치류에서 고른다
  const second =
    candidates.slice(1).find((c) => !registry || !registry.areVariants(c.candidateCharacter, top.candidateCharacter)) ??
    null;
  const margin = top.calibratedConfidence - (second?.calibratedConfidence ?? 0);
  const topSupportDocs = supportDocsByChar.get(top.candidateCharacter) ?? [];
  const topCounterDocs = counterDocsByChar.get(top.candidateCharacter) ?? [];
  const independentLineageCount = countIndependentLineages(topSupportDocs, universe);
  const counterLineageCount = topCounterDocs.length > 0 ? countIndependentLineages(topCounterDocs, universe) : 0;
  const verifiedPrimaryOrDirectSourceCount =
    countVerifiedPrimaryOrDirect(topSupportDocs);
  const topEvidence = evidence.filter(
    (e) => e.candidateCharacter === top.candidateCharacter
  );
  const citationVerified =
    topEvidence.filter((e) => e.kind === "SUPPORT").length > 0 &&
    topEvidence.filter((e) => e.kind === "SUPPORT").every((e) => e.citationVerified);

  // 경쟁 후보가 독립 검증 근거를 갖는가 (상충 판단) — top 후보의 근거 유무와 무관
  const charsWithVerifiedSupport = [...supportDocsByChar.entries()]
    .filter(([, docs]) => docs.length > 0)
    .map(([char]) => char);
  const hasCompeting = charsWithVerifiedSupport.some(
    (c) => c !== top.candidateCharacter && !(registry?.areVariants(c, top.candidateCharacter) ?? false)
  );

  // 강한 시각 모순: 관측 획이 충분한데 후보 자형과의 실제 유사도가 극히 낮고 반증도 존재
  const topPrior = priors[top.candidateCharacter];
  const topSources = [
    ...(topPrior ? [topPrior.polylines as Polyline[]] : []),
    ...(input.exemplars?.[top.candidateCharacter] ?? []).map((e) => e.polylines),
  ];
  const topRawSimilarity =
    observed.length > 0 && topSources.length > 0 ? bestExemplarSimilarity(observed, topSources).score : 0;
  const strongVisualContradiction =
    observed.length >= 3 &&
    topRawSimilarity < 0.15 &&
    top.origin === "LITERATURE" &&
    (counterDocsByChar.get(top.candidateCharacter)?.length ?? 0) > 0;

  // 연대 모순 — 글자 최초 확인 연도가 비석 연대(+허용 오차)보다 늦으면 모순
  const chrono = input.chronology;
  const earliest = chrono?.earliestYearByChar[top.candidateCharacter];
  const chronologyEvaluated = Boolean(chrono && chrono.tabYear != null && earliest != null);
  const strongChronologyContradiction =
    chronologyEvaluated && earliest! > chrono!.tabYear! + (chrono!.toleranceYears ?? 30);

  // 누출 검사 — 근거 문서에 누출 표시가 남았거나, 숨김 벤치마크 셀의 판독이 비교·문맥에 쓰였는가
  const benchmarkLeakage =
    evidence.some((e) => docById.get(e.documentId)?.benchmarkLeak) || leakedHiddenCells.size > 0;

  const gateInput: DecisionGateInput = {
    calibratedConfidence: top.calibratedConfidence,
    marginToSecondCandidate: Math.round(margin * 1000) / 1000,
    verifiedPrimaryOrDirectSourceCount,
    independentLineageCount,
    strongVisualContradiction,
    strongChronologyContradiction,
    citationVerified,
    benchmarkLeakage,
    hasCompetingCandidateWithEvidence: hasCompeting,
    observabilityScore: cell.observabilityScore,
    chronologyEvaluated,
    benchmarkLeakageEvaluated: true,
    counterEvidenceDominant: counterLineageCount > 0 && counterLineageCount >= independentLineageCount,
    calibrationKind,
  };
  const gateRaw = runDecisionGate(gateInput, {
    topCandidateVisualScore: top.visualScore,
  });
  const gateResult: DecisionGateResult = {
    ...gateRaw,
    calibration: {
      kind: calibrationKind,
      profileId: input.calibration?.id ?? null,
      n: input.calibration?.n ?? null,
    },
  };

  // 같은 문서가 지지·반대 양쪽에 있으면 한 번만 센다
  const lineageDocs = new Map<string, GenealogyDoc>();
  for (const d of [...supportDocsByChar.values(), ...counterDocsByChar.values()].flat()) lineageDocs.set(d.id, d);
  const supportLineages = buildLineages([...lineageDocs.values()], universe);

  const counterStrength = Math.min(
    1,
    topCounterDocs.length * 0.3 +
      (topCounterDocs.some((d) => d.reliabilityTier <= 2) ? 0.2 : 0)
  );

  return {
    candidates,
    crossSteleMatches,
    evidence,
    topCandidate: top,
    gateInput,
    gateResult,
    independentLineageCount,
    verifiedPrimaryOrDirectSourceCount,
    excludedLeakDocumentIds,
    excludedDerivedFromLeakDocumentIds,
    lineages: supportLineages,
    parameters,
    derivedAxes,
    supports: {
      visual: top.visualScore,
      geometric: top.geometryScore,
      intraStele: top.intraSteleScore,
      crossStele: top.crossSteleScore,
      textual: top.textualScore,
      historical: Math.round(top.contextScore * 0.8 * 1000) / 1000,
      counterStrength: Math.round(counterStrength * 1000) / 1000,
    },
  };
}
