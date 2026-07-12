import { z } from "zod";
import {
  CorpusDocument,
  CrossSteleMatch,
  DecisionGateResult,
  GlyphCandidate,
  GlyphCell,
  HypothesisEvidence,
  RestorationHypothesis,
  SourceRecord,
  SteleAsset,
  SteleTab,
  TabUiState,
} from "./entities";
import { AssetMode, RightsState, TabRole } from "./enums";

export const CreateResearchSetBody = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  researchQuestion: z.string().default(""),
  fromTemplate: z.boolean().default(false),
});
export type CreateResearchSetBody = z.infer<typeof CreateResearchSetBody>;

export const CreateTabBody = z.object({
  title: z.string().min(1),
  canonicalName: z.string().default(""),
  roles: z.array(TabRole).min(1),
  assetMode: AssetMode,
  rightsState: RightsState.default("UNKNOWN"),
  periodEstimate: z.string().default(""),
  location: z.string().default(""),
});
export type CreateTabBody = z.infer<typeof CreateTabBody>;

/** 부분 갱신 — 제공된 필드만 반영해 동시 저장 경합(순서↔활성탭↔고정)을 없앤다 */
export const TabOrderBody = z.object({
  activeTabOrder: z.array(z.string()).optional(),
  activeTabId: z.string().nullable().optional(),
  pinnedTabIds: z.array(z.string()).optional(),
});
export type TabOrderBody = z.infer<typeof TabOrderBody>;

export const UiStateBody = TabUiState.partial();
export type UiStateBody = z.infer<typeof UiStateBody>;

export const LiteratureSearchQuery = z.object({
  q: z.string().min(1),
  tabId: z.string().optional(),
  docType: z.string().optional(),
  stance: z.enum(["SUPPORT", "COUNTER", "ALL"]).default("ALL"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type LiteratureSearchQuery = z.infer<typeof LiteratureSearchQuery>;

export const LiteratureSearchHit = z.object({
  document: CorpusDocument,
  score: z.number(),
  snippet: z.string(),
  matchOffsets: z.array(z.number().int()),
});
export type LiteratureSearchHit = z.infer<typeof LiteratureSearchHit>;

export const AnalyzeGlyphResponse = z.object({
  glyphCell: GlyphCell,
  candidates: z.array(GlyphCandidate),
  crossSteleMatches: z.array(CrossSteleMatch),
  hypotheses: z.array(RestorationHypothesis),
  evidence: z.array(HypothesisEvidence),
  decision: DecisionGateResult.nullable(),
  independentLineageCount: z.number().int(),
  runId: z.string(),
});
export type AnalyzeGlyphResponse = z.infer<typeof AnalyzeGlyphResponse>;

export const DossierResponse = z.object({
  glyphCell: GlyphCell,
  tab: SteleTab,
  conclusion: RestorationHypothesis.nullable(),
  alternates: z.array(RestorationHypothesis),
  evidence: z.array(HypothesisEvidence),
  crossSteleMatches: z.array(CrossSteleMatch),
  sourceGenealogy: z.array(
    z.object({
      independenceGroup: z.string(),
      documentIds: z.array(z.string()),
      rootDocumentId: z.string().nullable(),
      titles: z.array(z.string()),
    })
  ),
  decision: DecisionGateResult.nullable(),
  modelVersion: z.string(),
  corpusVersion: z.string(),
  rightsState: RightsState,
  generatedAt: z.string(),
});
export type DossierResponse = z.infer<typeof DossierResponse>;

export const CompareGlyphsBody = z.object({
  glyphCellIds: z.array(z.string()).min(1).max(8),
  tabIds: z.array(z.string()).min(2).max(6),
});
export type CompareGlyphsBody = z.infer<typeof CompareGlyphsBody>;

export const GlyphMatrixColumn = z.object({
  tab: SteleTab,
  cells: z.array(
    z.object({
      glyphCell: GlyphCell.nullable(),
      match: CrossSteleMatch.nullable(),
      publishedReading: z.string().nullable(),
      dataProvenance: z.string(),
    })
  ),
});
export type GlyphMatrixColumn = z.infer<typeof GlyphMatrixColumn>;

export const GlyphMatrixResponse = z.object({
  id: z.string(),
  rows: z.array(
    z.object({
      sourceGlyphCell: GlyphCell,
      sourceTab: SteleTab,
      columns: z.array(GlyphMatrixColumn),
    })
  ),
  createdAt: z.string(),
});
export type GlyphMatrixResponse = z.infer<typeof GlyphMatrixResponse>;

export const InitUploadBody = z.object({
  filename: z.string().min(1),
  byteSize: z.number().int().min(1),
  sourceRecordId: z.string().nullable().default(null),
  usagePurpose: z.string().min(1),
});
export type InitUploadBody = z.infer<typeof InitUploadBody>;

export const SetLicenseBody = z.object({
  licenseType: z.enum([
    "KOGL_TYPE_1",
    "KOGL_TYPE_2",
    "KOGL_TYPE_3",
    "KOGL_TYPE_4",
    "CUSTOM",
    "UNKNOWN",
  ]),
  rightsState: RightsState,
  verifiedBy: z.string().min(1),
  notes: z.string().default(""),
});
export type SetLicenseBody = z.infer<typeof SetLicenseBody>;

export const ExportFormat = z.enum(["json", "csv", "epidoc", "report"]);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const TabDetailResponse = z.object({
  tab: SteleTab,
  sourceRecords: z.array(SourceRecord),
  assets: z.array(SteleAsset),
  glyphCells: z.array(GlyphCell),
});
export type TabDetailResponse = z.infer<typeof TabDetailResponse>;

export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
