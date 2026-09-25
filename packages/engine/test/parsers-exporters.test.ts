import { describe, expect, it } from "vitest";
import { TabUiState } from "@seokmun/types";
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
import { makeExportInput } from "./exportFixture";

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
    expect(xml).toContain('n="seokmun-pipeline"');
  });

  it("보고서에 게이트 실패 사유와 가상 데이터 고지가 포함된다", () => {
    const report = exportReport(makeExportInput());
    expect(report).toContain("데모용 창작물");
    expect(report).toContain("AUTO_ACCEPTED");
  });
});
