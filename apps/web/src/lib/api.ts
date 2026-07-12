import type {
  AnalyzeGlyphResponse,
  AuditEvent,
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers:
      init?.body && !(init.body instanceof Blob) && !(init.body instanceof File)
        ? { "content-type": "application/json" }
        : undefined,
    ...init,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = json as { message?: string; details?: unknown } | null;
    throw new ApiRequestError(res.status, err?.message ?? res.statusText, err?.details);
  }
  return json as T;
}

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
    sourceRecordId?: string | null
  ): Promise<SteleAsset> => {
    const params = new URLSearchParams({
      filename: file.name,
      usagePurpose,
    });
    if (sourceRecordId) params.set("sourceRecordId", sourceRecordId);
    const res = await fetch(`/api/stele-tabs/${tabId}/assets/upload?${params}`, {
      method: "POST",
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
  exportUrl: (setId: string, format: string, audience: string) =>
    `/api/research-sets/${setId}/export?format=${format}&audience=${audience}`,
};
