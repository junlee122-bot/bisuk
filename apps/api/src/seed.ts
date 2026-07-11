/**
 * 시드 로더 — data/seed/*.json 을 DB로 적재한다.
 * 실제 국가유산 파일은 절대 포함하지 않으며 공식 출처 메타데이터만 시드한다.
 * 가상 데모 자산은 provenance=VIRTUAL_DEMO 로 명시된다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CorpusDocument,
  FrontierWatchItem,
  MaturityScores,
  FrontierSignals,
  ResearchSet,
  RightsState,
  SourceRecord,
  SteleAsset,
  SteleTab,
  TabRole,
  ResearchMaturityStatus,
  AssetMode,
  TabUiState,
} from "@seokmun/types";
import {
  buildGlyphCellEntity,
  computeFrontierIndex,
  type SeedGlyphCellJson,
  type SeedPriors,
} from "@seokmun/engine";
import type { Db } from "./db";
import {
  benchmarkCases,
  documents,
  frontierItems,
  glyphCells,
  researchSets,
  sourceRecords,
  steleAssets,
  steleTabs,
} from "./repo";

const seedDir = path.resolve(import.meta.dirname, "../../../data/seed");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(seedDir, name), "utf8")) as T;
}

interface WorkspaceSeed {
  researchSet: {
    id: string;
    name: string;
    description: string;
    researchQuestion: string;
    periodRange: string;
    regions: string[];
    scripts: string[];
    languages: string[];
    rightsPolicy: string;
    defaultPrimaryTabId: string;
  };
  tabs: Array<{
    id: string;
    title: string;
    canonicalName: string;
    alternativeNames: string[];
    roles: TabRole[];
    assetMode: AssetMode;
    initialStatus: ResearchMaturityStatus;
    periodEstimate: string;
    location: string;
    material: string;
    rightsState: RightsState;
    sourceQuality: number;
    questions?: string[];
    knownFacts?: string[];
    restrictions?: string[];
    preliminaryClaims?: string[];
    warnings?: string[];
    maturityScores?: MaturityScores;
    frontierSignals?: FrontierSignals;
    sourceRecords: Array<{
      id: string;
      type: string;
      publisher: string;
      url: string;
      expectedFormats?: string[];
      acquisition: string;
      rightsState: RightsState;
      reliabilityTier: number;
      independenceGroup: string;
      notes?: string;
    }>;
  }>;
}

interface GlyphSeed {
  priors: SeedPriors;
  assets: Array<{
    id: string;
    steleTabId: string;
    assetType: "MESH" | "TRANSCRIPTION";
    provenance: "VIRTUAL_DEMO";
    demoLabel: string;
    format: string;
    rightsState: RightsState;
    meshParams?: Record<string, unknown>;
  }>;
  glyphCells: SeedGlyphCellJson[];
  benchmarkCases: Array<{ glyphCellId: string; hiddenTruth: string; note: string }>;
}

interface CorpusSeed {
  documents: Array<{
    id: string;
    title: string;
    docType: CorpusDocument["docType"];
    publisher: string;
    publishedAt: string;
    reliabilityTier: number;
    independenceGroup: string;
    derivedFromDocumentId: string | null;
    benchmarkLeak?: boolean;
    relatedTabIds: string[];
    content: string;
    claims: Array<{
      targetGlyphCellId: string;
      character: string;
      stance: "SUPPORT" | "COUNTER";
      quote: string;
    }>;
  }>;
}

interface FrontierSeed {
  watchItems: Array<{
    id: string;
    provisionalName: string;
    discoveryDate: string | null;
    announcementDate: string | null;
    locationPrecision: string;
    reportingInstitution: string;
    assetAvailability: string[];
    rightsState: RightsState;
    status: FrontierWatchItem["status"];
    preliminaryClaims: string[];
    unknownQuestions: string[];
    relatedStelae: string[];
    nextExpectedEvent: string;
    lastCheckedAt: string | null;
    promotedTabId: string | null;
    frontierSignals: FrontierSignals;
  }>;
}

export function defaultUiState(): TabUiState {
  return {
    camera: null,
    activeFaceId: null,
    activeGlyphCellId: null,
    renderMode: "ALBEDO",
    zoomLevel: 1,
    selectedCandidateId: null,
    literatureQuery: "",
    lodLevel: "MEDIUM",
    lastSavedAt: null,
  };
}

export function isSeeded(db: Db): boolean {
  return researchSets.list(db).length > 0;
}

export function seedAll(db: Db): void {
  const now = new Date().toISOString();
  const workspace = loadJson<WorkspaceSeed>("workspace.json");
  const glyphSeed = loadJson<GlyphSeed>("demo-glyphs.json");
  const corpusSeed = loadJson<CorpusSeed>("corpus.json");
  const frontierSeed = loadJson<FrontierSeed>("frontier.json");

  const ws = workspace.researchSet;
  const tabOrder = workspace.tabs.map((t) => t.id);
  const set: ResearchSet = {
    id: ws.id,
    name: ws.name,
    description: ws.description,
    researchQuestion: ws.researchQuestion,
    periodRange: ws.periodRange,
    regions: ws.regions,
    scripts: ws.scripts,
    languages: ws.languages,
    visibility: "PRIVATE",
    activeTabOrder: tabOrder,
    activeTabId: ws.defaultPrimaryTabId,
    pinnedTabIds: [],
    rightsPolicy: ws.rightsPolicy,
    createdAt: now,
    updatedAt: now,
  };
  researchSets.put(db, set);

  for (const t of workspace.tabs) {
    const tab: SteleTab = {
      id: t.id,
      researchSetId: ws.id,
      title: t.title,
      canonicalName: t.canonicalName,
      alternativeNames: t.alternativeNames,
      roles: t.roles,
      assetMode: t.assetMode,
      initialStatus: t.initialStatus,
      maturityScores: t.maturityScores ?? null,
      frontierSignals: t.frontierSignals ?? null,
      periodEstimate: t.periodEstimate,
      location: t.location,
      material: t.material,
      scriptType: "한문 해서/예서 계열",
      writingDirection: "세로쓰기",
      rightsState: t.rightsState,
      sourceQuality: t.sourceQuality,
      questions: t.questions ?? [],
      knownFacts: t.knownFacts ?? [],
      restrictions: t.restrictions ?? [],
      preliminaryClaims: t.preliminaryClaims ?? [],
      warnings: t.warnings ?? [],
      archived: false,
      uiState: defaultUiState(),
      createdAt: now,
      updatedAt: now,
    };
    steleTabs.put(db, tab);
    for (const s of t.sourceRecords) {
      const record: SourceRecord = {
        id: s.id,
        steleTabId: t.id,
        type: s.type,
        publisher: s.publisher,
        url: s.url,
        expectedFormats: s.expectedFormats ?? [],
        acquisition: s.acquisition,
        rightsState: s.rightsState,
        reliabilityTier: s.reliabilityTier,
        independenceGroup: s.independenceGroup,
        retrievedAt: null,
        notes: s.notes ?? "",
      };
      sourceRecords.put(db, record);
    }
  }

  for (const a of glyphSeed.assets) {
    const asset: SteleAsset = {
      id: a.id,
      steleTabId: a.steleTabId,
      assetType: a.assetType === "MESH" ? "MESH" : "TRANSCRIPTION",
      provenance: "VIRTUAL_DEMO",
      demoLabel: a.demoLabel,
      originalFilename: null,
      mimeType: null,
      format: a.format,
      byteSize: null,
      checksumSha256: null,
      sourceRecordId: null,
      licenseType: "VIRTUAL_DEMO_CC0",
      licenseVerifiedAt: now,
      licenseVerifiedBy: "seed",
      usagePurpose: "가상 데모",
      coordinateSystem: null,
      unit: "m (가상)",
      qualityLevel: "MEDIUM",
      isOriginal: true,
      parentAssetId: null,
      processingStatus: "READY",
      rightsState: a.rightsState,
      qualityReport: null,
      storageKey: null,
      meshParams: a.meshParams ?? null,
      createdAt: now,
    };
    steleAssets.put(db, asset);
  }

  const maxByTab = new Map<string, { lines: number; seq: number }>();
  for (const c of glyphSeed.glyphCells) {
    const m = maxByTab.get(c.steleTabId) ?? { lines: 1, seq: 1 };
    m.lines = Math.max(m.lines, c.lineIndex);
    m.seq = Math.max(m.seq, c.sequenceIndex);
    maxByTab.set(c.steleTabId, m);
  }
  for (const c of glyphSeed.glyphCells) {
    const m = maxByTab.get(c.steleTabId)!;
    const entity = buildGlyphCellEntity(c, glyphSeed.priors, m.lines, m.seq);
    glyphCells.put(db, {
      entity,
      extra: {
        seedKey: c.id,
        ...(c.styleJitter !== undefined ? { styleJitter: c.styleJitter } : {}),
        ...(c.hidden ? { hiddenBenchmark: true } : {}),
      },
    });
  }

  for (const b of glyphSeed.benchmarkCases) {
    benchmarkCases.put(db, b);
  }

  for (const d of corpusSeed.documents) {
    const entity: CorpusDocument = {
      id: d.id,
      title: d.title,
      docType: d.docType,
      publisher: d.publisher,
      publishedAt: d.publishedAt,
      language: "ko",
      isFictional: true,
      reliabilityTier: d.reliabilityTier,
      independenceGroup: d.independenceGroup,
      derivedFromDocumentId: d.derivedFromDocumentId,
      relatedTabIds: d.relatedTabIds,
      content: d.content,
      createdAt: now,
    };
    documents.put(db, {
      entity,
      extra: { benchmarkLeak: Boolean(d.benchmarkLeak), claims: d.claims },
    });
  }

  for (const w of frontierSeed.watchItems) {
    const item: FrontierWatchItem = {
      id: w.id,
      provisionalName: w.provisionalName,
      discoveryDate: w.discoveryDate,
      announcementDate: w.announcementDate,
      locationPrecision: w.locationPrecision,
      reportingInstitution: w.reportingInstitution,
      assetAvailability: w.assetAvailability,
      rightsState: w.rightsState,
      status: w.status,
      preliminaryClaims: w.preliminaryClaims,
      unknownQuestions: w.unknownQuestions,
      relatedStelae: w.relatedStelae,
      nextExpectedEvent: w.nextExpectedEvent,
      lastCheckedAt: w.lastCheckedAt,
      promotedTabId: w.promotedTabId,
      frontierIndex: computeFrontierIndex(w.frontierSignals),
    };
    frontierItems.put(db, item);
  }
}
