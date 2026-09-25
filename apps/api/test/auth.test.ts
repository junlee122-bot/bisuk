import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";

const SET_ID = "early-korean-stelae-comparative";

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : String(raw ?? "");
  return first.split(";")[0]!;
}

describe("로컬 계정 인증·역할·세트 구성원", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let piCookie = "";

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-auth-test-"));
    const { buildServer } = await import("../src/server");
    app = buildServer({ authMode: "local", enableDevReset: false, dataDir: tmpDir });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("로그인 없이는 연구 데이터에 접근할 수 없다 (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/research-sets" });
    expect(res.statusCode).toBe(401);
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
  });

  it("최초 실행: 계정이 없으면 setup으로 첫 PI를 만든다 (한 번만)", async () => {
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json().needsSetup).toBe(true);
    const weak = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { email: "pi@lab.ac.kr", password: "short", displayName: "책임교수" },
    });
    expect(weak.statusCode).toBe(400);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { email: "pi@lab.ac.kr", password: "correct-horse-battery", displayName: "책임교수" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe("PI");
    piCookie = cookieFrom(res);
    expect(piCookie).toMatch(/^seokmun_sid=/);
    expect(String(res.headers["set-cookie"])).toContain("HttpOnly");
    const again = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { email: "x@lab.ac.kr", password: "another-long-password", displayName: "x" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("세션 쿠키로 접근하고, 감사 로그 actor에 실제 사용자가 기록된다", async () => {
    const res = await app.inject({ method: "GET", url: "/api/research-sets", headers: { cookie: piCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].myRole).toBe("PI");
    await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}`,
      headers: { cookie: piCookie },
      payload: { description: "설명 갱신" },
    });
    const audit = await app.inject({
      method: "GET",
      url: "/api/audit?action=UPDATE_RESEARCH_SET",
      headers: { cookie: piCookie },
    });
    const ev = audit.json()[0];
    expect(ev.actorName).toBe("책임교수");
    expect(ev.actor).toMatch(/^user-/);
    expect(ev.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  let studentId = "";
  let studentCookie = "";
  let guestCookie = "";

  it("PI가 연구원·방문자 계정을 만들고, 임시 비밀번호로 로그인한다", async () => {
    const s = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: piCookie },
      payload: { email: "student@lab.ac.kr", displayName: "대학원생", role: "RESEARCHER" },
    });
    expect(s.statusCode).toBe(201);
    studentId = s.json().user.id;
    const temp = s.json().temporaryPassword as string;
    expect(temp.length).toBeGreaterThanOrEqual(10);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "student@lab.ac.kr", password: temp },
    });
    expect(login.statusCode).toBe(200);
    studentCookie = cookieFrom(login);

    const g = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: piCookie },
      payload: { email: "guest@lab.ac.kr", displayName: "방문 연구자", role: "GUEST", password: "guest-password-123" },
    });
    expect(g.json().temporaryPassword).toBeNull();
    const gl = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "guest@lab.ac.kr", password: "guest-password-123" },
    });
    guestCookie = cookieFrom(gl);
  });

  it("역할별 차단: 방문자는 쓰기 불가, 연구원은 권리 확정·계정 관리 불가", async () => {
    const guestWrite = await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}`,
      headers: { cookie: guestCookie },
      payload: { description: "x" },
    });
    expect(guestWrite.statusCode).toBe(403);
    const guestRead = await app.inject({ method: "GET", url: `/api/research-sets/${SET_ID}`, headers: { cookie: guestCookie } });
    expect(guestRead.statusCode).toBe(200);
    const license = await app.inject({
      method: "POST",
      url: "/api/assets/asset-demo-a/license",
      headers: { cookie: studentCookie },
      payload: { licenseType: "KOGL_TYPE_1", rightsState: "OPEN_FOR_REUSE", verifiedBy: "me", notes: "" },
    });
    expect(license.statusCode).toBe(403);
    const users = await app.inject({ method: "GET", url: "/api/users", headers: { cookie: studentCookie } });
    expect(users.statusCode).toBe(403);
    const studentWrite = await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}`,
      headers: { cookie: studentCookie },
      payload: { description: "연구원 수정" },
    });
    expect(studentWrite.statusCode).toBe(200);
  });

  it("세트에 구성원을 지정하면 비구성원 연구원은 접근이 막힌다", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: piCookie },
      payload: { email: "other@lab.ac.kr", displayName: "타 연구원", role: "RESEARCHER", password: "other-password-123" },
    });
    const otherLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "other@lab.ac.kr", password: "other-password-123" },
    });
    const otherCookie = cookieFrom(otherLogin);
    expect(other.statusCode).toBe(201);
    // 구성원 없음 = 연구실 전체 공유
    expect(
      (await app.inject({ method: "GET", url: "/api/stele-tabs/chungju-goguryeobi", headers: { cookie: otherCookie } })).statusCode
    ).toBe(200);
    const add = await app.inject({
      method: "PUT",
      url: `/api/research-sets/${SET_ID}/members/${studentId}`,
      headers: { cookie: piCookie },
      payload: { role: "RESEARCHER" },
    });
    expect(add.statusCode).toBe(200);
    const denied = await app.inject({
      method: "GET",
      url: "/api/stele-tabs/chungju-goguryeobi",
      headers: { cookie: otherCookie },
    });
    expect(denied.statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: "/api/research-sets", headers: { cookie: otherCookie } });
    expect(list.json()).toHaveLength(0);
    const member = await app.inject({
      method: "GET",
      url: "/api/stele-tabs/chungju-goguryeobi",
      headers: { cookie: studentCookie },
    });
    expect(member.statusCode).toBe(200);
    // 문자 셀 경로도 세트 권한으로 보호된다
    const cell = await app.inject({ method: "GET", url: "/api/glyphs/demoA-L2-C3/dossier", headers: { cookie: otherCookie } });
    expect(cell.statusCode).toBe(403);
  });

  it("허용 목록 밖 Origin의 상태 변경 요청은 거부된다 (CSRF 완화)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}`,
      headers: { cookie: piCookie, origin: "http://evil.example" },
      payload: { description: "x" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ORIGIN_NOT_ALLOWED");
    const ok = await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}`,
      headers: { cookie: piCookie, origin: "http://localhost:3100" },
      payload: { description: "정상 출처" },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("로컬 모드에서는 dev reset이 비활성 (데이터 보호)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/dev/reset", headers: { cookie: piCookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("DEV_RESET_DISABLED");
  });

  it("비밀번호 오류 5회 후 잠금, 마지막 PI는 강등 불가", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "guest@lab.ac.kr", password: "wrong-password" },
      });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "guest@lab.ac.kr", password: "guest-password-123" },
    });
    expect(locked.statusCode).toBe(429);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: piCookie } });
    const demote = await app.inject({
      method: "PATCH",
      url: `/api/users/${me.json().user.id}`,
      headers: { cookie: piCookie },
      payload: { role: "RESEARCHER" },
    });
    expect(demote.statusCode).toBe(409);
  });

  it("로그아웃하면 세션이 무효화된다", async () => {
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: studentCookie } });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/research-sets", headers: { cookie: studentCookie } });
    expect(after.statusCode).toBe(401);
  });

  it("감사 로그 해시 체인 검증 — 정상 체인은 ok, DB 직접 변조는 검출", async () => {
    const v = await app.inject({ method: "GET", url: "/api/audit/verify", headers: { cookie: piCookie } });
    expect(v.json().ok).toBe(true);
    expect(v.json().checked).toBeGreaterThan(5);
    // 추가 전용 트리거: UPDATE/DELETE 거부
    const raw = new Database(path.join(tmpDir, "seokmun.db"));
    expect(() => raw.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/);
    expect(() => raw.prepare("UPDATE audit_events SET data = '{}'").run()).toThrow(/append-only/);
    // 트리거를 우회해 변조하면 검증이 실패한다
    raw.exec("DROP TRIGGER audit_no_update");
    raw.prepare("UPDATE audit_events SET data = json_set(data, '$.payload.tampered', 1) WHERE seq = 3").run();
    raw.close();
    const v2 = await app.inject({ method: "GET", url: "/api/audit/verify", headers: { cookie: piCookie } });
    expect(v2.json().ok).toBe(false);
    expect(v2.json().firstBrokenSeq).toBe(3);
  });
});

describe("SSO 리버스 프록시 헤더 모드", () => {
  let app: FastifyInstance;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "seokmun-proxy-test-"));
    process.env.SEOKMUN_PROXY_SHARED_SECRET = "s3cret-proxy-token";
    const { buildServer } = await import("../src/server");
    app = buildServer({
      authMode: "proxy-header",
      enableDevReset: false,
      dataDir: tmpDir,
      bootstrapAdmin: { email: "pi@univ.ac.kr", password: "unused-in-proxy", displayName: "PI" },
    });
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.SEOKMUN_PROXY_SHARED_SECRET;
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("공유 비밀 없이 헤더만 위조하면 거부된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/research-sets",
      headers: { "x-forwarded-email": "pi@univ.ac.kr" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("프록시가 보낸 사용자는 자동 등록(기본 GUEST), 부트스트랩 이메일은 PI", async () => {
    const guest = await app.inject({
      method: "GET",
      url: "/api/research-sets",
      headers: { "x-forwarded-email": "new@univ.ac.kr", "x-seokmun-proxy-secret": "s3cret-proxy-token" },
    });
    expect(guest.statusCode).toBe(200);
    const guestWrite = await app.inject({
      method: "PATCH",
      url: `/api/research-sets/${SET_ID}`,
      headers: { "x-forwarded-email": "new@univ.ac.kr", "x-seokmun-proxy-secret": "s3cret-proxy-token" },
      payload: { description: "x" },
    });
    expect(guestWrite.statusCode).toBe(403);
    const pi = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { "x-forwarded-email": "pi@univ.ac.kr", "x-seokmun-proxy-secret": "s3cret-proxy-token" },
    });
    expect(pi.statusCode).toBe(200);
    expect(pi.json().some((u: { email: string; role: string }) => u.email === "new@univ.ac.kr" && u.role === "GUEST")).toBe(true);
  });
});

describe("기동 안전 검사", () => {
  it("dev 인증 모드를 외부 인터페이스에 바인딩하면 기동을 거부한다", async () => {
    const { buildServer } = await import("../src/server");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "seokmun-unsafe-"));
    expect(() => buildServer({ authMode: "dev", host: "0.0.0.0", dataDir: tmp })).toThrow(/loopback/);
    expect(() => buildServer({ authMode: "dev", nodeEnv: "production", host: "127.0.0.1", dataDir: tmp })).toThrow(
      /운영 환경/
    );
    rmSync(tmp, { recursive: true, force: true });
  });
});
