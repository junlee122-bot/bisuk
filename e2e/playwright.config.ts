import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3100;
const API_PORT = 4100;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      // 컨테이너에는 Chromium만 설치되어 있어 iPhone 13 뷰포트를 Chromium으로 구동한다
      use: { ...devices["iPhone 13"], browserName: "chromium" },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // --dev: 개발 인증 + 초기화 허용. 데이터는 E2E 전용 디렉터리 (연구 데이터와 분리)
      command: "pnpm --filter @seokmun/api start:dev",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: true,
      cwd: "..",
      timeout: 60_000,
      env: { SEOKMUN_DATA_DIR: path.resolve(import.meta.dirname, ".e2e-data") },
    },
    {
      command: "pnpm --filter @seokmun/web start",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: true,
      cwd: "..",
      timeout: 120_000,
    },
  ],
});
