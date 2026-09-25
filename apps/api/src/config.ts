import path from "node:path";

/**
 * 서버 설정 — 모든 값은 환경 변수에서 읽는다.
 * 기본값은 "연구실 서버에 그대로 띄워도 안전한" 쪽으로 둔다:
 * 로컬 계정 인증 필수, loopback 바인딩, dev reset 비활성.
 */
export type AuthMode = "local" | "proxy-header" | "dev";

export interface AppConfig {
  nodeEnv: string;
  dataDir: string;
  host: string;
  port: number;
  /** CORS·Origin 검사 허용 목록 */
  allowedOrigins: string[];
  authMode: AuthMode;
  /** proxy-header 모드: SSO 리버스 프록시가 넣는 사용자 헤더 */
  proxyUserHeader: string;
  proxyEmailHeader: string;
  proxyNameHeader: string;
  /** 헤더를 신뢰할 프록시 IP */
  trustedProxyIps: string[];
  /** proxy-header 모드에서 처음 본 사용자의 역할 */
  proxyDefaultRole: "GUEST" | "RESEARCHER";
  /** E2E 결정성용 전체 초기화 — 명시적으로 켜야 하며 loopback 요청만 허용 */
  enableDevReset: boolean;
  sessionTtlHours: number;
  cookieSecure: boolean;
  logLevel: string;
  /** 업로드 파일 최대 크기 (바이트) */
  maxUploadBytes: number;
  /** 이 크기 이하 메시만 업로드 직후 전체 파싱 (초과분은 헤더 검사만) */
  fullParseMaxBytes: number;
  bootstrapAdmin: { email: string; password: string; displayName: string } | null;
  /** 첫 실행 시 가상 데모 세트를 자동 시드할지 */
  seedDemo: boolean;
}

function list(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function defaultDataDir(): string {
  return path.resolve(import.meta.dirname, "../.data");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const rawMode = (env.SEOKMUN_AUTH_MODE ?? "local").toLowerCase();
  const authMode: AuthMode =
    rawMode === "dev" || rawMode === "proxy-header" ? rawMode : "local";
  const email = env.SEOKMUN_BOOTSTRAP_ADMIN_EMAIL;
  const password = env.SEOKMUN_BOOTSTRAP_ADMIN_PASSWORD;
  return {
    nodeEnv,
    dataDir: env.SEOKMUN_DATA_DIR ?? defaultDataDir(),
    host: env.SEOKMUN_HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? env.SEOKMUN_PORT ?? 4100),
    allowedOrigins: list(env.SEOKMUN_ALLOWED_ORIGINS, [
      "http://localhost:3100",
      "http://127.0.0.1:3100",
    ]),
    authMode,
    proxyUserHeader: (env.SEOKMUN_PROXY_USER_HEADER ?? "x-forwarded-user").toLowerCase(),
    proxyEmailHeader: (env.SEOKMUN_PROXY_EMAIL_HEADER ?? "x-forwarded-email").toLowerCase(),
    proxyNameHeader: (env.SEOKMUN_PROXY_NAME_HEADER ?? "x-forwarded-preferred-username").toLowerCase(),
    trustedProxyIps: list(env.SEOKMUN_TRUSTED_PROXY_IPS, ["127.0.0.1", "::1", "::ffff:127.0.0.1"]),
    proxyDefaultRole: env.SEOKMUN_PROXY_DEFAULT_ROLE === "RESEARCHER" ? "RESEARCHER" : "GUEST",
    enableDevReset: bool(env.SEOKMUN_ENABLE_DEV_RESET, false),
    sessionTtlHours: Number(env.SEOKMUN_SESSION_TTL_HOURS ?? 24 * 7),
    cookieSecure: bool(env.SEOKMUN_COOKIE_SECURE, nodeEnv === "production"),
    logLevel: env.SEOKMUN_LOG_LEVEL ?? (nodeEnv === "test" ? "silent" : "info"),
    maxUploadBytes: Number(env.SEOKMUN_MAX_UPLOAD_BYTES ?? 8 * 1024 ** 3),
    fullParseMaxBytes: Number(env.SEOKMUN_FULL_PARSE_MAX_BYTES ?? 300 * 1024 ** 2),
    bootstrapAdmin:
      email && password
        ? { email, password, displayName: env.SEOKMUN_BOOTSTRAP_ADMIN_NAME ?? "PI" }
        : null,
    seedDemo: bool(env.SEOKMUN_SEED_DEMO, true),
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

export function isLoopback(hostOrIp: string | undefined): boolean {
  return Boolean(hostOrIp && LOOPBACK.has(hostOrIp));
}

/** 위험한 조합을 기동 시점에 거부한다 */
export function assertSafeConfig(cfg: AppConfig): void {
  if (cfg.authMode === "dev" && !isLoopback(cfg.host) && cfg.host !== "") {
    if (process.env.SEOKMUN_ALLOW_INSECURE_DEV_REMOTE !== "1") {
      throw new Error(
        `SEOKMUN_AUTH_MODE=dev는 인증 없이 PI 권한을 부여하므로 loopback(127.0.0.1)에만 바인딩할 수 있습니다 (현재 host=${cfg.host}).`
      );
    }
  }
  if (cfg.nodeEnv === "production" && cfg.authMode === "dev") {
    throw new Error("운영 환경(NODE_ENV=production)에서는 SEOKMUN_AUTH_MODE=dev를 사용할 수 없습니다.");
  }
  if (cfg.nodeEnv === "production" && cfg.enableDevReset) {
    throw new Error("운영 환경에서는 SEOKMUN_ENABLE_DEV_RESET을 켤 수 없습니다.");
  }
}
