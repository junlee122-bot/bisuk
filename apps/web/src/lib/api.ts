import type {
  AnalysisRunRecord,
  AnalyzeGlyphResponse,
  AuditEvent,
  BibliographyEntry,
  CalibrationProfile,
  CharacterExemplar,
  ChronologyAttestation,
  Comment,
  CommentTargetType,
  DocumentClaim,
  EntityVersion,
  PublicUser,
  Reading,
  UserRole,
  VariantPair,
  DossierResponse,
  FrontierWatchItem,
  GlyphCell,
  GlyphMatrixResponse,
  ResearchSet,
  SourceRecord,
  SteleAsset,
  SteleTab,
  TabUiState,
} from "@seokmun/types";

export interface TabBadges {
  unresolvedCount: number;
  rightsWarning: boolean;
  isFrontier: boolean;
  hasVirtualDemo: boolean;
  has3d: boolean;
}

export interface SetOverview {
  set: ResearchSet;
  tabs: Array<{ tab: SteleTab; badges: TabBadges }>;
  stats: {
    tabCount: number;
    primaryTabTitle: string | null;
    unresolvedGlyphs: number;
    conflictingGlyphs: number;
    rightsWarnings: number;
    frontierItems: number;
  };
}

export interface TabDetail {
  tab: SteleTab;
  badges: TabBadges;
  sourceRecords: SourceRecord[];
  assets: SteleAsset[];
  glyphCells: GlyphCell[];
}

export interface LiteratureHit {
  document: {
    id: string;
    title: string;
    docType: string;
    publisher: string;
    publishedAt: string;
    isFictional: boolean;
    reliabilityTier: number;
    independenceGroup: string;
    derivedFromDocumentId: string | null;
    content: string;
  };
  score: number;
  snippet: string;
  claims: Array<{
    targetGlyphCellId: string;
    character: string;
    stance: "SUPPORT" | "COUNTER";
    quote: string;
  }>;
  benchmarkLeak: boolean;
}

export class ApiRequestError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** 401 응답 시 로그인 화면으로 보내기 위한 전역 신호 (AuthGate가 구독) */
export const UNAUTHORIZED_EVENT = "seokmun:unauthorized";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers:
      init?.body && !(init.body instanceof Blob) && !(init.body instanceof File)
        ? { "content-type": "application/json" }
        : undefined,
    ...init,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    const err = json as { message?: string; details?: unknown; error?: string; current?: unknown } | null;
    throw new ApiRequestError(res.status, err?.message ?? res.statusText, err?.details ?? err);
  }
  return json as T;
}

const post = <T>(url: string, body?: unknown) =>
  request<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = <T>(url: string, body: unknown) =>
  request<T>(url, { method: "PATCH", body: JSON.stringify(body) });
const put = <T>(url: string, body: unknown) =>
  request<T>(url, { method: "PUT", body: JSON.stringify(body) });
const del = <T>(url: string, body?: unknown) =>
  request<T>(url, { method: "DELETE", ...(body ? { body: JSON.stringify(body) } : {}) });
const enc = encodeURIComponent;

export interface AuthStatus {
  mode: "local" | "proxy-header" | "dev";
  needsSetup: boolean;
  user: PublicUser | null;
  devUsers: Array<{ email: string; displayName: string; role: UserRole }>;
}

export type ReadingWithCount = Reading & { commentCount: number };

export interface ReadingComparison {
  columns: Array<{ key: string; label: string; sourceType: string }>;
  rows: Array<{
    cellId: string;
    faceId: string;
    faceLabel: string;
    lineIndex: number;
    sequenceIndex: number;
    values: Record<string, string>;
    consensus: string | null;
    disagreement: boolean;
    adoptedReadingId: string | null;
    adopted: string | null;
  }>;
}

export interface TranscriptionPlanItem {
  faceId: string;
  faceLabel: string;
  lineIndex: number;
  sequenceIndex: number;
  reading: string | null;
  kind: string;
  supplied: boolean;
  unclear: boolean;
  existingCellId: string | null;
}

export interface EvaluationSummary {
  n: number;
  bySource: Record<string, number>;
  top1Accuracy: { point: number; lower: number; upper: number };
  autoAccepted: number;
  falseAutoAcceptRate: { point: number; lower: number; upper: number };
  coverage: { point: number; lower: number; upper: number };
  ece: number;
  sufficientForCalibration: boolean;
  warnings: string[];
}

export interface GlobalSearchResult {
  query: string;
  tabs: Array<{ id: string; setId: string; title: string; match: string }>;
  cells: Array<{ id: string; tabId: string; setId: string; label: string; reading: string; status: string }>;
  readings: Array<{ id: string; cellId: string; tabId: string; setId: string; token: string; author: string; status: string }>;
  documents: Array<{ id: string; title: string; snippet: string; score: number; isFictional: boolean }>;
  bibliography: Array<{ id: string; title: string; formatted: string }>;
}

export interface RerunComparison {
  run: AnalysisRunRecord;
  current: { inputHash: string; componentHashes: Record<string, string>; summary: { outcome: string; topCandidate: string | null } };
  sameInput: boolean;
  changedComponents: string[];
  sameOutcome: boolean;
  reproduced: boolean;
}

export interface DocumentListItem {
  id: string;
  title: string;
  docType: string;
  publisher: string;
  publishedAt: string;
  isFictional: boolean;
  reliabilityTier: number;
  independenceGroup: string;
  derivedFromDocumentId: string | null;
  bibliographyId: string | null;
  relatedTabIds: string[];
  claimCount: number;
  benchmarkLeak: boolean;
}

/** 공개 쇼케이스 — 서버 측 권리 필터 */
export const showcaseApi = {
  get: (setId: string) =>
    request<{
      set: { id: string; name: string; description: string; visibility: string };
      viewerRole: string | null;
      tabs: Array<{
        tab: Pick<SteleTab, "id" | "title" | "canonicalName" | "roles" | "periodEstimate" | "location" | "material" | "knownFacts" | "rightsState">;
        assets: SteleAsset[];
        sourceRecords: Array<Pick<SourceRecord, "id" | "type" | "publisher" | "url" | "rightsState">>;
        glyphCells: GlyphCell[];
      }>;
      primaryTabId: string | null;
      focusCellId: string | null;
      unknownCellId: string | null;
      matrix: GlyphMatrixResponse["rows"];
      statusCounts: Record<string, number>;
      metrics: { tabCount: number; cellCount: number; sourceCount: number; unresolved: number; unresolvedRatio: number };
      gatedAssets: Array<{ tabTitle: string; filename: string; rightsState: string }>;
      note: string;
    }>(`/api/showcase/${encodeURIComponent(setId)}`),
};

/** 인증·계정 */
export const authApi = {
  status: () => request<AuthStatus>("/api/auth/status"),
  login: (email: string, password: string) => post<{ user: PublicUser }>("/api/auth/login", { email, password }),
  setup: (body: { email: string; password: string; displayName: string }) =>
    post<{ user: PublicUser }>("/api/auth/setup", body),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: boolean }>("/api/auth/password", { currentPassword, newPassword }),
  listUsers: () =>
    request<Array<PublicUser & { active: boolean; authProvider: string; lastLoginAt: string | null }>>("/api/users"),
  createUser: (body: { email: string; displayName: string; role: UserRole; password?: string }) =>
    post<{ user: PublicUser; temporaryPassword: string | null }>("/api/users", body),
  updateUser: (id: string, body: { role?: UserRole; active?: boolean; displayName?: string }) =>
    patch<PublicUser>(`/api/users/${id}`, body),
  resetPassword: (id: string) => post<{ temporaryPassword: string }>(`/api/users/${id}/reset-password`),
  listMembers: (setId: string) =>
    request<Array<{ researchSetId: string; userId: string; role: UserRole; displayName: string; email: string }>>(
      `/api/research-sets/${setId}/members`
    ),
  setMember: (setId: string, userId: string, role: UserRole) =>
    put<{ ok: boolean }>(`/api/research-sets/${setId}/members/${userId}`, { role }),
  removeMember: (setId: string, userId: string) => del<{ ok: boolean }>(`/api/research-sets/${setId}/members/${userId}`),
  setVisibility: (setId: string, visibility: "PRIVATE" | "SHARED" | "PUBLIC") =>
    patch<{ ok: boolean }>(`/api/research-sets/${setId}/visibility`, { visibility }),
};

/** 편집·판독·토론·이력 */
export const labApi = {
  patchTab: (id: string, body: Record<string, unknown>) => patch<SteleTab>(`/api/stele-tabs/${id}`, body),
  archivedTabs: (setId: string) => request<SteleTab[]>(`/api/research-sets/${setId}/archived-tabs`),
  unarchiveTab: (id: string) => post<{ ok: boolean }>(`/api/stele-tabs/${id}/unarchive`),
  addSource: (tabId: string, body: Record<string, unknown>) => post<SourceRecord>(`/api/stele-tabs/${tabId}/source-records`, body),
  patchSource: (id: string, body: Record<string, unknown>) => patch<SourceRecord>(`/api/source-records/${id}`, body),
  deleteSource: (id: string) => del<{ ok: boolean }>(`/api/source-records/${id}`),
  createCell: (tabId: string, body: Record<string, unknown>) => post<GlyphCell>(`/api/stele-tabs/${tabId}/glyphs`, body),
  patchCell: (id: string, body: Record<string, unknown>) => patch<GlyphCell>(`/api/glyphs/${id}`, body),
  deleteCell: (id: string) => del<{ ok: boolean }>(`/api/glyphs/${id}`),
  putStrokes: (
    id: string,
    body: { polylines: Array<Array<[number, number]>>; erodedStrokeIndexes: number[]; sourceAssetId: string | null; note?: string; expectedVersion?: number }
  ) => put<GlyphCell>(`/api/glyphs/${id}/strokes`, body),
  cellHistory: (id: string) => request<EntityVersion[]>(`/api/glyphs/${id}/history`),
  revertCell: (id: string, versionId: string, reason: string) =>
    post<GlyphCell>(`/api/glyphs/${id}/revert`, { versionId, reason }),
  importTranscription: (tabId: string, body: Record<string, unknown>) =>
    post<{
      parsed?: { stats: Record<string, number>; warnings: string[]; faces: Array<{ faceId: string; label: string; lines: number }> };
      plan?: TranscriptionPlanItem[];
      collisions?: number;
      createdCells?: number;
      createdReadings?: number;
      warnings?: string[];
    }>(`/api/stele-tabs/${tabId}/transcription-import`, body),
  setScale: (assetId: string, body: { unit: "mm" | "cm" | "m" | "px"; metersPerUnit?: number; note?: string }) =>
    patch<SteleAsset>(`/api/assets/${assetId}/scale`, body),
  scaleBar: (assetId: string, body: { p1: number[]; p2: number[]; realLengthMm: number; note?: string }) =>
    post<SteleAsset>(`/api/assets/${assetId}/scale-bar`, body),
  setAlignment: (assetId: string, rotationDeg: [number, number, number]) =>
    patch<SteleAsset>(`/api/assets/${assetId}/alignment`, { rotationDeg }),
  assetFileUrl: (assetId: string) => `/api/assets/${assetId}/file`,

  readings: (cellId: string) =>
    request<{ cell: GlyphCell; adoptedReadingId: string | null; readings: ReadingWithCount[] }>(`/api/glyphs/${cellId}/readings`),
  proposeReading: (cellId: string, body: Record<string, unknown>) => post<Reading>(`/api/glyphs/${cellId}/readings`, body),
  readingFromAnalysis: (cellId: string) => post<Reading>(`/api/glyphs/${cellId}/readings/from-analysis`),
  patchReading: (id: string, body: Record<string, unknown>) => patch<Reading>(`/api/readings/${id}`, body),
  submitReading: (id: string) => post<Reading>(`/api/readings/${id}/submit`),
  reviewReading: (id: string, body: { decision: "ACCEPT" | "REJECT"; note?: string; expectedVersion?: number }) =>
    post<{ reading: Reading; cell: GlyphCell }>(`/api/readings/${id}/review`, body),
  deleteReading: (id: string) => del<{ ok: boolean }>(`/api/readings/${id}`),
  readingHistory: (id: string) => request<EntityVersion[]>(`/api/readings/${id}/history`),
  reviewQueue: () =>
    request<
      Array<{
        reading: Reading;
        tab: { id: string; title: string; researchSetId: string };
        cell: { id: string; faceId: string; lineIndex: number; sequenceIndex: number } | null;
      }>
    >("/api/review-queue"),
  readingComparison: (tabId: string) => request<ReadingComparison>(`/api/stele-tabs/${tabId}/reading-comparison`),
  readingComparisonCsvUrl: (tabId: string) => `/api/stele-tabs/${tabId}/reading-comparison?format=csv`,
  comments: (targetType: CommentTargetType, targetId: string) =>
    request<Comment[]>(`/api/comments?targetType=${targetType}&targetId=${enc(targetId)}`),
  addComment: (body: { targetType: CommentTargetType; targetId: string; parentId?: string | null; body: string }) =>
    post<Comment>("/api/comments", body),
  patchComment: (id: string, body: { body?: string; resolved?: boolean }) => patch<Comment>(`/api/comments/${id}`, body),
  deleteComment: (id: string) => del<{ ok: boolean }>(`/api/comments/${id}`),
  auditQuery: (q: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
    return request<AuditEvent[]>(`/api/audit?${params}`);
  },
  auditVerify: () =>
    request<{ ok: boolean; checked: number; firstBrokenSeq: number | null; reason: string | null }>("/api/audit/verify"),
  backup: (label: string) => post<{ name: string; createdAt: string; files: number }>("/api/admin/backup", { label }),
  backups: () => request<Array<{ name: string; createdAt: string; files: number; label: string }>>("/api/admin/backups"),
  bundleUrl: (setId: string) => `/api/research-sets/${setId}/bundle`,
};

/** 서지·문헌·주장·표본·이체자·연대·평가·재현성·검색 */
export const researchApi = {
  bibliography: (q = "") => request<Array<BibliographyEntry & { formatted: string }>>(`/api/bibliography${q ? `?q=${enc(q)}` : ""}`),
  createBibliography: (body: Record<string, unknown>) => post<BibliographyEntry>("/api/bibliography", body),
  patchBibliography: (id: string, body: Record<string, unknown>) => patch<BibliographyEntry>(`/api/bibliography/${id}`, body),
  deleteBibliography: (id: string) => del<{ ok: boolean }>(`/api/bibliography/${id}`),
  importBibliography: (text: string, dryRun: boolean) =>
    post<{ format: string; created: BibliographyEntry[]; duplicates: Array<{ title: string; existingId: string }>; warnings: string[] }>(
      "/api/bibliography/import",
      { text, dryRun }
    ),
  bibliographyExportUrl: (format: "bibtex" | "ris" | "csl-json") => `/api/bibliography-export?format=${format}`,
  documents: () => request<DocumentListItem[]>("/api/documents"),
  document: (id: string) => request<{ id: string; title: string; content: string; claims: DocumentClaim[] } & Record<string, unknown>>(`/api/documents/${id}`),
  patchDocument: (id: string, body: Record<string, unknown>) => patch<unknown>(`/api/documents/${id}`, body),
  deleteDocument: (id: string) => del<{ ok: boolean }>(`/api/documents/${id}`),
  claims: (docId: string) =>
    request<Array<DocumentClaim & { check: { verified: boolean; matchType: string; targetSpecificity: string; reason: string } }>>(
      `/api/documents/${docId}/claims`
    ),
  addClaim: (docId: string, body: Record<string, unknown>) => post<DocumentClaim>(`/api/documents/${docId}/claims`, body),
  suggestClaims: (docId: string, tabId: string) =>
    post<{ suggestions: Array<DocumentClaim & { reason: string; confidence: number }>; skippedExisting: number; note: string }>(
      `/api/documents/${docId}/claims/suggest`,
      { tabId }
    ),
  confirmClaim: (id: string) => post<DocumentClaim>(`/api/claims/${id}/confirm`),
  rejectClaim: (id: string) => post<DocumentClaim>(`/api/claims/${id}/reject`),
  deleteClaim: (id: string) => del<{ ok: boolean }>(`/api/claims/${id}`),
  cellClaims: (cellId: string) => request<DocumentClaim[]>(`/api/glyphs/${cellId}/claims`),
  exemplars: (character?: string) => request<CharacterExemplar[]>(`/api/exemplars${character ? `?character=${enc(character)}` : ""}`),
  exemplarFromCell: (cellId: string, character: string) => post<CharacterExemplar>(`/api/glyphs/${cellId}/exemplar`, { character }),
  deleteExemplar: (id: string) => del<{ ok: boolean }>(`/api/exemplars/${id}`),
  variantPairs: (character?: string) =>
    request<{ count: number; pairs: VariantPair[]; variants?: string[] }>(`/api/variant-pairs${character ? `?character=${enc(character)}` : ""}`),
  addVariantPairs: (pairs: Array<{ a: string; b: string; kind?: string }>) => post<{ inserted: number }>("/api/variant-pairs", { pairs }),
  importUnihan: (text: string) => post<{ parsed: number; inserted: number; skipped: number }>("/api/variant-pairs/import-unihan", { text }),
  chronology: () => request<ChronologyAttestation[]>("/api/chronology"),
  setChronology: (character: string, earliestYear: number, source: string) =>
    put<ChronologyAttestation>(`/api/chronology/${enc(character)}`, { earliestYear, source }),
  deleteChronology: (character: string) => del<{ ok: boolean }>(`/api/chronology/${enc(character)}`),
  evaluate: (setId?: string) =>
    post<{
      summary: EvaluationSummary;
      cases: Array<{ caseId: string; truthSource: string; truth: string; outcome: string; topCandidate: string | null; confidence: number; failedRules: string[] }>;
      calibrationProfile: CalibrationProfile | null;
      minCasesForCalibration: number;
      note: string;
    }>("/api/evaluation/v2", setId ? { setId } : {}),
  calibrationProfiles: () => request<Array<CalibrationProfile & { active: boolean }>>("/api/calibration/profiles"),
  fitCalibration: (method: "ISOTONIC" | "PLATT", activate: boolean) =>
    post<{ profile: CalibrationProfile; active: boolean }>("/api/calibration/fit", { method, activate }),
  activateCalibration: (id: string) => post<{ ok: boolean }>(`/api/calibration/${id}/activate`),
  deactivateCalibration: () => post<{ ok: boolean }>("/api/calibration/deactivate"),
  runs: (cellId: string) => request<AnalysisRunRecord[]>(`/api/glyphs/${cellId}/runs`),
  rerun: (runId: string) => post<RerunComparison>(`/api/analysis-runs/${runId}/rerun`),
  search: (q: string, setId?: string) =>
    request<GlobalSearchResult>(`/api/search?q=${enc(q)}${setId ? `&setId=${enc(setId)}` : ""}`),
};

export const api = {
  listSets: () =>
    request<Array<{ set: ResearchSet; stats: SetOverview["stats"] }>>(
      "/api/research-sets"
    ),
  createSet: (body: { name: string; description?: string }) =>
    request<ResearchSet>("/api/research-sets", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSet: (id: string) => request<SetOverview>(`/api/research-sets/${id}`),
  saveTabOrder: (
    id: string,
    body: {
      activeTabOrder?: string[];
      activeTabId?: string | null;
      pinnedTabIds?: string[];
    }
  ) =>
    request<ResearchSet>(`/api/research-sets/${id}/tab-order`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createTab: (setId: string, body: Record<string, unknown>) =>
    request<SteleTab>(`/api/research-sets/${setId}/tabs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getTab: (id: string) => request<TabDetail>(`/api/stele-tabs/${id}`),
  archiveTab: (id: string) =>
    request<{ ok: boolean }>(`/api/stele-tabs/${id}/archive`, { method: "POST" }),
  saveUiState: (id: string, patch: Partial<TabUiState>) =>
    request<TabUiState>(`/api/stele-tabs/${id}/ui-state`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  getMaturity: (id: string) =>
    request<{
      scores: Record<string, number> | null;
      total: number | null;
      frontierIndex: number | null;
      initialStatus: string;
      note: string;
    }>(`/api/stele-tabs/${id}/maturity`),
  analyzeGlyph: (id: string) =>
    request<AnalyzeGlyphResponse>(`/api/glyphs/${id}/analyze`, { method: "POST" }),
  getDossier: (id: string) => request<DossierResponse>(`/api/glyphs/${id}/dossier`),
  compareGlyphs: (body: { glyphCellIds: string[]; tabIds: string[] }) =>
    request<GlyphMatrixResponse>("/api/comparisons/glyphs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  evaluateFragments: (body: { tabId: string; offset: number }) =>
    request<{
      meanGap: number;
      interferenceRatio: number;
      joinConfidence: number;
      note: string;
    }>("/api/comparisons/fragments", { method: "POST", body: JSON.stringify(body) }),
  searchLiterature: (q: string, stance: "SUPPORT" | "COUNTER" | "ALL" = "ALL") =>
    request<LiteratureHit[]>(
      `/api/literature/search?q=${encodeURIComponent(q)}&stance=${stance}`
    ),
  listFrontier: () => request<FrontierWatchItem[]>("/api/frontier"),
  recheckFrontier: (id: string) =>
    request<FrontierWatchItem>(`/api/frontier/${id}/recheck`, { method: "POST" }),
  promoteFrontier: (id: string, researchSetId: string) =>
    request<{ item: FrontierWatchItem; tab: SteleTab }>(
      `/api/frontier/${id}/promote-to-tab`,
      { method: "POST", body: JSON.stringify({ researchSetId }) }
    ),
  listAudit: () => request<AuditEvent[]>("/api/audit?limit=200"),
  unarchiveTab: (id: string) => post<{ ok: boolean }>(`/api/stele-tabs/${id}/unarchive`),
  uploadDocument: (body: {
    title: string;
    content: string;
    docType?: string;
    relatedTabIds?: string[];
  }) =>
    request<{ id: string }>("/api/documents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadAsset: async (
    tabId: string,
    file: File,
    usagePurpose: string,
    sourceRecordId?: string | null,
    declaredType?: string
  ): Promise<SteleAsset> => {
    const params = new URLSearchParams({
      filename: file.name,
      usagePurpose,
    });
    if (sourceRecordId) params.set("sourceRecordId", sourceRecordId);
    if (declaredType) params.set("declaredType", declaredType);
    const res = await fetch(`/api/stele-tabs/${tabId}/assets/upload?${params}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    const json = (await res.json()) as SteleAsset & { message?: string; details?: unknown };
    if (!res.ok) throw new ApiRequestError(res.status, json.message ?? "업로드 실패");
    return json;
  },
  setLicense: (
    assetId: string,
    body: { licenseType: string; rightsState: string; verifiedBy: string; notes?: string }
  ) =>
    request<SteleAsset>(`/api/assets/${assetId}/license`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  exportUrl: (setId: string, format: string, audience: string, tabId?: string) =>
    `/api/research-sets/${setId}/export?format=${format}&audience=${audience}${tabId ? `&tabId=${encodeURIComponent(tabId)}` : ""}`,
};
