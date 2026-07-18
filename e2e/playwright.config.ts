import { defineConfig, devices } from "@playwright/test";

function envPort(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

const WEB_PORT = envPort("E2E_WEB_PORT", 3100);
const API_PORT = envPort("E2E_API_PORT", 4100);
// API 기본 바인딩과 일치시켜 Windows의 localhost -> ::1 해석 차이를 피한다.
const LOOPBACK_HOST = "127.0.0.1";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://${LOOPBACK_HOST}:${WEB_PORT}`,
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
      command: "corepack pnpm --filter @seokmun/api start",
      url: `http://${LOOPBACK_HOST}:${API_PORT}/api/health`,
      reuseExistingServer: true,
      cwd: "..",
      timeout: 60_000,
      env: {
        ENABLE_DEV_RESET: "true",
        NODE_ENV: "test",
      },
    },
    {
      command: `corepack pnpm --filter @seokmun/web exec next start -p ${WEB_PORT}`,
      url: `http://${LOOPBACK_HOST}:${WEB_PORT}`,
      reuseExistingServer: true,
      cwd: "..",
      timeout: 120_000,
    },
  ],
});
