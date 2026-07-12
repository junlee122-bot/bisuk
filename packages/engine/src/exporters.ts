/**
 * 내보내기 — JSON / CSV / EpiDoc XML / 연구 보고서(Markdown).
 * 모든 형식에 출처·권리·모델 버전 manifest를 포함한다.
 * 권리 미확인 업로드 원본은 PUBLIC 내보내기에서 차단한다.
 */
import type {
  GlyphCell,
  ResearchSet,
  RestorationHypothesis,
  SourceRecord,
  SteleAsset,
  SteleTab,
} from "@seokmun/types";

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
    disclaimer:
      "VIRTUAL_DEMO 자산과 허구 문헌은 데모용 창작물이며 실제 유물 데이터·실제 판독 결과가 아니다.",
  };
}

export function exportJson(input: ExportInput): string {
  return JSON.stringify(
    {
      manifest: buildManifest(input),
      tabs: input.tabs,
      glyphCells: input.glyphCells,
      hypotheses: input.hypotheses,
    },
    null,
    2
  );
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCsv(input: ExportInput): string {
  const header = [
    "tab_id",
    "tab_title",
    "glyph_cell_id",
    "line",
    "seq",
    "reading_status",
    "published_reading",
    "accepted_character",
    "calibrated_confidence",
    "decision",
    "model_version",
  ];
  const hypByCell = new Map<string, RestorationHypothesis>();
  for (const h of input.hypotheses) {
    const prev = hypByCell.get(h.glyphCellId);
    if (!prev || h.calibratedConfidence > prev.calibratedConfidence) {
      hypByCell.set(h.glyphCellId, h);
    }
  }
  const tabById = new Map(input.tabs.map((t) => [t.id, t]));
  const rows = input.glyphCells.map((g) => {
    const h = hypByCell.get(g.id);
    const t = tabById.get(g.steleTabId);
    return [
      g.steleTabId,
      t?.title ?? "",
      g.id,
      g.lineIndex,
      g.sequenceIndex,
      g.readingStatus,
      g.publishedReading ?? "",
      h?.status === "AUTO_ACCEPTED" ? h.candidateCharacter : "",
      h?.calibratedConfidence ?? "",
      h?.status ?? "",
      input.modelVersion,
    ]
      .map(csvEscape)
      .join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * EpiDoc(TEI) XML — 판독 상태를 EpiDoc 관례로 매핑한다.
 *  OBSERVED → 원문자, PARTIALLY_OBSERVED → <unclear>,
 *  AUTO_ACCEPTED(MULTI_SOURCE_AUTOMATIC) → <supplied>, 그 외 → <gap/>
 */
export function exportEpiDoc(input: ExportInput): string {
  const hypByCell = new Map<string, RestorationHypothesis>();
  for (const h of input.hypotheses) {
    const prev = hypByCell.get(h.glyphCellId);
    if (!prev || h.calibratedConfidence > prev.calibratedConfidence) {
      hypByCell.set(h.glyphCellId, h);
    }
  }
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<TEI xmlns="http://www.tei-c.org/ns/1.0">`);
  parts.push(`  <teiHeader>`);
  parts.push(`    <fileDesc>`);
  parts.push(
    `      <titleStmt><title>${xmlEscape(input.researchSet.name)} — Seokmun Export</title></titleStmt>`
  );
  parts.push(`      <publicationStmt><p>Seokmun Comparative Autonomous Studio</p>`);
  parts.push(
    `        <availability><licence>권리 상태는 manifest 참조. 미확인 자산 제외.</licence></availability>`
  );
  parts.push(`      </publicationStmt>`);
  parts.push(`      <sourceDesc>`);
  for (const s of input.sourceRecords) {
    parts.push(
      `        <bibl xml:id="${xmlEscape(s.id)}"><publisher>${xmlEscape(s.publisher)}</publisher><ref target="${xmlEscape(s.url)}"/><note>rights: ${xmlEscape(s.rightsState)}</note></bibl>`
    );
  }
  parts.push(`      </sourceDesc>`);
  parts.push(`    </fileDesc>`);
  parts.push(`    <encodingDesc><appInfo>`);
  parts.push(
    `      <application version="${xmlEscape(input.modelVersion)}" ident="seokmun-pipeline"><label>corpus: ${xmlEscape(input.corpusVersion)}</label></application>`
  );
  parts.push(`    </appInfo></encodingDesc>`);
  parts.push(`  </teiHeader>`);
  parts.push(`  <text><body>`);
  const virtualTabs = new Set(input.virtualTabIds ?? input.tabs.map((t) => t.id));
  for (const tab of input.tabs) {
    const cells = input.glyphCells
      .filter((g) => g.steleTabId === tab.id)
      .sort((a, b) => a.lineIndex - b.lineIndex || a.sequenceIndex - b.sequenceIndex);
    if (cells.length === 0) continue;
    const subtype = virtualTabs.has(tab.id) ? "virtual-demo" : "user-data";
    parts.push(
      `    <div type="edition" subtype="${subtype}" n="${xmlEscape(tab.id)}"><head>${xmlEscape(tab.title)}</head>`
    );
    const lines = new Map<number, GlyphCell[]>();
    for (const c of cells) {
      const list = lines.get(c.lineIndex) ?? [];
      list.push(c);
      lines.set(c.lineIndex, list);
    }
    for (const [lineIndex, lineCells] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
      const segs = lineCells.map((c) => {
        const h = hypByCell.get(c.id);
        if (c.readingStatus === "OBSERVED" && c.publishedReading) {
          return xmlEscape(c.publishedReading);
        }
        if (h?.status === "AUTO_ACCEPTED") {
          return `<supplied reason="lost" evidence="parallel" cert="high">${xmlEscape(h.candidateCharacter)}</supplied>`;
        }
        if (c.readingStatus === "PARTIALLY_OBSERVED" && c.publishedReading) {
          return `<unclear>${xmlEscape(c.publishedReading)}</unclear>`;
        }
        return `<gap reason="illegible" quantity="1" unit="character"/>`;
      });
      parts.push(`      <ab n="line-${lineIndex}">${segs.join("")}</ab>`);
    }
    parts.push(`    </div>`);
  }
  parts.push(`  </body></text>`);
  parts.push(`</TEI>`);
  return parts.join("\n");
}

export function exportReport(input: ExportInput): string {
  const manifest = buildManifest(input);
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
  lines.push(`## 탭 요약`);
  for (const tab of input.tabs) {
    const cells = input.glyphCells.filter((g) => g.steleTabId === tab.id);
    const unresolved = cells.filter((g) =>
      ["UNKNOWN", "CONFLICTING", "PARTIALLY_OBSERVED", "ILLEGIBLE"].includes(g.readingStatus)
    ).length;
    lines.push(
      `- **${tab.title}** — 역할: ${tab.roles.join(", ")} · 자산 모드: ${tab.assetMode} · 권리: ${tab.rightsState} · 문자 셀 ${cells.length}개 (미해결 ${unresolved})`
    );
  }
  lines.push("");
  lines.push(`## 판독 결정`);
  for (const h of input.hypotheses) {
    const cell = input.glyphCells.find((g) => g.id === h.glyphCellId);
    if (!cell) continue;
    const failed = h.gateResult?.failedRules ?? [];
    lines.push(
      `- \`${h.glyphCellId}\` → **${h.status}** (후보 ${h.candidateCharacter}, 신뢰도 ${h.calibratedConfidence})` +
        (failed.length > 0 ? ` — 게이트 실패 사유: ${failed.join(", ")}` : "")
    );
  }
  lines.push("");
  lines.push(`## 출처·권리 manifest`);
  lines.push("```json");
  lines.push(JSON.stringify(manifest, null, 2));
  lines.push("```");
  return lines.join("\n");
}
