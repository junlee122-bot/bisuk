import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-api-test-"));
  process.env.SEOKMUN_DATA_DIR = tmpDir;
  const { buildServer } = await import("../src/server");
  app = buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const SET_ID = "early-korean-stelae-comparative";

describe("연구 세트 / 탭", () => {
  it("시드된 기본 연구 세트와 6개 탭을 반환한다", async () => {
    const res = await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.set.name).toBe("고구려·초기 신라 비문 비교");
    expect(body.tabs).toHaveLength(6);
    const titles = body.tabs.map((t: { tab: { title: string } }) => t.tab.title);
    expect(titles).toContain("충주 고구려비");
    expect(titles).toContain("창녕 관룡산 통일신라 사찰 토지 공증비");
    // 충주 탭이 PRIMARY
    const chungju = body.tabs.find(
      (t: { tab: { id: string } }) => t.tab.id === "chungju-goguryeobi"
    );
    expect(chungju.tab.roles).toContain("PRIMARY");
    expect(chungju.tab.roles).toContain("BENCHMARK");
    expect(chungju.badges.rightsWarning).toBe(true);
  });

  it("탭 순서 변경과 활성 탭이 저장·복원된다", async () => {
    const get1 = (await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}` })).json();
    const order: string[] = get1.set.activeTabOrder;
    const newOrder = [order[1]!, order[0]!, ...order.slice(2)];
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}/tab-order`,
      payload: { activeTabOrder: newOrder, activeTabId: newOrder[0], pinnedTabIds: [newOrder[0]] },
    });
    expect(patch.statusCode).toBe(200);
    const get2 = (await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}` })).json();
    expect(get2.set.activeTabOrder).toEqual(newOrder);
    expect(get2.set.activeTabId).toBe(newOrder[0]);
    expect(get2.set.pinnedTabIds).toContain(newOrder[0]);
    expect(get2.tabs[0].tab.id).toBe(newOrder[0]);
  });

  it("탭 UI 상태(카메라·활성 문자)를 저장한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/chungju-goguryeobi/ui-state`,
      payload: {
        activeGlyphCellId: "demoA-L2-C3",
        renderMode: "RAKING_LIGHT",
        camera: { position: [0, 0, 3], target: [0, 0, 0] },
      },
    });
    expect(res.statusCode).toBe(200);
    const detail = (
      await app.inject({ method: "GET", url: `/api/stele-tabs/chungju-goguryeobi` })
    ).json();
    expect(detail.tab.uiState.activeGlyphCellId).toBe("demoA-L2-C3");
    expect(detail.tab.uiState.renderMode).toBe("RAKING_LIGHT");
    expect(detail.tab.uiState.lastSavedAt).not.toBeNull();
  });

  it("숨김 벤치마크 셀은 마모 획 좌표를 노출하지 않는다 (정답 복원 차단)", async () => {
    const detail = (
      await app.inject({ method: "GET", url: `/api/stele-tabs/chungju-goguryeobi` })
    ).json();
    const hidden = detail.glyphCells.find((g: { id: string }) => g.id === "demoA-L2-C3");
    // 安 전체 자형은 7획 — 마모 2획이 제거된 관측 5획만 노출돼야 한다
    expect(hidden.strokes.polylines.length).toBe(5);
    expect(hidden.strokes.erodedStrokeIndexes).toEqual([]);
    const observedCell = detail.glyphCells.find(
      (g: { id: string }) => g.id === "demoA-L1-C1"
    );
    expect(observedCell.strokes.polylines.length).toBeGreaterThan(0);
  });

  it("관측 확정(OBSERVED) 셀은 자동 분석이 거부된다", async () => {
    const res = await app.inject({ method: "POST", url: `/api/glyphs/demoA-L1-C1/analyze` });
    expect(res.statusCode).toBe(409);
  });

  it("충주 탭은 공식 Source Card + 가상 데모 자산 + 글리프 셀을 갖는다", async () => {
    const detail = (
      await app.inject({ method: "GET", url: `/api/stele-tabs/chungju-goguryeobi` })
    ).json();
    expect(detail.sourceRecords.length).toBeGreaterThanOrEqual(3);
    const officialIndex = detail.sourceRecords.find(
      (s: { type: string }) => s.type === "OFFICIAL_3D_INDEX"
    );
    expect(officialIndex.publisher).toContain("국가유산청");
    expect(officialIndex.rightsState).toBe("VERIFY_PER_ASSET");
    const demoAsset = detail.assets.find(
      (a: { provenance: string }) => a.provenance === "VIRTUAL_DEMO"
    );
    expect(demoAsset.demoLabel).toContain("DEMO-A");
    expect(detail.glyphCells.length).toBe(18);
    // 벤치마크 숨김 셀은 publishedReading이 노출되지 않는다
    const hidden = detail.glyphCells.find((g: { id: string }) => g.id === "demoA-L2-C3");
    expect(hidden.publishedReading).toBeNull();
  });

  it("성숙도 점수와 Frontier Index를 계산한다", async () => {
    const res = (
      await app.inject({ method: "GET", url: `/api/stele-tabs/jian-goguryeo-stele/maturity` })
    ).json();
    expect(res.total).toBeGreaterThan(0);
    expect(res.frontierIndex).toBeGreaterThan(0.5);
  });
});

describe("자율 분석 → Decision Gate → Dossier", () => {
  it("demoA-L2-C3 분석: AUTO_ACCEPTED + 감사 로그 + 누출 문서 제외", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/glyphs/demoA-L2-C3/analyze`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision.outcome).toBe("AUTO_ACCEPTED");
    expect(body.glyphCell.readingStatus).toBe("MULTI_SOURCE_AUTOMATIC");
    expect(body.independentLineageCount).toBe(2);
    expect(body.evidence.some((e: { kind: string }) => e.kind === "COUNTER")).toBe(true);
    expect(
      body.evidence.every((e: { documentId: string }) => e.documentId !== "doc-leak-kappa")
    ).toBe(true);
    const audit = (await app.inject({ method: "GET", url: "/api/audit" })).json();
    const evt = audit.find(
      (a: { action: string; entityId: string }) =>
        a.action === "ANALYZE_GLYPH" && a.entityId === "demoA-L2-C3"
    );
    expect(evt.payload.excludedLeakDocumentIds).toContain("doc-leak-kappa");
  });

  it("demoA-L3-C5 분석: UNKNOWN (게이트 실패 사유 포함)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/glyphs/demoA-L3-C5/analyze` });
    const body = res.json();
    expect(body.decision.outcome).toBe("UNKNOWN");
    expect(body.decision.failedRules.length).toBeGreaterThan(0);
    expect(body.glyphCell.readingStatus).toBe("UNKNOWN");
  });

  it("demoA-L1-C4 분석: CONFLICTING", async () => {
    const res = await app.inject({ method: "POST", url: `/api/glyphs/demoA-L1-C4/analyze` });
    expect(res.json().decision.outcome).toBe("CONFLICTING");
  });

  it("Dossier: 결론·대안·근거·계보·결정 규칙·버전 포함", async () => {
    const res = await app.inject({ method: "GET", url: `/api/glyphs/demoA-L2-C3/dossier` });
    const body = res.json();
    expect(body.conclusion.candidateCharacter).toBe("安");
    expect(body.conclusion.status).toBe("AUTO_ACCEPTED");
    expect(body.alternates.length).toBeGreaterThan(0);
    expect(body.evidence.length).toBeGreaterThanOrEqual(3);
    expect(body.sourceGenealogy.length).toBeGreaterThanOrEqual(2);
    const g1 = body.sourceGenealogy.find(
      (g: { independenceGroup: string }) => g.independenceGroup === "G1-rubbing-alpha"
    );
    expect(g1.documentIds.length).toBeGreaterThanOrEqual(3);
    expect(body.modelVersion).toBeTruthy();
    expect(body.decision.ruleTrace).toHaveLength(8);
  });
});

describe("Glyph Matrix 비교 / 조각 접합", () => {
  it("2~4개 비석 Glyph Matrix: 열마다 유사 글자·가상 표시", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/comparisons/glyphs",
      payload: {
        glyphCellIds: ["demoA-L2-C3"],
        tabIds: ["chungju-goguryeobi", "uljin-bongpyeong-stele", "gwanggaeto-stele"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0];
    expect(row.columns).toHaveLength(3);
    const uljin = row.columns.find(
      (c: { tab: { id: string } }) => c.tab.id === "uljin-bongpyeong-stele"
    );
    expect(uljin.cells[0].glyphCell.id).toBe("demoB-L1-C1");
    expect(uljin.cells[0].match.combinedScore).toBeGreaterThan(0.5);
    expect(uljin.cells[0].dataProvenance).toBe("VIRTUAL_DEMO");
    // 비교 세션 저장 확인
    const stored = await app.inject({ method: "GET", url: `/api/comparisons/${body.id}` });
    expect(stored.statusCode).toBe(200);
  });

  it("가상 조각 접합: offset 0에서 높은 신뢰도", async () => {
    const good = (
      await app.inject({
        method: "POST",
        url: "/api/comparisons/fragments",
        payload: { tabId: "wolseong-stele-fragments", offset: 0 },
      })
    ).json();
    expect(good.joinConfidence).toBeGreaterThan(0.9);
    expect(good.note).toContain("가상");
    const bad = (
      await app.inject({
        method: "POST",
        url: "/api/comparisons/fragments",
        payload: { tabId: "wolseong-stele-fragments", offset: 0.4 },
      })
    ).json();
    expect(bad.joinConfidence).toBeLessThan(good.joinConfidence);
  });
});

describe("문헌 검색 (지지·반증·계보)", () => {
  it("BM25 검색이 관련 허구 문헌을 찾는다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/literature/search?q=${encodeURIComponent("安 판독")}`,
    });
    const hits = res.json();
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0].document.isFictional).toBe(true);
    expect(hits[0].document.title).toContain("[가상 문헌]");
  });

  it("반증 검색: stance=COUNTER 필터", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/literature/search?q=${encodeURIComponent("戶")}&stance=COUNTER`,
    });
    const hits = res.json();
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(
      hits.some((h: { document: { id: string } }) => h.document.id === "doc-paper-zeta")
    ).toBe(true);
  });
});

describe("자산 업로드 importer + 권리 게이트", () => {
  let assetId: string;

  it("PLY 업로드: 체크섬·품질 보고서·VERIFY_REQUIRED", async () => {
    const ply = [
      "ply", "format ascii 1.0", "element vertex 3",
      "property float x", "property float y", "property float z",
      "element face 1", "property list uchar int vertex_indices",
      "end_header", "0 0 0", "500 0 0", "0 2000 0", "3 0 1 2", "",
    ].join("\n");
    const res = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/chungju-goguryeobi/assets/upload?filename=user-download.ply&usagePurpose=${encodeURIComponent("판독 연구")}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(ply),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    assetId = body.id;
    expect(body.provenance).toBe("REAL_USER_UPLOAD");
    expect(body.rightsState).toBe("VERIFY_REQUIRED");
    expect(body.checksumSha256).toHaveLength(64);
    expect(body.qualityReport.vertexCount).toBe(3);
    expect(body.qualityReport.unitGuess).toContain("mm");
  });

  it("지원하지 않는 확장자는 거부한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/chungju-goguryeobi/assets/upload?filename=evil.exe&usagePurpose=x`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("MZ"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("권리 미확인 상태에서 PUBLIC 내보내기 차단 → 확인 후 허용 (E2E4)", async () => {
    const blocked = await app.inject({
      method: "GET",
      url: `/api/research-sets/${SET_ID}/export?format=json&audience=PUBLIC`,
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().details.some((b: { id: string }) => b.id === assetId)).toBe(true);
    // 내부 연구용은 허용
    const internal = await app.inject({
      method: "GET",
      url: `/api/research-sets/${SET_ID}/export?format=json&audience=INTERNAL`,
    });
    expect(internal.statusCode).toBe(200);
    // 관리자 권리 확인
    const license = await app.inject({
      method: "POST",
      url: `/api/assets/${assetId}/license`,
      payload: {
        licenseType: "KOGL_TYPE_1",
        rightsState: "ATTRIBUTION_REQUIRED",
        verifiedBy: "demo-admin",
        notes: "공식 사이트 이용 조건 확인 완료 (데모)",
      },
    });
    expect(license.statusCode).toBe(200);
    const allowed = await app.inject({
      method: "GET",
      url: `/api/research-sets/${SET_ID}/export?format=json&audience=PUBLIC`,
    });
    expect(allowed.statusCode).toBe(200);
    const manifest = JSON.parse(allowed.body).manifest;
    expect(manifest.modelVersion).toBeTruthy();
    expect(
      manifest.assets.find((a: { id: string }) => a.id === assetId).includedInExport
    ).toBe(true);
  });
});

describe("내보내기 형식", () => {
  it("CSV / EpiDoc / 보고서가 생성된다", async () => {
    const csv = await app.inject({
      method: "GET",
      url: `/api/research-sets/${SET_ID}/export?format=csv`,
    });
    expect(csv.body.split("\n")[0]).toContain("glyph_cell_id");
    const epidoc = await app.inject({
      method: "GET",
      url: `/api/research-sets/${SET_ID}/export?format=epidoc`,
    });
    expect(epidoc.body).toContain("<TEI");
    expect(epidoc.body).toContain('subtype="virtual-demo"');
    expect(epidoc.body).toContain("<supplied");
    const report = await app.inject({
      method: "GET",
      url: `/api/research-sets/${SET_ID}/export?format=report`,
    });
    expect(report.body).toContain("연구 실행 보고서");
    expect(report.body).toContain("데모용 창작물");
  });
});

describe("문헌 업로드·색인", () => {
  it("업로드한 문헌이 즉시 검색 색인에 반영된다", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      payload: {
        title: "사용자 등록 연구 노트 — 봉평비 자형 관찰",
        content:
          "봉평비의 특정 자형에 대한 개인 관찰 노트다. 갈문왕 어휘의 배열이 특징적이다.",
        docType: "USER_NOTE",
      },
    });
    expect(res.statusCode).toBe(201);
    const hits = (
      await app.inject({
        method: "GET",
        url: `/api/literature/search?q=${encodeURIComponent("갈문왕")}`,
      })
    ).json();
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].document.title).toContain("봉평비 자형 관찰");
    expect(hits[0].document.reliabilityTier).toBe(7);
    // 감사 로그 기록
    const audit = (await app.inject({ method: "GET", url: "/api/audit" })).json();
    expect(
      audit.some((a: { action: string }) => a.action === "UPLOAD_DOCUMENT")
    ).toBe(true);
  });
});

describe("Frontier Watch", () => {
  it("창녕 항목: 1차 판독 상태 + 사진 재배포 금지", async () => {
    const item = (
      await app.inject({ method: "GET", url: "/api/frontier/watch-changnyeong" })
    ).json();
    expect(item.status).toBe("PRELIMINARY_READING");
    expect(item.rightsState).toBe("NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED");
    expect(item.frontierIndex).toBeGreaterThan(0.5);
  });

  it("DEMO-D 항목 승격: METADATA_ONLY 탭 생성, 재승격은 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/frontier/watch-demo-d/promote-to-tab",
      payload: { researchSetId: SET_ID },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tab.assetMode).toBe("METADATA_ONLY");
    expect(body.tab.warnings.join(" ")).toContain("확정 판독 아님");
    const again = await app.inject({
      method: "POST",
      url: "/api/frontier/watch-demo-d/promote-to-tab",
      payload: { researchSetId: SET_ID },
    });
    expect(again.statusCode).toBe(409);
  });
});

describe("벤치마크 평가 (누출 격리)", () => {
  it("평가 실행: 자동 채택 정확도 보고, 오채택 0", async () => {
    const res = await app.inject({ method: "POST", url: "/api/evaluation/run" });
    const body = res.json();
    expect(body.metrics.total).toBeGreaterThanOrEqual(5);
    expect(body.metrics.wrongAutoAccepts).toBe(0);
    expect(body.metrics.correctAutoAccepts).toBeGreaterThanOrEqual(1);
  });
});

describe("dev reset", () => {
  it("리셋 후 시드가 복원된다", async () => {
    const res = await app.inject({ method: "POST", url: "/api/dev/reset" });
    expect(res.statusCode).toBe(200);
    const sets = (await app.inject({ method: "GET", url: "/api/research-sets" })).json();
    expect(sets).toHaveLength(1);
    expect(sets[0].stats.tabCount).toBe(6);
  });
});
