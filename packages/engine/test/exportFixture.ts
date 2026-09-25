import { TabUiState } from "@seokmun/types";
import type {
  GlyphCell,
  ResearchSet,
  RestorationHypothesis,
  SteleAsset,
  SteleTab,
} from "@seokmun/types";

export function makeExportInput() {
  const researchSet = {
    id: "rs1", name: "테스트 세트", description: "", researchQuestion: "",
    periodRange: "", regions: [], scripts: [], languages: [],
    visibility: "PRIVATE", activeTabOrder: [], activeTabId: null, pinnedTabIds: [],
    rightsPolicy: "권리 확인 전 재배포 금지",
    createdAt: "2026-07-11T00:00:00Z", updatedAt: "2026-07-11T00:00:00Z",
  } as ResearchSet;
  const tab = {
    id: "tab1", researchSetId: "rs1", title: "가상비 A", canonicalName: "가상비 A",
    alternativeNames: [], roles: ["PRIMARY"], assetMode: "MESH_3D",
    initialStatus: "SOURCE_METADATA_READY", maturityScores: null, frontierSignals: null,
    periodEstimate: "", location: "", material: "", scriptType: "", writingDirection: "",
    rightsState: "VERIFY_PER_ASSET", sourceQuality: 0.5, questions: [], knownFacts: [],
    restrictions: [], preliminaryClaims: [], warnings: [], archived: false,
    uiState: TabUiState.parse({}),
    createdAt: "2026-07-11T00:00:00Z", updatedAt: "2026-07-11T00:00:00Z",
  } as SteleTab;
  const glyphCells: GlyphCell[] = [
    {
      id: "g1", steleTabId: "tab1", faceId: "f", lineIndex: 1, sequenceIndex: 1,
      bbox2d: [0, 0, 0.1, 0.1], observabilityScore: 0.9, damageGrade: 0,
      readingStatus: "OBSERVED", acceptedCandidateId: null, publishedReading: "王",
      featureVector: [], strokes: null, version: 1,
      strokeProvenance: null, adoptedReadingId: null, bboxAssetId: null, note: "",
    },
    {
      id: "g2", steleTabId: "tab1", faceId: "f", lineIndex: 1, sequenceIndex: 2,
      bbox2d: [0, 0.2, 0.1, 0.1], observabilityScore: 0.7, damageGrade: 2,
      readingStatus: "MULTI_SOURCE_AUTOMATIC", acceptedCandidateId: null,
      publishedReading: null, featureVector: [], strokes: null, version: 1,
      strokeProvenance: null, adoptedReadingId: null, bboxAssetId: null, note: "",
    },
    {
      id: "g3", steleTabId: "tab1", faceId: "f", lineIndex: 1, sequenceIndex: 3,
      bbox2d: [0, 0.4, 0.1, 0.1], observabilityScore: 0.2, damageGrade: 4,
      readingStatus: "UNKNOWN", acceptedCandidateId: null, publishedReading: null,
      featureVector: [], strokes: null, version: 1,
      strokeProvenance: null, adoptedReadingId: null, bboxAssetId: null, note: "",
    },
  ];
  const hypotheses: RestorationHypothesis[] = [
    {
      id: "h1", glyphCellId: "g2", candidateCharacter: "安", variantForm: null,
      status: "AUTO_ACCEPTED", visualSupport: 0.9, geometricSupport: 0.8,
      intraSteleSupport: 0, crossSteleSupport: 0.8, textualSupport: 0.9,
      historicalSupport: 0.5, counterEvidenceStrength: 0.2,
      calibratedConfidence: 0.87, marginToSecond: 0.4, decisionRule: "gate-v1",
      gateInput: null, gateResult: null, modelVersion: "m", corpusVersion: "c",
      createdAt: "2026-07-11T00:00:00Z",
    },
  ];
  const uploadedAsset = {
    id: "a1", steleTabId: "tab1", assetType: "MESH", provenance: "REAL_USER_UPLOAD",
    demoLabel: null, originalFilename: "real.ply", mimeType: "application/octet-stream",
    format: "PLY", byteSize: 100, checksumSha256: "abc", sourceRecordId: null,
    licenseType: null, licenseVerifiedAt: null, licenseVerifiedBy: null, usagePurpose: "연구",
    coordinateSystem: null, unit: null, qualityLevel: null, isOriginal: true,
    parentAssetId: null, processingStatus: "READY", rightsState: "VERIFY_REQUIRED",
    qualityReport: null, storageKey: "k", createdAt: "2026-07-11T00:00:00Z",
  } as SteleAsset;
  return {
    researchSet, tabs: [tab], sourceRecords: [], assets: [uploadedAsset],
    glyphCells, hypotheses, modelVersion: "model-v", corpusVersion: "corpus-v",
    generatedAt: "2026-07-11T00:00:00Z", audience: "INTERNAL" as const,
  };
}

