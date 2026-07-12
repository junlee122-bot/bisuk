import { describe, expect, it } from "vitest";
import type {
  GlyphCell,
  ResearchSet,
  RestorationHypothesis,
  SteleAsset,
  SteleTab,
} from "@seokmun/types";
import {
  checkExportRights,
  exportCsv,
  exportEpiDoc,
  exportJson,
  exportReport,
} from "../src/exporters";
import { parseAsc, parsePly, parseStl } from "../src/parsers";

describe("3D 파일 검사기", () => {
  it("ASCII PLY: 정점·면 수, 법선 유무, 경계상자", () => {
    const ply = [
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "element face 1",
      "property list uchar int vertex_indices",
      "end_header",
      "0 0 0",
      "1000 0 0",
      "0 2000 0",
      "3 0 1 2",
      "",
    ].join("\n");
    const report = parsePly(Buffer.from(ply, "latin1"));
    expect(report.vertexCount).toBe(3);
    expect(report.triangleCount).toBe(1);
    expect(report.hasNormals).toBe(false);
    expect(report.warnings.join(" ")).toContain("법선");
    expect(report.boundingBox?.max[1]).toBe(2000);
    expect(report.unitGuess).toContain("mm");
  });

  it("바이너리 STL: 삼각형 수와 크기 정합 검사", () => {
    const triCount = 2;
    const buf = Buffer.alloc(84 + 50 * triCount);
    buf.write("virtual demo stl", 0, "latin1");
    buf.writeUInt32LE(triCount, 80);
    // 삼각형 1: (0,0,0)-(0.5,0,0)-(0,1.8,0)
    const verts = [
      [0, 0, 0], [0.5, 0, 0], [0, 1.8, 0],
      [0, 0, 0], [0.5, 0, 0], [0, 0, 0.4],
    ];
    for (let t = 0; t < triCount; t++) {
      const base = 84 + t * 50;
      for (let v = 0; v < 3; v++) {
        const p = verts[t * 3 + v]!;
        buf.writeFloatLE(p[0]!, base + 12 + v * 12);
        buf.writeFloatLE(p[1]!, base + 12 + v * 12 + 4);
        buf.writeFloatLE(p[2]!, base + 12 + v * 12 + 8);
      }
    }
    const report = parseStl(buf);
    expect(report.format).toBe("STL(binary)");
    expect(report.triangleCount).toBe(2);
    expect(report.warnings).toHaveLength(0);
    expect(report.unitGuess).toContain("m 추정");
  });

  it("ASC 점군: 점 수·컬럼 기반 법선 감지", () => {
    const asc = ["0 0 0", "0.1 0.2 0.3", "0.4 0.5 0.6 0 0 1", "잘못된 줄"].join("\n");
    const report = parseAsc(Buffer.from(asc, "latin1"));
    expect(report.pointCount).toBe(3);
    expect(report.format).toBe("ASC");
  });
});

function makeExportInput() {
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
    uiState: {
      camera: null, activeFaceId: null, activeGlyphCellId: null, renderMode: "ALBEDO",
      zoomLevel: 1, selectedCandidateId: null, literatureQuery: "", lodLevel: "MEDIUM",
      lastSavedAt: null,
    },
    createdAt: "2026-07-11T00:00:00Z", updatedAt: "2026-07-11T00:00:00Z",
  } as SteleTab;
  const glyphCells: GlyphCell[] = [
    {
      id: "g1", steleTabId: "tab1", faceId: "f", lineIndex: 1, sequenceIndex: 1,
      bbox2d: [0, 0, 0.1, 0.1], observabilityScore: 0.9, damageGrade: 0,
      readingStatus: "OBSERVED", acceptedCandidateId: null, publishedReading: "王",
      featureVector: [], strokes: null, version: 1,
    },
    {
      id: "g2", steleTabId: "tab1", faceId: "f", lineIndex: 1, sequenceIndex: 2,
      bbox2d: [0, 0.2, 0.1, 0.1], observabilityScore: 0.7, damageGrade: 2,
      readingStatus: "MULTI_SOURCE_AUTOMATIC", acceptedCandidateId: null,
      publishedReading: null, featureVector: [], strokes: null, version: 1,
    },
    {
      id: "g3", steleTabId: "tab1", faceId: "f", lineIndex: 1, sequenceIndex: 3,
      bbox2d: [0, 0.4, 0.1, 0.1], observabilityScore: 0.2, damageGrade: 4,
      readingStatus: "UNKNOWN", acceptedCandidateId: null, publishedReading: null,
      featureVector: [], strokes: null, version: 1,
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

describe("내보내기 + 권리 게이트", () => {
  it("PUBLIC 내보내기는 권리 미확인 업로드를 차단한다", () => {
    const input = makeExportInput();
    const gate = checkExportRights(input.assets, "PUBLIC");
    expect(gate.allowed).toBe(false);
    expect(gate.blockedAssets[0]?.rightsState).toBe("VERIFY_REQUIRED");
  });

  it("권리 확인 후 PUBLIC 내보내기 허용", () => {
    const input = makeExportInput();
    input.assets[0]!.rightsState = "ATTRIBUTION_REQUIRED";
    input.assets[0]!.licenseType = "KOGL_TYPE_1";
    const gate = checkExportRights(input.assets, "PUBLIC");
    expect(gate.allowed).toBe(true);
  });

  it("INTERNAL 내보내기는 분석 목적상 허용된다", () => {
    const input = makeExportInput();
    expect(checkExportRights(input.assets, "INTERNAL").allowed).toBe(true);
  });

  it("허용 목록 방식: VIEW_ONLY·RESEARCH_ONLY·KOGL_TYPE_4 확정도 PUBLIC 재배포 차단", () => {
    const input = makeExportInput();
    for (const state of [
      "VIEW_ONLY",
      "RESEARCH_ONLY",
      "METADATA_ONLY",
      "DERIVATIVES_PROHIBITED",
      "KOGL_TYPE_4_OR_ITEM_SPECIFIC",
    ] as const) {
      input.assets[0]!.rightsState = state;
      expect(checkExportRights(input.assets, "PUBLIC").allowed, state).toBe(false);
    }
  });

  it("JSON에는 manifest(모델·코퍼스·권리)가 포함된다", () => {
    const out = JSON.parse(exportJson(makeExportInput()));
    expect(out.manifest.modelVersion).toBe("model-v");
    expect(out.manifest.corpusVersion).toBe("corpus-v");
    expect(out.manifest.assets[0].includedInExport).toBe(false);
    expect(out.manifest.disclaimer).toContain("VIRTUAL_DEMO");
  });

  it("CSV에 결정 상태가 기록된다", () => {
    const csv = exportCsv(makeExportInput());
    const rows = csv.split("\n");
    expect(rows[0]).toContain("accepted_character");
    expect(csv).toContain("AUTO_ACCEPTED");
    expect(csv).toContain("安");
  });

  it("EpiDoc: OBSERVED→원문자, AUTO→supplied, UNKNOWN→gap", () => {
    const xml = exportEpiDoc(makeExportInput());
    expect(xml).toContain("<TEI");
    expect(xml).toContain("王");
    expect(xml).toContain('<supplied reason="lost"');
    expect(xml).toContain('<gap reason="illegible"');
    expect(xml).toContain('ident="seokmun-pipeline"');
  });

  it("보고서에 게이트 실패 사유와 가상 데이터 고지가 포함된다", () => {
    const report = exportReport(makeExportInput());
    expect(report).toContain("데모용 창작물");
    expect(report).toContain("AUTO_ACCEPTED");
  });
});
