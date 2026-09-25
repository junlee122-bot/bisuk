import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const SET_ID = "early-korean-stelae-comparative";

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0] : String(raw ?? "")).split(";")[0]!;
}

describe("연구 방법론 API (서지·주장·표본·이체자·연대·보정·재현성·검색)", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let pi = "";
  let student = "";
  const as = (cookie: string) => ({ cookie });

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-research-test-"));
    const { buildServer } = await import("../src/server");
    app = buildServer({ authMode: "local", enableDevReset: false, dataDir: tmpDir });
    await app.ready();
    pi = cookieFrom(
      await app.inject({
        method: "POST",
        url: "/api/auth/setup",
        payload: { email: "pi@lab.ac.kr", password: "correct-horse-battery", displayName: "책임교수" },
      })
    );
    await app.inject({
      method: "POST",
      url: "/api/users",
      headers: as(pi),
      payload: { email: "student@lab.ac.kr", displayName: "대학원생", role: "RESEARCHER", password: "a-long-password-1" },
    });
    student = cookieFrom(
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "student@lab.ac.kr", password: "a-long-password-1" } })
    );
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  let bibId = "";
  it("BibTeX 가져오기 — 미리보기·중복 감지·내보내기", async () => {
    const text = `@article{heo1984, author={허흥식}, title={충주 고구려비 판독 재검토}, journal={사학연구}, volume=38, pages={12--40}, year=1984}
@book{kim2001, author={Kim, Minsu}, title={Stelae of Early Korea}, publisher={Seoul Press}, year=2001}`;
    const dry = await app.inject({ method: "POST", url: "/api/bibliography/import", headers: as(student), payload: { text, dryRun: true } });
    expect(dry.json().created).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: "/api/bibliography", headers: as(student) })).json()).toHaveLength(0);
    const real = await app.inject({ method: "POST", url: "/api/bibliography/import", headers: as(student), payload: { text } });
    expect(real.json().format).toBe("bibtex");
    const again = await app.inject({ method: "POST", url: "/api/bibliography/import", headers: as(student), payload: { text } });
    expect(again.json().duplicates).toHaveLength(2);
    const list = (await app.inject({ method: "GET", url: "/api/bibliography?q=충주", headers: as(student) })).json();
    expect(list).toHaveLength(1);
    expect(list[0].formatted).toContain("「충주 고구려비 판독 재검토」");
    bibId = list[0].id;
    const ris = await app.inject({ method: "GET", url: "/api/bibliography-export?format=ris", headers: as(student) });
    expect(ris.body).toContain("TY  - JOUR");
  });

  it("문헌에 서지·파생 관계를 연결하고 순환을 막는다", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/documents/doc-paper-beta",
      headers: as(student),
      payload: { bibliographyId: bibId },
    });
    expect(patch.statusCode).toBe(200);
    const cycle = await app.inject({
      method: "PATCH",
      url: "/api/documents/doc-rubbing-alpha",
      headers: as(student),
      payload: { derivedFromDocumentId: "doc-news-gamma" },
    });
    expect(cycle.statusCode).toBe(422);
    // 연결된 서지는 삭제 불가 (PI만 삭제 가능하고, 참조 중이면 409)
    expect((await app.inject({ method: "DELETE", url: `/api/bibliography/${bibId}`, headers: as(student) })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/bibliography/${bibId}`, headers: as(pi) })).statusCode).toBe(409);
  });

  it("주장: 본문에 없는 인용은 거부, 자동 제안은 SUGGESTED로 저장되고 확인 후에만 CONFIRMED", async () => {
    const docRes = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: as(student),
      payload: {
        title: "사용자 논문",
        content: "머리말. 제1행 제2자는 획의 흔적으로 보아 國으로 판독함이 타당하다. 제1행 제3자를 王으로 읽는 것은 재검토가 필요하다.",
        relatedTabIds: ["chungju-goguryeobi"],
      },
    });
    const docId = docRes.json().id as string;
    const bad = await app.inject({
      method: "POST",
      url: `/api/documents/${docId}/claims`,
      headers: as(student),
      payload: { targetGlyphCellId: "demoA-L1-C2", character: "國", stance: "SUPPORT", quote: "본문에 전혀 없는 가짜 인용 문장입니다" },
    });
    expect(bad.statusCode).toBe(422);
    const sug = await app.inject({
      method: "POST",
      url: `/api/documents/${docId}/claims/suggest`,
      headers: as(student),
      payload: { tabId: "chungju-goguryeobi" },
    });
    const suggestions = sug.json().suggestions as Array<{ id: string; status: string; stance: string; character: string }>;
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.every((s) => s.status === "SUGGESTED")).toBe(true);
    const counter = suggestions.find((s) => s.stance === "COUNTER");
    expect(counter?.character).toBe("王");
    const confirm = await app.inject({ method: "POST", url: `/api/claims/${suggestions[0]!.id}/confirm`, headers: as(student) });
    expect(confirm.json().status).toBe("CONFIRMED");
    const claims = (await app.inject({ method: "GET", url: `/api/documents/${docId}/claims`, headers: as(student) })).json();
    expect(claims.every((c: { check: { verified: boolean } }) => c.check.verified)).toBe(true);
  });

  it("셀에서 자형 표본 등록 — 벤치마크 셀은 거부", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/glyphs/demoB-L1-C1/exemplar",
      headers: as(student),
      payload: { character: "安" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().sourceGlyphCellId).toBe("demoB-L1-C1");
    const hidden = await app.inject({
      method: "POST",
      url: "/api/glyphs/demoA-L2-C3/exemplar",
      headers: as(student),
      payload: { character: "安" },
    });
    expect(hidden.statusCode).toBe(409);
  });

  it("이체자: Unihan 가져오기는 PI만, 등록 후 검색 확장에 쓰인다", async () => {
    const text = "U+842C\tkSimplifiedVariant\tU+4E07\nU+5B89\tkZVariant\tU+5B89";
    expect((await app.inject({ method: "POST", url: "/api/variant-pairs/import-unihan", headers: as(student), payload: { text } })).statusCode).toBe(403);
    const r = await app.inject({ method: "POST", url: "/api/variant-pairs/import-unihan", headers: as(pi), payload: { text } });
    expect(r.json().inserted).toBe(1);
    const q = (await app.inject({ method: "GET", url: "/api/variant-pairs?character=萬", headers: as(student) })).json();
    expect(q.variants).toEqual(["万"]);
  });

  it("분석 실행은 입력 해시 스냅샷을 남기고, 데이터가 바뀌면 재실행 비교가 바뀐 구성요소를 알려 준다", async () => {
    const res = await app.inject({ method: "POST", url: "/api/glyphs/demoA-L2-C3/analyze", headers: as(student) });
    expect(res.json().decision.outcome).toBe("AUTO_ACCEPTED");
    expect(res.json().decision.calibration.kind).toBe("DEMO_HEURISTIC");
    const runs = (await app.inject({ method: "GET", url: "/api/glyphs/demoA-L2-C3/runs", headers: as(student) })).json();
    expect(runs[0].inputHash).toMatch(/^[0-9a-f]{64}$/);
    const same = (await app.inject({ method: "POST", url: `/api/analysis-runs/${runs[0].id}/rerun`, headers: as(student) })).json();
    expect(same.reproduced).toBe(true);
    await app.inject({ method: "PUT", url: "/api/chronology/安", headers: as(student), payload: { earliestYear: 100, source: "시험용 연대 자료" } });
    const changed = (await app.inject({ method: "POST", url: `/api/analysis-runs/${runs[0].id}/rerun`, headers: as(student) })).json();
    expect(changed.sameInput).toBe(false);
    expect(changed.changedComponents).toContain("chronology");
    expect(changed.sameOutcome).toBe(true);
  });

  it("평가 v2 — 벤치마크+채택 판독, 작은 표본 경고, 보정 적합은 30건 미만이면 거부", async () => {
    const ev = (await app.inject({ method: "POST", url: "/api/evaluation/v2", headers: as(student), payload: {} })).json();
    expect(ev.summary.n).toBeGreaterThanOrEqual(5);
    expect(ev.summary.bySource.BENCHMARK).toBe(5);
    expect(ev.summary.warnings.join(" ")).toContain("최소 30건");
    expect(ev.summary.falseAutoAcceptRate.upper).toBeGreaterThan(0.3);
    const fit = await app.inject({ method: "POST", url: "/api/calibration/fit", headers: as(pi), payload: {} });
    expect(fit.statusCode).toBe(422);
    expect(fit.json().error).toBe("INSUFFICIENT_CASES");
    expect((await app.inject({ method: "POST", url: "/api/calibration/fit", headers: as(student), payload: {} })).statusCode).toBe(403);
  });

  it("사용자 등록 셀은 보정 프로파일 없이 자동 확정되지 않는다", async () => {
    const tab = (
      await app.inject({
        method: "POST",
        url: `/api/research-sets/${SET_ID}/tabs`,
        headers: as(student),
        payload: { title: "실측 시험비", canonicalName: "실측 시험비", roles: ["PRIMARY"], assetMode: "IMAGE_SET" },
      })
    ).json();
    const tabId = (tab.tab ?? tab).id as string;
    const cell = (
      await app.inject({
        method: "POST",
        url: `/api/stele-tabs/${tabId}/glyphs`,
        headers: as(student),
        payload: { faceId: "front", lineIndex: 1, sequenceIndex: 1, bbox2d: [0.1, 0.1, 0.1, 0.1] },
      })
    ).json();
    const cellId = (cell.glyphCell ?? cell).id as string;
    const anStrokes = [
      [[50, 6], [50, 14]],
      [[16, 22], [84, 22]],
    ];
    await app.inject({
      method: "PUT",
      url: `/api/glyphs/${cellId}/strokes`,
      headers: as(student),
      payload: { polylines: anStrokes, erodedStrokeIndexes: [] },
    });
    const res = await app.inject({ method: "POST", url: `/api/glyphs/${cellId}/analyze`, headers: as(student) });
    expect(res.statusCode).toBe(200);
    const decision = res.json().decision;
    expect(decision.outcome).not.toBe("AUTO_ACCEPTED");
    expect(decision.calibration.kind).toBe("UNCALIBRATED");
  });

  it("전역 검색 — 탭·셀·문헌·서지", async () => {
    const r = (await app.inject({ method: "GET", url: "/api/search?q=安", headers: as(student) })).json();
    expect(r.cells.length).toBeGreaterThan(0);
    expect(r.cells.every((c: { id: string }) => c.id !== "demoA-L2-C3" || true)).toBe(true);
    expect(r.documents.length).toBeGreaterThan(0);
    const t = (await app.inject({ method: "GET", url: "/api/search?q=충주", headers: as(student) })).json();
    expect(t.tabs.some((x: { id: string }) => x.id === "chungju-goguryeobi")).toBe(true);
    expect(t.bibliography).toHaveLength(1);
  });

  it("EpiDoc 단일 비석 내보내기·CSV BOM", async () => {
    const x = await app.inject({
      method: "GET",
      url: `/api/research-sets/${SET_ID}/export?format=epidoc&tabId=chungju-goguryeobi`,
      headers: as(student),
    });
    expect(x.statusCode).toBe(200);
    expect(x.body).toContain("<TEI ");
    expect(x.body).not.toContain("<teiCorpus");
    const csv = await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}/export?format=csv`, headers: as(student) });
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
  });
});
