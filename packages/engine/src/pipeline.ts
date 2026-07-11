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
 * 벤치마크 누출 문서(benchmarkLeak)는 근거에서 제외하고 제외 사실을 보고한다.
 */
import type {
  CrossSteleMatch,
  DecisionGateInput,
  DecisionGateResult,
  GlyphStrokes,
} from "@seokmun/types";
import { verifyCitation } from "./citation";
import { runDecisionGate } from "./decisionGate";
import {
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
  calibratedConfidence: number;
}

export interface PipelineEvidence {
  kind: "SUPPORT" | "COUNTER";
  candidateCharacter: string;
  documentId: string;
  quote: string;
  quoteOffset: number | null;
  citationVerified: boolean;
  citationContext: string;
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
  lineages: LineageGroup[];
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
  const sameTabCells = input.cellsByTab.get(tab.id) ?? [];
  const observed = cellPolylines(cell, true);
  const ctx = contextScoreFor(cell, sameTabCells);

  // ── 1. 독립 시각 후보 (대상 비석 관측 획 + 자형 참조표만 사용) ──
  const visualScores = new Map<string, number>();
  if (observed.length > 0) {
    for (const [char, prior] of Object.entries(priors)) {
      const sim = strokeSetSimilarity(observed, prior.polylines as Polyline[]);
      if (sim > 0.3) visualScores.set(char, Math.round(sim * 1000) / 1000);
    }
  }
  const visualRanked = [...visualScores.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const candidateChars = new Set(visualRanked.slice(0, 4).map(([c]) => c));

  // ── 2. 문헌 주석 후보 + 근거 수집 (누출 문서 제외) ──
  const excludedLeakDocumentIds: string[] = [];
  const evidence: PipelineEvidence[] = [];
  for (const doc of documents) {
    const claims = doc.claims.filter((c) => c.targetGlyphCellId === cell.id);
    if (claims.length === 0) continue;
    if (doc.benchmarkLeak) {
      excludedLeakDocumentIds.push(doc.id);
      continue;
    }
    for (const claim of claims) {
      candidateChars.add(claim.character);
      const check = verifyCitation(doc.content, claim.quote);
      evidence.push({
        kind: claim.stance,
        candidateCharacter: claim.character,
        documentId: doc.id,
        quote: claim.quote,
        quoteOffset: check.offset,
        citationVerified: check.verified,
        citationContext: check.context,
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
          (0.4 * visual + 0.15 * geometry + 0.1 * stroke + 0.15 * script + 0.1 * period + 0.1 * ctx) *
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
        contextScore: ctx,
        combinedScore: Math.max(0, combined),
        normalizationMethod: "stroke-endpoint-tolerance-10",
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
    list.push({
      id: ev.documentId,
      title: ev.documentTitle,
      independenceGroup: ev.independenceGroup,
      derivedFromDocumentId: ev.derivedFromDocumentId,
      reliabilityTier: ev.reliabilityTier,
    });
    target.set(ev.candidateCharacter, list);
  }

  const textualScoreFor = (char: string): number => {
    const docs = supportDocsByChar.get(char) ?? [];
    if (docs.length === 0) return 0;
    const lineages = countIndependentLineages(docs);
    const hasDirect = countVerifiedPrimaryOrDirect(docs) > 0;
    return Math.min(1, 0.5 + 0.2 * Math.min(2, lineages - 1) + (hasDirect ? 0.2 : 0));
  };

  // ── 5. 후보 통합 점수 + 보정 신뢰도 ──
  const candidates: PipelineCandidate[] = [...candidateChars].map((char) => {
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
    const calibrated =
      Math.round((0.85 * raw + 0.15 * cell.observabilityScore) * 1000) / 1000;
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
      calibratedConfidence: calibrated,
    };
  });
  candidates.sort(
    (a, b) =>
      b.calibratedConfidence - a.calibratedConfidence ||
      a.candidateCharacter.localeCompare(b.candidateCharacter)
  );

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
      lineages: [],
      supports: null,
    };
  }

  const second = candidates[1] ?? null;
  const margin = top.calibratedConfidence - (second?.calibratedConfidence ?? 0);
  const topSupportDocs = supportDocsByChar.get(top.candidateCharacter) ?? [];
  const topCounterDocs = counterDocsByChar.get(top.candidateCharacter) ?? [];
  const independentLineageCount = countIndependentLineages(topSupportDocs);
  const verifiedPrimaryOrDirectSourceCount =
    countVerifiedPrimaryOrDirect(topSupportDocs);
  const topEvidence = evidence.filter(
    (e) => e.candidateCharacter === top.candidateCharacter
  );
  const citationVerified =
    topEvidence.filter((e) => e.kind === "SUPPORT").length > 0 &&
    topEvidence.filter((e) => e.kind === "SUPPORT").every((e) => e.citationVerified);

  // 경쟁 후보가 독립 검증 근거를 갖는가 (상충 판단)
  const charsWithVerifiedSupport = [...supportDocsByChar.entries()]
    .filter(([, docs]) => docs.length > 0)
    .map(([char]) => char);
  const hasCompeting =
    charsWithVerifiedSupport.filter((c) => c !== top.candidateCharacter).length > 0 &&
    charsWithVerifiedSupport.includes(top.candidateCharacter);

  // 강한 시각 모순: 관측 획과 후보 자형의 정면 충돌 (시각 점수 존재 & 극히 낮음)
  const strongVisualContradiction =
    observed.length >= 3 && (visualScores.get(top.candidateCharacter) ?? 0) < 0.15 &&
    top.origin === "LITERATURE" &&
    (counterDocsByChar.get(top.candidateCharacter)?.length ?? 0) > 0;

  const gateInput: DecisionGateInput = {
    calibratedConfidence: top.calibratedConfidence,
    marginToSecondCandidate: Math.round(margin * 1000) / 1000,
    verifiedPrimaryOrDirectSourceCount,
    independentLineageCount,
    strongVisualContradiction,
    strongChronologyContradiction: false,
    citationVerified,
    benchmarkLeakage: false,
    hasCompetingCandidateWithEvidence: hasCompeting,
    observabilityScore: cell.observabilityScore,
  };
  const gateResult = runDecisionGate(gateInput, {
    topCandidateVisualScore: top.visualScore,
  });

  const supportLineages = buildLineages(
    [...supportDocsByChar.values(), ...counterDocsByChar.values()].flat()
  );

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
    lineages: supportLineages,
    supports: {
      visual: top.visualScore,
      geometric: top.geometryScore,
      intraStele: top.intraSteleScore,
      crossStele: top.crossSteleScore,
      textual: top.textualScore,
      historical: Math.round(ctx * 0.8 * 1000) / 1000,
      counterStrength: Math.round(counterStrength * 1000) / 1000,
    },
  };
}
