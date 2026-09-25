/**
 * DB ↔ 엔진 파이프라인 연결.
 * 문헌 claims 는 seedKey 기준으로 실제 셀 id 에 매핑되고,
 * 결과(후보·가설·근거·교차 매칭·결정)는 runId 단위로 저장된다.
 *
 * v2 입력: 연구실 이체자 쌍, 등록 자형 표본, 판독문 n-gram 문맥 모델, 연대 증거, 활성 보정 프로파일.
 * 시드(가상 데모) 셀은 demoMode — 보정 프로파일이 없으면 데모 휴리스틱을 쓰되 '보정 아님'으로 표시.
 * 사용자 등록 셀은 보정 프로파일 없이는 자동 확정되지 않는다.
 * 실행마다 입력 구성요소별 해시를 AnalysisRunRecord로 남겨 재실행 비교가 가능하다.
 */
import { createHash } from "node:crypto";
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
  CharContextModel,
  ENGINE_ANALYSIS_VERSION,
  VariantRegistry,
  analyzeGlyphCell,
  canonicalJson,
  inferScriptFamily,
  toPipelineCell,
  type PipelineDocument,
  type PipelineGlyphCell,
  type PipelineInput,
  type PipelineResult,
  type PipelineTab,
  type SeedPriors,
} from "@seokmun/engine";
import type { AnalysisRunRecord } from "@seokmun/types";
import type { Db } from "./db";
import { currentActor, newId } from "./context";
import {
  analysisRuns,
  auditEvents,
  calibrationProfiles,
  chronology,
  crossMatches,
  documentClaims,
  documents,
  evidenceRepo,
  exemplars,
  glyphCells,
  hypotheses,
  readings as readingsRepo,
  researchSets,
  steleTabs,
  variantPairs,
  type StoredGlyphCell,
} from "./repo";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** "5세기 후반", "414년", "6세기 전반", "서기 503년경" → 대표 연도. 모르면 null */
export function parseTabYear(periodEstimate: string): number | null {
  const y = /(\d{3,4})\s*년/.exec(periodEstimate);
  if (y) return parseInt(y[1]!, 10);
  const c = /(\d{1,2})\s*세기/.exec(periodEstimate);
  if (!c) return null;
  let year = (parseInt(c[1]!, 10) - 1) * 100 + 50;
  if (periodEstimate.includes("전반") || periodEstimate.includes("초")) year -= 25;
  if (periodEstimate.includes("후반") || periodEstimate.includes("말")) year += 25;
  return year;
}

/** 판독 글자 — 연구실 채택 판독 우선, 없으면 관측 확정 원문 */
function cellReadingChar(
  cell: StoredGlyphCell,
  adoptedById: Map<string, { readingKind: string; reading: string | null }>
): string | null {
  if (cell.extra.hiddenBenchmark) return null;
  const adopted = cell.entity.adoptedReadingId ? adoptedById.get(cell.entity.adoptedReadingId) : undefined;
  if (adopted) return adopted.readingKind === "CHARACTER" ? adopted.reading : null;
  if (cell.entity.readingStatus === "OBSERVED" && cell.entity.publishedReading) return cell.entity.publishedReading;
  return null;
}

/**
 * 연구실 전체 판독문으로 문맥 모델 학습 — 면·행 순서의 글자열.
 * 대상 셀·숨김 벤치마크 셀은 빼고, 모르는 글자에서 열을 끊는다.
 */
export function buildContextCorpus(db: Db, excludeCellId: string): string[][] {
  const sequences: string[][] = [];
  for (const set of researchSets.list(db)) {
    for (const tab of steleTabs.listBySet(db, set.id)) {
      if (tab.archived) continue;
      const adoptedById = new Map(readingsRepo.listByTab(db, tab.id).map((r) => [r.id, r]));
      const lines = new Map<string, StoredGlyphCell[]>();
      for (const c of glyphCells.listByTab(db, tab.id)) {
        const k = `${c.entity.faceId}|${c.entity.lineIndex}`;
        const list = lines.get(k) ?? [];
        list.push(c);
        lines.set(k, list);
      }
      for (const cells of lines.values()) {
        cells.sort((a, b) => a.entity.sequenceIndex - b.entity.sequenceIndex);
        let seq: string[] = [];
        for (const c of cells) {
          const ch = c.entity.id === excludeCellId ? null : cellReadingChar(c, adoptedById);
          if (ch) seq.push(ch);
          else {
            if (seq.length) sequences.push(seq);
            seq = [];
          }
        }
        if (seq.length) sequences.push(seq);
      }
    }
  }
  return sequences;
}

export interface BuildInputOptions {
  /** false면 활성 보정 프로파일을 쓰지 않는다 (보정 적합용 원점수 수집) */
  useCalibration?: boolean;
  /** 평가용 — 데모 모드 강제 여부 (기본: 시드 셀이면 true) */
  demoMode?: boolean;
}

export interface BuiltInput {
  input: PipelineInput;
  /** 재현성 — 입력 구성요소별 해시 */
  componentHashes: Record<string, string>;
  inputHash: string;
}


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

export function buildPipelineInputV2(
  db: Db,
  stored: StoredGlyphCell,
  priors: SeedPriors,
  opts: BuildInputOptions = {}
): BuiltInput {
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
      storedCells.map((c) => ({
        ...toPipelineCell(c.entity, c.extra.styleJitter),
        ...(c.extra.hiddenBenchmark ? { hiddenBenchmark: true } : {}),
      }))
    );
    for (const c of storedCells) {
      if (c.extra.seedKey) seedKeyToCellId.set(c.extra.seedKey, c.entity.id);
    }
  }
  // 사람이 검수한(CONFIRMED) claim만 분석 근거로 쓴다 — 자동 제안(SUGGESTED)은 제외
  const claimsByDoc = new Map<string, PipelineDocument["claims"]>();
  for (const c of documentClaims.listConfirmed(db)) {
    const list = claimsByDoc.get(c.documentId) ?? [];
    list.push({
      targetGlyphCellId: seedKeyToCellId.get(c.targetGlyphCellId) ?? c.targetGlyphCellId,
      character: c.character,
      stance: c.stance,
      quote: c.quote,
    });
    claimsByDoc.set(c.documentId, list);
  }
  const docs: PipelineDocument[] = documents.list(db).map((d) => ({
    id: d.entity.id,
    title: d.entity.title,
    content: d.entity.content,
    reliabilityTier: d.entity.reliabilityTier,
    independenceGroup: d.entity.independenceGroup,
    derivedFromDocumentId: d.entity.derivedFromDocumentId,
    ...(d.extra.benchmarkLeak ? { benchmarkLeak: true } : {}),
    claims: (claimsByDoc.get(d.entity.id) ?? []).filter((c) => c.targetGlyphCellId !== ""),
  }));
  const pipelineCell = cellsByTab.get(tab.id)!.find((c) => c.id === stored.entity.id) ?? toPipelineCell(stored.entity, stored.extra.styleJitter);
  const pipelineTab = allTabs.find((t) => t.id === tab.id)!;

  // 이체자 — 연구실이 등록한 쌍만 (데모 유사자 목록은 검색 확장에만 쓴다)
  const pairs = variantPairs.list(db).filter((p) => p.kind !== "DEMO_SIMILAR");
  const variantRegistry = pairs.length > 0 ? new VariantRegistry(pairs) : undefined;

  // 등록 자형 표본 — 대상 셀 자신에서 만든 표본은 제외(자기 참조 누출 방지)
  const exemplarList = exemplars.list(db).filter((e) => e.sourceGlyphCellId !== stored.entity.id);
  const exemplarMap: NonNullable<PipelineInput["exemplars"]> = {};
  for (const e of exemplarList) (exemplarMap[e.character] ??= []).push({ id: e.id, polylines: e.polylines });

  const contextCorpus = buildContextCorpus(db, stored.entity.id);
  const contextModel = new CharContextModel(contextCorpus);

  const attestations = chronology.list(db);
  const tabYear = parseTabYear(tab.periodEstimate);
  const chrono =
    attestations.length > 0
      ? {
          tabYear,
          earliestYearByChar: Object.fromEntries(attestations.map((a) => [a.character, a.earliestYear])),
        }
      : undefined;

  const calibration = opts.useCalibration === false ? null : calibrationProfiles.getActive(db);
  const demoMode = opts.demoMode ?? Boolean(stored.extra.seedKey);

  const input: PipelineInput = {
    cell: pipelineCell,
    tab: pipelineTab,
    allTabs,
    cellsByTab,
    priors,
    documents: docs,
    modelVersion: MODEL_VERSION,
    corpusVersion: CORPUS_VERSION,
    ...(exemplarList.length ? { exemplars: exemplarMap } : {}),
    ...(variantRegistry ? { variantRegistry } : {}),
    ...(contextModel.usable ? { contextModel } : {}),
    ...(chrono ? { chronology: chrono } : {}),
    calibration,
    demoMode,
  };

  const h = (v: unknown) => sha256(canonicalJson(v));
  const componentHashes: Record<string, string> = {
    engine: h(ENGINE_ANALYSIS_VERSION),
    // 대상 셀의 판독 상태는 분석이 스스로 기록하는 값이라 입력 해시에서 뺀다 (파이프라인도 쓰지 않는다)
    cell: h({ cell: { ...pipelineCell, readingStatus: undefined } }),
    // 저장 순서는 갱신 때마다 바뀌므로 id 순으로 정렬해 해시한다
    sameTabCells: h(
      [...cellsByTab.get(tab.id)!]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((c) => (c.id === pipelineCell.id ? { ...c, readingStatus: undefined } : c))
    ),
    otherTabCells: h(
      [...cellsByTab]
        .filter(([k]) => k !== tab.id)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, cells]) => [k, [...cells].sort((a, b) => a.id.localeCompare(b.id))])
    ),
    tabs: h(allTabs),
    documents: h([...docs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => ({ ...d, claims: undefined }))),
    claims: h([...docs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => [d.id, d.claims])),
    priors: h(priors),
    exemplars: h(exemplarList.map((e) => [e.id, e.character, e.polylines]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    variants: h([...pairs].sort((a, b) => `${a.a}${a.b}${a.kind}`.localeCompare(`${b.a}${b.b}${b.kind}`))),
    context: h(contextModel.usable ? contextCorpus : "unused"),
    chronology: h(chrono ?? null),
    calibration: h(calibration ?? null),
    mode: h({ demoMode }),
  };
  const inputHash = h(componentHashes);
  return { input, componentHashes, inputHash };
}

/** 하위 호환 — 입력만 */
export function buildPipelineInput(db: Db, stored: StoredGlyphCell, priors: SeedPriors, opts: BuildInputOptions = {}): PipelineInput {
  return buildPipelineInputV2(db, stored, priors, opts).input;
}

export function summarizeResult(result: PipelineResult) {
  return {
    outcome: result.gateResult?.outcome ?? "UNKNOWN",
    topCandidate: result.topCandidate?.candidateCharacter ?? null,
    calibratedConfidence: result.topCandidate?.calibratedConfidence ?? null,
    rawScore: result.topCandidate?.rawScore ?? null,
    failedRules: result.gateResult?.failedRules ?? [],
    candidates: result.candidates.map((c) => ({ character: c.candidateCharacter, confidence: c.calibratedConfidence })),
  };
}

export function runAndPersistAnalysis(
  db: Db,
  stored: StoredGlyphCell,
  priors: SeedPriors
): AnalyzeGlyphResponse {
  const built = buildPipelineInputV2(db, stored, priors);
  const result = analyzeGlyphCell(built.input);
  const now = new Date().toISOString();
  const runId = newId("run");
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
      decisionRule: "decision-gate-v2 (PRD §14.4 + 3상태 규칙)",
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
        citationMatchType: ev.citationMatchType,
        targetSpecificity: ev.targetSpecificity,
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
  // 연구실이 검토·채택한 판독이 있는 셀은 자동 분석이 상태를 덮어쓰지 않는다 (결과는 run으로만 보존)
  const humanAdopted = Boolean(stored.entity.adoptedReadingId);
  const updatedCell: StoredGlyphCell = {
    entity: {
      ...stored.entity,
      readingStatus: humanAdopted ? stored.entity.readingStatus : outcomeToReadingStatus(outcome),
      acceptedCandidateId: humanAdopted
        ? stored.entity.acceptedCandidateId
        : outcome === "AUTO_ACCEPTED"
          ? topHypId
          : null,
      version: stored.entity.version + 1,
    },
    extra: { ...stored.extra, latestRunId: runId },
  };
  glyphCells.put(db, updatedCell);

  const summary = summarizeResult(result);
  const runRecord: AnalysisRunRecord = {
    id: runId,
    glyphCellId: cellId,
    inputHash: built.inputHash,
    inputSnapshot: { componentHashes: built.componentHashes, cellVersion: stored.entity.version },
    parameters: result.parameters,
    outcome: summary.outcome,
    topCandidate: summary.topCandidate,
    modelVersion: MODEL_VERSION,
    corpusVersion: CORPUS_VERSION,
    createdBy: currentActor().name,
    createdAt: now,
  };
  analysisRuns.put(db, { ...runRecord, inputSnapshot: { ...runRecord.inputSnapshot, summary } });

  auditEvents.record(db, "ANALYZE_GLYPH", "GlyphCell", cellId, {
    runId,
    inputHash: built.inputHash,
    calibrationKind: result.gateResult?.calibration?.kind ?? null,
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
