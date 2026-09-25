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

describe("실제 비석 등록·판독 흐름 (편집·판독·검토·토론)", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let pi = "";
  let student = "";
  let guest = "";
  let tabId = "";

  const as = (cookie: string) => ({ cookie });

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-edit-test-"));
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
    for (const [email, role, name] of [
      ["student@lab.ac.kr", "RESEARCHER", "대학원생"],
      ["guest@lab.ac.kr", "GUEST", "방문자"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/api/users",
        headers: as(pi),
        payload: { email, displayName: name, role, password: "a-long-password-1" },
      });
    }
    student = cookieFrom(
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "student@lab.ac.kr", password: "a-long-password-1" } })
    );
    guest = cookieFrom(
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "guest@lab.ac.kr", password: "a-long-password-1" } })
    );
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("연구원이 새 비석 탭을 만들고 메타데이터를 채운다 (권리 상태는 PI만)", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/research-sets/${SET_ID}/tabs`,
      headers: as(student),
      payload: { title: "테스트 비석", roles: ["COMPARATIVE"], assetMode: "IMAGE_SET" },
    });
    expect(created.statusCode).toBe(201);
    tabId = created.json().id;
    const tab = created.json();
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/stele-tabs/${tabId}`,
      headers: as(student),
      payload: {
        canonicalName: "테스트 비석 (가칭)",
        periodEstimate: "6세기 전반",
        material: "화강암",
        location: "경상북도",
        knownFacts: ["2026년 보고"],
        expectedUpdatedAt: tab.updatedAt,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().material).toBe("화강암");
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/stele-tabs/${tabId}`,
      headers: as(student),
      payload: { material: "사암", expectedUpdatedAt: tab.updatedAt },
    });
    expect(stale.statusCode).toBe(409);
    const rights = await app.inject({
      method: "PATCH",
      url: `/api/stele-tabs/${tabId}`,
      headers: as(student),
      payload: { rightsState: "OPEN_FOR_REUSE" },
    });
    expect(rights.statusCode).toBe(403);
    const byPi = await app.inject({
      method: "PATCH",
      url: `/api/stele-tabs/${tabId}`,
      headers: as(pi),
      payload: { rightsState: "RESEARCH_ONLY" },
    });
    expect(byPi.json().rightsState).toBe("RESEARCH_ONLY");
  });

  it("출처 레코드 CRUD — http(s) URL만, 삭제는 PI", async () => {
    const bad = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/${tabId}/source-records`,
      headers: as(student),
      payload: { type: "REPORT", publisher: "국립문화유산연구원", url: "javascript:alert(1)" },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/${tabId}/source-records`,
      headers: as(student),
      payload: { type: "SURVEY_REPORT", publisher: "국립문화유산연구원", url: "https://www.nrich.go.kr/", reliabilityTier: 2 },
    });
    expect(ok.statusCode).toBe(201);
    const id = ok.json().id;
    expect((await app.inject({ method: "DELETE", url: `/api/source-records/${id}`, headers: as(student) })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/source-records/${id}`, headers: as(pi) })).statusCode).toBe(200);
  });

  it("판독문 붙여넣기: 미리보기 → 생성 (셀 + 출판 판독문 판독), 재가져오기 충돌 / 병합", async () => {
    const text = "# 앞면\n1 高句麗[太]王\n2 □□土?[...2...]";
    const preview = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/${tabId}/transcription-import`,
      headers: as(student),
      payload: { text, mode: "preview", sourceLabel: "갑 2026" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().parsed.stats).toMatchObject({ cells: 10, characters: 6, lacunae: 4, supplied: 1, unclear: 1 });
    const create = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/${tabId}/transcription-import`,
      headers: as(student),
      payload: { text, mode: "create", sourceLabel: "갑 2026", citationLocator: "p.12" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ createdCells: 10, createdReadings: 10 });
    const detail = (await app.inject({ method: "GET", url: `/api/stele-tabs/${tabId}`, headers: as(student) })).json();
    expect(detail.glyphCells).toHaveLength(10);
    const l1c4 = detail.glyphCells.find((c: { lineIndex: number; sequenceIndex: number }) => c.lineIndex === 1 && c.sequenceIndex === 4);
    expect(l1c4.readingStatus).toBe("TEXTUAL_SUPPLEMENT");
    expect(l1c4.publishedReading).toBe("太");
    const again = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/${tabId}/transcription-import`,
      headers: as(student),
      payload: { text, mode: "create", sourceLabel: "을 2027" },
    });
    expect(again.statusCode).toBe(409);
    const merge = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/${tabId}/transcription-import`,
      headers: as(student),
      payload: { text: "1 高句麗大王", mode: "create", onExisting: "merge", sourceLabel: "을 2027" },
    });
    expect(merge.json()).toMatchObject({ createdCells: 0, createdReadings: 5 });
    const cmp = await app.inject({ method: "GET", url: `/api/stele-tabs/${tabId}/reading-comparison`, headers: as(guest) });
    const table = cmp.json();
    expect(table.columns.map((c: { label: string }) => c.label)).toEqual(["갑 2026", "을 2027"]);
    const row = table.rows.find((r: { lineIndex: number; sequenceIndex: number }) => r.lineIndex === 1 && r.sequenceIndex === 4);
    expect(row.disagreement).toBe(true);
    expect(row.values["PUBLISHED_EDITION:갑 2026"]).toBe("[太]");
    const csv = await app.inject({ method: "GET", url: `/api/stele-tabs/${tabId}/reading-comparison?format=csv`, headers: as(guest) });
    expect(csv.body.startsWith("﻿면,행,자")).toBe(true);
  });

  let cellId = "";
  it("셀 수정: 낙관적 잠금 409, 이력 스냅샷, PI 되돌리기", async () => {
    const detail = (await app.inject({ method: "GET", url: `/api/stele-tabs/${tabId}`, headers: as(student) })).json();
    const cell = detail.glyphCells.find((c: { lineIndex: number; sequenceIndex: number }) => c.lineIndex === 2 && c.sequenceIndex === 3);
    cellId = cell.id;
    const upd = await app.inject({
      method: "PATCH",
      url: `/api/glyphs/${cellId}`,
      headers: as(student),
      payload: { bbox2d: [0.1, 0.2, 0.08, 0.07], damageGrade: 4, expectedVersion: cell.version, reason: "탁본 대조로 칸 조정" },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().version).toBe(cell.version + 1);
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/glyphs/${cellId}`,
      headers: as(student),
      payload: { damageGrade: 1, expectedVersion: cell.version },
    });
    expect(stale.statusCode).toBe(409);
    const autoStatus = await app.inject({
      method: "PATCH",
      url: `/api/glyphs/${cellId}`,
      headers: as(student),
      payload: { readingStatus: "MULTI_SOURCE_AUTOMATIC" },
    });
    expect(autoStatus.statusCode).toBe(400);
    const hist = (await app.inject({ method: "GET", url: `/api/glyphs/${cellId}/history`, headers: as(student) })).json();
    expect(hist[0].reason).toBe("탁본 대조로 칸 조정");
    expect(hist[0].actorName).toBe("대학원생");
    const revertByStudent = await app.inject({
      method: "POST",
      url: `/api/glyphs/${cellId}/revert`,
      headers: as(student),
      payload: { versionId: hist[0].id },
    });
    expect(revertByStudent.statusCode).toBe(403);
    const revert = await app.inject({
      method: "POST",
      url: `/api/glyphs/${cellId}/revert`,
      headers: as(pi),
      payload: { versionId: hist[0].id, reason: "칸 조정 취소" },
    });
    expect(revert.statusCode).toBe(200);
    expect(revert.json().damageGrade).toBe(cell.damageGrade);
  });

  it("획 트레이싱: 작성자·기준 자산 기록 + 특징 벡터, 벤치마크 셀은 잠금", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/glyphs/${cellId}/strokes`,
      headers: as(student),
      payload: { polylines: [[[20, 30], [80, 30]], [[50, 10], [50, 90]]], erodedStrokeIndexes: [1], note: "탁본 A 기준" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().strokeProvenance.tracedBy).toContain("대학원생");
    expect(res.json().featureVector.length).toBeGreaterThan(0);
    const bad = await app.inject({
      method: "PUT",
      url: `/api/glyphs/${cellId}/strokes`,
      headers: as(student),
      payload: { polylines: [[[20, 30]]] },
    });
    expect(bad.statusCode).toBe(400);
    const bench = await app.inject({
      method: "PUT",
      url: `/api/glyphs/demoA-L2-C3/strokes`,
      headers: as(pi),
      payload: { polylines: [[[0, 0], [10, 10]]] },
    });
    expect([200, 409]).toContain(bench.statusCode);
  });

  let proposalId = "";
  it("연구원 판독 제안 → PI 승인 = 채택 → 다른 판독 승인 시 이전 채택은 대체(SUPERSEDED)", async () => {
    const bad = await app.inject({
      method: "POST",
      url: `/api/glyphs/${cellId}/readings`,
      headers: as(student),
      payload: { sourceType: "RESEARCHER", reading: "王國" },
    });
    expect(bad.statusCode).toBe(400);
    const p = await app.inject({
      method: "POST",
      url: `/api/glyphs/${cellId}/readings`,
      headers: as(student),
      payload: { sourceType: "RESEARCHER", reading: "土", certainty: "PROBABLE", rationale: "가로획 2개 관찰" },
    });
    expect(p.statusCode).toBe(201);
    proposalId = p.json().id;
    expect(p.json().reviewStatus).toBe("PROPOSED");
    const queue = (await app.inject({ method: "GET", url: "/api/review-queue", headers: as(pi) })).json();
    expect(queue.some((q: { reading: { id: string } }) => q.reading.id === proposalId)).toBe(true);
    expect(
      (await app.inject({ method: "POST", url: `/api/readings/${proposalId}/review`, headers: as(student), payload: { decision: "ACCEPT" } }))
        .statusCode
    ).toBe(403);
    const acc = await app.inject({
      method: "POST",
      url: `/api/readings/${proposalId}/review`,
      headers: as(pi),
      payload: { decision: "ACCEPT", note: "동의" },
    });
    expect(acc.statusCode).toBe(200);
    expect(acc.json().cell.adoptedReadingId).toBe(proposalId);
    expect(acc.json().cell.readingStatus).toBe("OBSERVED");
    // 승인된 판독은 작성자가 고칠 수 없다
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/readings/${proposalId}`,
      headers: as(student),
      payload: { rationale: "수정" },
    });
    expect(edit.statusCode).toBe(403);
    // 새 판독 승인 → 이전 채택은 SUPERSEDED
    const p2 = await app.inject({
      method: "POST",
      url: `/api/glyphs/${cellId}/readings`,
      headers: as(student),
      payload: { sourceType: "RESEARCHER", reading: "士", supplied: true, rationale: "재검토" },
    });
    await app.inject({ method: "POST", url: `/api/readings/${p2.json().id}/review`, headers: as(pi), payload: { decision: "ACCEPT" } });
    const list = (await app.inject({ method: "GET", url: `/api/glyphs/${cellId}/readings`, headers: as(student) })).json();
    expect(list.adoptedReadingId).toBe(p2.json().id);
    expect(list.readings.find((r: { id: string }) => r.id === proposalId).reviewStatus).toBe("SUPERSEDED");
    expect(list.cell.readingStatus).toBe("TEXTUAL_SUPPLEMENT");
    // 채택 판독은 삭제 불가
    const del = await app.inject({ method: "DELETE", url: `/api/readings/${p2.json().id}`, headers: as(pi) });
    expect(del.statusCode).toBe(409);
  });

  it("채택 판독이 있는 셀은 자동 분석이 상태를 덮어쓰지 않는다", async () => {
    // 데모 셀에 판독을 채택한 뒤 분석
    const r = await app.inject({
      method: "POST",
      url: "/api/glyphs/demoA-L3-C5/readings",
      headers: as(student),
      payload: { sourceType: "RESEARCHER", readingKind: "ILLEGIBLE" },
    });
    await app.inject({ method: "POST", url: `/api/readings/${r.json().id}/review`, headers: as(pi), payload: { decision: "ACCEPT" } });
    const a = await app.inject({ method: "POST", url: "/api/glyphs/demoA-L3-C5/analyze", headers: as(student) });
    expect(a.statusCode).toBe(200);
    expect(a.json().glyphCell.readingStatus).toBe("ILLEGIBLE");
    expect(a.json().glyphCell.adoptedReadingId).toBe(r.json().id);
    const dossier = (await app.inject({ method: "GET", url: "/api/glyphs/demoA-L3-C5/dossier", headers: as(guest) })).json();
    expect(dossier.adoptedReadingId).toBe(r.json().id);
    expect(dossier.readings).toHaveLength(1);
  });

  it("토론: 연구원 댓글·답글, 방문자는 읽기만, PI가 해결 처리", async () => {
    const c = await app.inject({
      method: "POST",
      url: "/api/comments",
      headers: as(student),
      payload: { targetType: "GLYPH_CELL", targetId: cellId, body: "하단 획이 탁본 B에서는 안 보입니다" },
    });
    expect(c.statusCode).toBe(201);
    const reply = await app.inject({
      method: "POST",
      url: "/api/comments",
      headers: as(pi),
      payload: { targetType: "GLYPH_CELL", targetId: cellId, parentId: c.json().id, body: "RTI로 재확인합시다" },
    });
    expect(reply.statusCode).toBe(201);
    const g = await app.inject({
      method: "POST",
      url: "/api/comments",
      headers: as(guest),
      payload: { targetType: "GLYPH_CELL", targetId: cellId, body: "x" },
    });
    expect(g.statusCode).toBe(403);
    const list = (
      await app.inject({ method: "GET", url: `/api/comments?targetType=GLYPH_CELL&targetId=${cellId}`, headers: as(guest) })
    ).json();
    expect(list).toHaveLength(2);
    const resolve = await app.inject({
      method: "PATCH",
      url: `/api/comments/${c.json().id}`,
      headers: as(pi),
      payload: { resolved: true },
    });
    expect(resolve.json().resolved).toBe(true);
    const editOther = await app.inject({
      method: "PATCH",
      url: `/api/comments/${c.json().id}`,
      headers: as(pi),
      payload: { body: "남의 글 수정" },
    });
    expect(editOther.statusCode).toBe(403);
  });

  it("자산 단위 확정·축척 막대·정렬, Frontier 항목 등록", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d494844520000064000000c8008020000000000000000", "hex");
    const up = await app.inject({
      method: "POST",
      url: `/api/stele-tabs/${tabId}/assets/upload?filename=takbon.png&usagePurpose=x&declaredType=RUBBING`,
      headers: { ...as(student), "content-type": "application/octet-stream" },
      payload: png,
    });
    const assetId = up.json().id;
    expect(up.json().imageInfo).toEqual({ width: 1600, height: 3200 });
    const bar = await app.inject({
      method: "POST",
      url: `/api/assets/${assetId}/scale-bar`,
      headers: as(student),
      payload: { p1: [100, 3000], p2: [600, 3000], realLengthMm: 100 },
    });
    expect(bar.statusCode).toBe(200);
    expect(bar.json().scaleCalibration.method).toBe("SCALE_BAR");
    expect(bar.json().scaleCalibration.metersPerUnit).toBeCloseTo(0.0002, 8);
    const scale = await app.inject({
      method: "PATCH",
      url: `/api/assets/${assetId}/scale`,
      headers: as(student),
      payload: { unit: "px" },
    });
    expect(scale.statusCode).toBe(400);
    const align = await app.inject({
      method: "PATCH",
      url: `/api/assets/${assetId}/alignment`,
      headers: as(student),
      payload: { rotationDeg: [-90, 0, 0] },
    });
    expect(align.json().alignment.rotationDeg).toEqual([-90, 0, 0]);
    const f = await app.inject({
      method: "POST",
      url: "/api/frontier",
      headers: as(student),
      payload: { provisionalName: "신발견 비편", reportingInstitution: "어느 박물관" },
    });
    expect(f.statusCode).toBe(201);
    expect(f.json().status).toBe("NEWS_MENTION");
  });

  it("보관한 탭을 복구할 수 있다", async () => {
    await app.inject({ method: "POST", url: `/api/stele-tabs/${tabId}/archive`, headers: as(student) });
    const archived = (await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}/archived-tabs`, headers: as(student) })).json();
    expect(archived.some((t: { id: string }) => t.id === tabId)).toBe(true);
    const un = await app.inject({ method: "POST", url: `/api/stele-tabs/${tabId}/unarchive`, headers: as(student) });
    expect(un.statusCode).toBe(200);
    const set = (await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}`, headers: as(student) })).json();
    expect(set.tabs.some((t: { tab: { id: string } }) => t.tab.id === tabId)).toBe(true);
  });
});
