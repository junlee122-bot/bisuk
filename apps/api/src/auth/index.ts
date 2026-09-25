import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { UserRole, type PublicUser, type User } from "@seokmun/types";
import type { AppConfig } from "../config";
import { isLoopback } from "../config";
import { newId, requestContext, type RequestContext } from "../context";
import type { Db } from "../db";
import { auditEvents, credentials, researchSets, sessions, setMembers, users } from "../repo";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { canAccessSet, hasRole, minRoleFor, resolveSetId, ROLE_RANK } from "./policy";

export const SESSION_COOKIE = "seokmun_sid";

declare module "fastify" {
  interface FastifyRequest {
    user: PublicUser | null;
  }
}

export const DEV_USERS: Array<Pick<User, "id" | "email" | "displayName" | "role">> = [
  { id: "user-dev-pi", email: "pi@dev.local", displayName: "개발 PI", role: "PI" },
  { id: "user-dev-researcher", email: "researcher@dev.local", displayName: "개발 연구원", role: "RESEARCHER" },
  { id: "user-dev-guest", email: "guest@dev.local", displayName: "개발 방문자", role: "GUEST" },
];

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function sessionCookie(cfg: AppConfig, token: string, maxAgeSec: number): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
    ...(cfg.cookieSecure ? ["Secure"] : []),
  ].join("; ");
}

function clearCookie(cfg: AppConfig): string {
  return sessionCookie(cfg, "", 0);
}

export function ensureDevUsers(db: Db): void {
  const now = new Date().toISOString();
  for (const u of DEV_USERS) {
    if (!users.get(db, u.id)) {
      users.put(db, { ...u, active: true, authProvider: "DEV", createdAt: now, lastLoginAt: null });
    }
  }
}

export async function ensureBootstrapAdmin(db: Db, cfg: AppConfig): Promise<void> {
  if (!cfg.bootstrapAdmin || cfg.authMode === "dev") return;
  const existing = users.getByEmail(db, cfg.bootstrapAdmin.email);
  if (existing) return;
  const problem = cfg.authMode === "local" ? passwordProblem(cfg.bootstrapAdmin.password) : null;
  if (problem) throw new Error(`SEOKMUN_BOOTSTRAP_ADMIN_PASSWORD: ${problem}`);
  const now = new Date().toISOString();
  const user: User = {
    id: newId("user"),
    email: cfg.bootstrapAdmin.email.toLowerCase(),
    displayName: cfg.bootstrapAdmin.displayName,
    role: "PI",
    active: true,
    authProvider: cfg.authMode === "proxy-header" ? "PROXY_HEADER" : "LOCAL",
    createdAt: now,
    lastLoginAt: null,
  };
  users.put(db, user);
  if (cfg.authMode === "local") {
    credentials.set(db, user.id, await hashPassword(cfg.bootstrapAdmin.password));
  }
  auditEvents.record(db, "BOOTSTRAP_ADMIN", "User", user.id, { email: user.email }, {
    id: "system",
    name: "system",
  });
}

/** 로그인 실패 제한 — (IP, 이메일)별 5회 실패 시 15분 잠금 */
const loginFailures = new Map<string, { count: number; until: number }>();
function loginLocked(key: string): boolean {
  const f = loginFailures.get(key);
  return Boolean(f && f.count >= 5 && f.until > Date.now());
}
function noteLoginFailure(key: string): void {
  const f = loginFailures.get(key);
  const now = Date.now();
  if (!f || f.until < now) loginFailures.set(key, { count: 1, until: now + 15 * 60_000 });
  else f.count++;
}

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerAuth(app: FastifyInstance, db: Db, cfg: AppConfig): void {
  app.decorateRequest("user", null);
  const proxySecret = process.env.SEOKMUN_PROXY_SHARED_SECRET ?? "";
  if (cfg.authMode === "proxy-header" && !proxySecret) {
    app.log.warn(
      "proxy-header 인증 모드에 SEOKMUN_PROXY_SHARED_SECRET이 없습니다 — SSO 프록시를 우회한 직접 접속을 반드시 차단하세요."
    );
  }

  function userFromSession(req: FastifyRequest): PublicUser | null {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const s = sessions.get(db, hashToken(token));
    if (!s || s.expiresAt < Date.now()) return null;
    const u = users.get(db, s.userId);
    return u && u.active ? toPublicUser(u) : null;
  }

  function userFromProxy(req: FastifyRequest): PublicUser | null {
    if (!cfg.trustedProxyIps.includes(req.ip)) return null;
    if (proxySecret && !secretMatches(req.headers["x-seokmun-proxy-secret"] as string | undefined, proxySecret)) {
      return null;
    }
    const email = (req.headers[cfg.proxyEmailHeader] as string | undefined) ??
      (req.headers[cfg.proxyUserHeader] as string | undefined);
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    let u = users.getByEmail(db, normalized);
    if (!u) {
      const now = new Date().toISOString();
      const isAdmin = cfg.bootstrapAdmin?.email.toLowerCase() === normalized;
      u = {
        id: newId("user"),
        email: normalized,
        displayName:
          (req.headers[cfg.proxyNameHeader] as string | undefined) ?? normalized.split("@")[0]!,
        role: isAdmin ? "PI" : cfg.proxyDefaultRole,
        active: true,
        authProvider: "PROXY_HEADER",
        createdAt: now,
        lastLoginAt: now,
      };
      users.put(db, u);
      auditEvents.record(db, "USER_PROVISIONED", "User", u.id, { email: normalized, role: u.role }, {
        id: "system",
        name: "SSO proxy",
      });
    }
    return u.active ? toPublicUser(u) : null;
  }

  function resolveUser(req: FastifyRequest): PublicUser | null {
    if (cfg.authMode === "proxy-header") return userFromProxy(req);
    const fromSession = userFromSession(req);
    if (fromSession) return fromSession;
    if (cfg.authMode === "dev") {
      const u = users.get(db, "user-dev-pi");
      return u ? toPublicUser(u) : null;
    }
    return null;
  }

  const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

  app.addHook("onRequest", (req, reply, done) => {
    const user = resolveUser(req);
    req.user = user;
    const ctx: RequestContext = { user, ip: req.ip, requestId: String(req.id) };

    // CSRF 완화: 상태 변경 요청의 Origin은 허용 목록이어야 한다 (SameSite=Lax 쿠키와 병행)
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && !cfg.allowedOrigins.includes(origin)) {
        void reply.status(403).send({ error: "ORIGIN_NOT_ALLOWED", message: "허용되지 않은 출처의 요청입니다" });
        return;
      }
    }

    const routeUrl = req.routeOptions.url;
    if (routeUrl && req.method !== "OPTIONS") {
      const min = minRoleFor(req.method, routeUrl);
      if (min !== "PUBLIC") {
        if (!user) {
          void reply.status(401).send({ error: "UNAUTHENTICATED", message: "로그인이 필요합니다" });
          return;
        }
        if (!hasRole(user, min)) {
          void reply.status(403).send({
            error: "FORBIDDEN",
            message: `이 작업에는 ${min} 역할이 필요합니다 (현재 ${user.role})`,
          });
          return;
        }
        const setId = resolveSetId(db, routeUrl, (req.params ?? {}) as Record<string, string>);
        if (typeof setId === "string" && !canAccessSet(db, user, setId, min)) {
          void reply.status(403).send({
            error: "SET_ACCESS_DENIED",
            message: "이 연구 세트에 대한 권한이 없습니다",
          });
          return;
        }
      }
    }
    requestContext.run(ctx, done);
  });

  // ── 인증 ──
  app.get("/api/auth/status", async (req) => ({
    mode: cfg.authMode,
    needsSetup: cfg.authMode === "local" && users.count(db) === 0,
    user: req.user,
    devUsers: cfg.authMode === "dev" ? DEV_USERS.map((u) => ({ email: u.email, displayName: u.displayName, role: u.role })) : [],
  }));

  async function startSession(req: FastifyRequest, reply: FastifyReply, user: User) {
    const token = randomBytes(32).toString("base64url");
    const ttlMs = cfg.sessionTtlHours * 3600_000;
    sessions.create(db, {
      idHash: hashToken(token),
      userId: user.id,
      expiresAt: Date.now() + ttlMs,
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] ?? ""),
    });
    users.put(db, { ...user, lastLoginAt: new Date().toISOString() });
    sessions.purgeExpired(db);
    void reply.header("set-cookie", sessionCookie(cfg, token, Math.floor(ttlMs / 1000)));
  }

  app.post("/api/auth/setup", async (req, reply) => {
    if (cfg.authMode !== "local") {
      return reply.status(400).send({ error: "NOT_LOCAL_MODE", message: "로컬 계정 모드에서만 초기 설정을 합니다" });
    }
    if (users.count(db) > 0) {
      return reply.status(409).send({ error: "ALREADY_SET_UP", message: "이미 계정이 있습니다. 로그인하세요." });
    }
    const body = z
      .object({ email: z.string().email(), password: z.string(), displayName: z.string().min(1).max(80) })
      .parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) return reply.status(400).send({ error: "WEAK_PASSWORD", message: problem });
    const now = new Date().toISOString();
    const user: User = {
      id: newId("user"),
      email: body.email.toLowerCase(),
      displayName: body.displayName,
      role: "PI",
      active: true,
      authProvider: "LOCAL",
      createdAt: now,
      lastLoginAt: null,
    };
    users.put(db, user);
    credentials.set(db, user.id, await hashPassword(body.password));
    auditEvents.record(db, "SETUP_FIRST_PI", "User", user.id, { email: user.email }, { id: user.id, name: user.displayName });
    await startSession(req, reply, user);
    return reply.status(201).send({ user: toPublicUser(user) });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = z.object({ email: z.string().min(1), password: z.string().default("") }).parse(req.body);
    const email = body.email.trim().toLowerCase();
    if (cfg.authMode === "proxy-header") {
      return reply.status(400).send({ error: "SSO_MODE", message: "학교 SSO로 로그인하세요" });
    }
    const key = `${req.ip}|${email}`;
    if (loginLocked(key)) {
      return reply.status(429).send({ error: "LOCKED", message: "로그인 실패가 많아 15분간 잠겼습니다" });
    }
    const user = users.getByEmail(db, email);
    let ok = false;
    if (user && user.active) {
      if (cfg.authMode === "dev" && user.authProvider === "DEV") ok = true;
      else {
        const stored = credentials.get(db, user.id);
        ok = stored ? await verifyPassword(body.password, stored) : false;
      }
    }
    if (!ok || !user) {
      noteLoginFailure(key);
      auditEvents.record(db, "LOGIN_FAILED", "User", user?.id ?? email, { email }, { id: "anonymous", name: email });
      return reply.status(401).send({ error: "INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 올바르지 않습니다" });
    }
    loginFailures.delete(key);
    await startSession(req, reply, user);
    auditEvents.record(db, "LOGIN", "User", user.id, {}, { id: user.id, name: user.displayName });
    return { user: toPublicUser(user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) sessions.delete(db, hashToken(token));
    void reply.header("set-cookie", clearCookie(cfg));
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({ user: req.user }));

  app.post("/api/auth/password", async (req, reply) => {
    if (cfg.authMode !== "local") {
      return reply.status(400).send({ error: "NOT_LOCAL_MODE", message: "로컬 계정 모드에서만 비밀번호를 바꿉니다" });
    }
    const body = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(req.body);
    const me = req.user!;
    const stored = credentials.get(db, me.id);
    if (!stored || !(await verifyPassword(body.currentPassword, stored))) {
      return reply.status(401).send({ error: "INVALID_CREDENTIALS", message: "현재 비밀번호가 올바르지 않습니다" });
    }
    const problem = passwordProblem(body.newPassword);
    if (problem) return reply.status(400).send({ error: "WEAK_PASSWORD", message: problem });
    credentials.set(db, me.id, await hashPassword(body.newPassword));
    sessions.deleteForUser(db, me.id);
    const u = users.get(db, me.id)!;
    await startSession(req, reply, u);
    auditEvents.record(db, "CHANGE_PASSWORD", "User", me.id, {});
    return { ok: true };
  });

  // ── 계정 관리 (PI) ──
  app.get("/api/users", async () => users.list(db).map((u) => ({ ...toPublicUser(u), active: u.active, authProvider: u.authProvider, lastLoginAt: u.lastLoginAt })));

  function tempPassword(): string {
    return randomBytes(12).toString("base64url");
  }

  app.post("/api/users", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        displayName: z.string().min(1).max(80),
        role: UserRole,
        password: z.string().optional(),
      })
      .parse(req.body);
    if (users.getByEmail(db, body.email)) {
      return reply.status(409).send({ error: "EMAIL_EXISTS", message: "이미 등록된 이메일입니다" });
    }
    const password = body.password ?? tempPassword();
    const problem = cfg.authMode === "local" ? passwordProblem(password) : null;
    if (problem) return reply.status(400).send({ error: "WEAK_PASSWORD", message: problem });
    const now = new Date().toISOString();
    const user: User = {
      id: newId("user"),
      email: body.email.toLowerCase(),
      displayName: body.displayName,
      role: body.role,
      active: true,
      authProvider: cfg.authMode === "proxy-header" ? "PROXY_HEADER" : "LOCAL",
      createdAt: now,
      lastLoginAt: null,
    };
    users.put(db, user);
    if (cfg.authMode === "local") credentials.set(db, user.id, await hashPassword(password));
    auditEvents.record(db, "CREATE_USER", "User", user.id, { email: user.email, role: user.role });
    return reply.status(201).send({
      user: toPublicUser(user),
      // 임시 비밀번호는 이 응답에서 한 번만 보여 준다
      temporaryPassword: body.password || cfg.authMode !== "local" ? null : password,
    });
  });

  function piCount(): number {
    return users.list(db).filter((u) => u.role === "PI" && u.active).length;
  }

  app.patch("/api/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const u = users.get(db, id);
    if (!u) return reply.status(404).send({ error: "NOT_FOUND", message: "사용자를 찾을 수 없습니다" });
    const body = z
      .object({
        role: UserRole.optional(),
        active: z.boolean().optional(),
        displayName: z.string().min(1).max(80).optional(),
      })
      .parse(req.body);
    const demoting = u.role === "PI" && ((body.role && body.role !== "PI") || body.active === false);
    if (demoting && piCount() <= 1) {
      return reply.status(409).send({ error: "LAST_PI", message: "마지막 PI는 강등·비활성화할 수 없습니다" });
    }
    const updated: User = { ...u, ...body };
    users.put(db, updated);
    if (body.active === false || (body.role && ROLE_RANK[body.role] < ROLE_RANK[u.role])) {
      sessions.deleteForUser(db, id);
    }
    auditEvents.record(db, "UPDATE_USER", "User", id, body);
    return toPublicUser(updated);
  });

  app.post("/api/users/:id/reset-password", async (req, reply) => {
    if (cfg.authMode !== "local") {
      return reply.status(400).send({ error: "NOT_LOCAL_MODE", message: "로컬 계정 모드에서만 비밀번호를 재설정합니다" });
    }
    const { id } = req.params as { id: string };
    const u = users.get(db, id);
    if (!u) return reply.status(404).send({ error: "NOT_FOUND", message: "사용자를 찾을 수 없습니다" });
    const password = tempPassword();
    credentials.set(db, id, await hashPassword(password));
    sessions.deleteForUser(db, id);
    auditEvents.record(db, "RESET_PASSWORD", "User", id, {});
    return { temporaryPassword: password };
  });

  // ── 세트 구성원·가시성 ──
  app.get("/api/research-sets/:id/members", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!researchSets.get(db, id)) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "연구 세트를 찾을 수 없습니다" });
    }
    return setMembers.list(db, id).map((m) => {
      const u = users.get(db, m.userId);
      return { ...m, displayName: u?.displayName ?? m.userId, email: u?.email ?? "" };
    });
  });

  app.put("/api/research-sets/:id/members/:userId", async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!researchSets.get(db, id)) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "연구 세트를 찾을 수 없습니다" });
    }
    if (!users.get(db, userId)) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "사용자를 찾을 수 없습니다" });
    }
    const body = z.object({ role: UserRole }).parse(req.body);
    setMembers.put(db, id, userId, body.role);
    auditEvents.record(db, "SET_MEMBER", "ResearchSet", id, { userId, role: body.role });
    return { ok: true };
  });

  app.delete("/api/research-sets/:id/members/:userId", async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    setMembers.remove(db, id, userId);
    auditEvents.record(db, "REMOVE_MEMBER", "ResearchSet", id, { userId });
    return { ok: true };
  });

  app.patch("/api/research-sets/:id/visibility", async (req, reply) => {
    const { id } = req.params as { id: string };
    const set = researchSets.get(db, id);
    if (!set) return reply.status(404).send({ error: "NOT_FOUND", message: "연구 세트를 찾을 수 없습니다" });
    const body = z.object({ visibility: z.enum(["PRIVATE", "SHARED", "PUBLIC"]) }).parse(req.body);
    researchSets.put(db, { ...set, visibility: body.visibility, updatedAt: new Date().toISOString() });
    auditEvents.record(db, "SET_VISIBILITY", "ResearchSet", id, body);
    return { ok: true, visibility: body.visibility };
  });
}

export { isLoopback };
