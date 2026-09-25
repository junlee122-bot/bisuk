import { loadConfig } from "./config";
import { buildServer } from "./server";

// --dev: 개발·E2E용 (인증 생략 + 초기화 허용). OS와 무관하게 동작하도록 환경 변수 대신 플래그로 받는다
const devFlag = process.argv.includes("--dev");
const base = loadConfig();
const cfg = devFlag
  ? {
      ...base,
      authMode: "dev" as const,
      enableDevReset: base.nodeEnv !== "production",
      host: process.env.SEOKMUN_HOST ?? "127.0.0.1",
    }
  : base;
const app = buildServer(cfg);

app
  .listen({ port: cfg.port, host: cfg.host })
  .then((address) => {
    app.log.info(
      { address, authMode: cfg.authMode, dataDir: cfg.dataDir, devReset: cfg.enableDevReset },
      "seokmun-api listening"
    );
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

// 종료 신호 — 진행 중 요청을 마치고 DB를 닫는다
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}
