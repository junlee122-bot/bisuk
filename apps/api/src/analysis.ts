/**
 * DB ↔ 엔진 파이프라인 연결.
 * 문헌 claims 는 seedKey 기준으로 실제 셀 id 에 매핑되고,
 * 결과(후보·가설·근거·교차 매칭·결정)는 runId 단위로 저장된다.
 */
import {
  MODEL_VERSION,
  CORPUS_VERSION,
  type AnalyzeGlyphResponse,
  type CrossSteleMatch,
  type GlyphCandidate,
  type HypothesisEvidence,
  type RestorationHypothesis,
  type DecisionOutcome,
  type ReadingStatus,
} from "@seokmun/types";
import {
  analyzeGlyphCell,
  inferScriptFamily,
  toPipelineCell,
  type PipelineDocument,
  type PipelineGlyphCell,
  type PipelineInput,
  type PipelineTab,
  type SeedPriors,
} from "@seokmun/engine";
import type { Db } from "./db";
import {
  auditEvents,
  crossMatches,
  documents,
  evidenceRepo,
  glyphCells,
  hypotheses,
  steleTabs,
  type StoredGlyphCell,
} from "./repo";

let runCounter = 0;

function outcomeToReadingStatus(outcome: DecisionOutcome): ReadingStatus {
  switch (outcome) {
    case "AUTO_ACCEPTED":
      return "MULTI_SOURCE_AUTOMATIC";
    case "CONFLICTING":
      return "CONFLICTING";
    case "TEXTUAL_SUPPLEMENT":
      return "TEXTUAL_SUPPLEMENT";
    case "ILLEGIBLE":
      return "ILLEGIBLE";
    default:
      return "UNKNOWN";
  }
}

export function buildPipelineInput(
  db: Db,
  stored: StoredGlyphCell,
  priors: SeedPriors
): PipelineInput {
  const tab = steleTabs.get(db, stored.entity.steleTabId);
  if (!tab) throw new Error(`tab not found: ${stored.entity.steleTabId}`);
  const setTabs = steleTabs.listBySet(db, tab.researchSetId);
  const allTabs: PipelineTab[] = setTabs.map((t) => ({
    id: t.id,
    title: t.title,
    periodEstimate: t.periodEstimate,
    scriptFamily: inferScriptFamily(t.periodEstimate),
  }));
  const cellsByTab = new Map<string, PipelineGlyphCell[]>();
  const seedKeyToCellId = new Map<string, string>();
  for (const t of setTabs) {
    const storedCells = glyphCells.listByTab(db, t.id);
    cellsByTab.set(
      t.id,
      storedCells.map((c) => toPipelineCell(c.entity, c.extra.styleJitter))
    );
    for (const c of storedCells) seedKeyToCellId.set(c.extra.seedKey, c.entity.id);
  }
  const docs: PipelineDocument[] = documents.list(db).map((d) => ({
    id: d.entity.id,
    title: d.entity.title,
    content: d.entity.content,
    reliabilityTier: d.entity.reliabilityTier,
    independenceGroup: d.entity.independenceGroup,
    derivedFromDocumentId: d.entity.derivedFromDocumentId,
    ...(d.extra.benchmarkLeak ? { benchmarkLeak: true } : {}),
    claims: d.extra.claims
      .map((c) => ({
        ...c,
        targetGlyphCellId: seedKeyToCellId.get(c.targetGlyphCellId) ?? c.targetGlyphCellId,
      }))
      .filter((c) => c.targetGlyphCellId !== ""),
  }));
  const pipelineCell = toPipelineCell(stored.entity, stored.extra.styleJitter);
  const pipelineTab = allTabs.find((t) => t.id === tab.id)!;
  return {
    cell: pipelineCell,
    tab: pipelineTab,
    allTabs,
    cellsByTab,
    priors,
    documents: docs,
    modelVersion: MODEL_VERSION,
    corpusVersion: CORPUS_VERSION,
  };
}

export function runAndPersistAnalysis(
  db: Db,
  stored: StoredGlyphCell,
  priors: SeedPriors
): AnalyzeGlyphResponse {
  const input = buildPipelineInput(db, stored, priors);
  const result = analyzeGlyphCell(input);
  const now = new Date().toISOString();
  const runId = `run-${Date.now()}-${runCounter++}`;
  const cellId = stored.entity.id;

  const candidates: GlyphCandidate[] = result.candidates.map((c, i) => ({
    id: `cand-${runId}-${i}`,
    glyphCellId: cellId,
    candidateCharacter: c.candidateCharacter,
    variantForm: null,
    origin: c.origin,
    visualScore: c.visualScore,
    geometryScore: c.geometryScore,
    contextScore: c.contextScore,
    crossSteleScore: c.crossSteleScore,
    textualScore: c.textualScore,
    calibratedConfidence: c.calibratedConfidence,
    createdAt: now,
  }));

  const persistedHypotheses: RestorationHypothesis[] = [];
  const persistedEvidence: HypothesisEvidence[] = [];
  let evCounter = 0;
  for (const c of result.candidates) {
    const isTop = c.candidateCharacter === result.topCandidate?.candidateCharacter;
    const hyp: RestorationHypothesis = {
      id: `hyp-${runId}-${c.candidateCharacter}`,
      glyphCellId: cellId,
      candidateCharacter: c.candidateCharacter,
      variantForm: null,
      status: isTop ? (result.gateResult?.outcome ?? "UNKNOWN") : "UNKNOWN",
      visualSupport: c.visualScore,
      geometricSupport: c.geometryScore,
      intraSteleSupport: c.intraSteleScore,
      crossSteleSupport: c.crossSteleScore,
      textualSupport: c.textualScore,
      historicalSupport: isTop ? (result.supports?.historical ?? 0) : 0,
      counterEvidenceStrength: isTop ? (result.supports?.counterStrength ?? 0) : 0,
      calibratedConfidence: c.calibratedConfidence,
      marginToSecond: isTop ? (result.gateInput?.marginToSecondCandidate ?? 0) : 0,
      decisionRule: "decision-gate-v1 (PRD §14.4)",
      gateInput: isTop ? result.gateInput : null,
      gateResult: isTop ? result.gateResult : null,
      modelVersion: MODEL_VERSION,
      corpusVersion: CORPUS_VERSION,
      createdAt: now,
    };
    hypotheses.put(db, hyp, runId);
    persistedHypotheses.push(hyp);
    for (const ev of result.evidence.filter(
      (e) => e.candidateCharacter === c.candidateCharacter
    )) {
      const evidence: HypothesisEvidence = {
        id: `ev-${runId}-${evCounter++}`,
        hypothesisId: hyp.id,
        kind: ev.kind,
        documentId: ev.documentId,
        sourceGlyphCellId: null,
        quote: ev.quote,
        quoteOffset: ev.quoteOffset,
        citationVerified: ev.citationVerified,
        citationContext: ev.citationContext,
        independenceGroup: ev.independenceGroup,
        reliabilityTier: ev.reliabilityTier,
        note: ev.documentTitle,
      };
      evidenceRepo.put(db, evidence);
      persistedEvidence.push(evidence);
    }
  }

  const persistedMatches: CrossSteleMatch[] = result.crossSteleMatches.map((m, i) => {
    const match: CrossSteleMatch = { ...m, id: `xm-${runId}-${i}`, createdAt: now };
    crossMatches.put(db, match, runId);
    return match;
  });

  const outcome = result.gateResult?.outcome ?? "UNKNOWN";
  const topHypId = result.topCandidate
    ? `hyp-${runId}-${result.topCandidate.candidateCharacter}`
    : null;
  const updatedCell: StoredGlyphCell = {
    entity: {
      ...stored.entity,
      readingStatus: outcomeToReadingStatus(outcome),
      acceptedCandidateId: outcome === "AUTO_ACCEPTED" ? topHypId : null,
      version: stored.entity.version + 1,
    },
    extra: { ...stored.extra, latestRunId: runId },
  };
  glyphCells.put(db, updatedCell);

  auditEvents.record(db, "ANALYZE_GLYPH", "GlyphCell", cellId, {
    runId,
    outcome,
    topCandidate: result.topCandidate?.candidateCharacter ?? null,
    calibratedConfidence: result.topCandidate?.calibratedConfidence ?? null,
    failedRules: result.gateResult?.failedRules ?? [],
    excludedLeakDocumentIds: result.excludedLeakDocumentIds,
    independentLineageCount: result.independentLineageCount,
    modelVersion: MODEL_VERSION,
    corpusVersion: CORPUS_VERSION,
  });

  return {
    glyphCell: updatedCell.entity,
    candidates,
    crossSteleMatches: persistedMatches,
    hypotheses: persistedHypotheses,
    evidence: persistedEvidence,
    decision: result.gateResult,
    independentLineageCount: result.independentLineageCount,
    runId,
  };
}
