import { expect, resetDb, SET_URL, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 시각 회귀 — 고정 카메라·조명 스크린샷을 커밋된 기준과 비교.
 * SwiftShader 렌더링은 결정적이나 AA 미세 차이를 고려해 완충 threshold 적용.
 * 기준 갱신: pnpm exec playwright test tests/visual.spec.ts --update-snapshots
 */
const SHOT_OPTS = { maxDiffPixelRatio: 0.03, timeout: 20_000 } as const;

async function fixedScene(
  page: Page,
  ui: Record<string, unknown>
): Promise<void> {
  await page.request.post(
    "http://localhost:4100/api/stele-tabs/chungju-goguryeobi/ui-state",
    {
      data: {
        camera: { position: [0.85, 0.1, 4.0], target: [0, 0, 0] },
        activeGlyphCellId: null,
        qualityTier: "BALANCED",
        lodLevel: "MEDIUM",
        exposure: 1,
        aoStrength: 0.6,
        lightAzimuthDeg: 105,
        lightElevationDeg: 12,
        ...ui,
      },
    }
  );
  await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
  await page.waitForTimeout(2500);
}

test.describe("시각 회귀 (고정 카메라)", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("mesh PBR — Museum Neutral", async ({ page }) => {
    await fixedScene(page, {
      representation: "PBR_PRESENTATION",
      lightingPreset: "MUSEUM_NEUTRAL",
      renderMode: "ALBEDO",
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("pbr-museum.png", SHOT_OPTS);
  });

  test("mesh 연구형 — Laboratory Neutral", async ({ page }) => {
    await fixedScene(page, {
      representation: "RESEARCH_EVIDENCE",
      lightingPreset: "LABORATORY_NEUTRAL",
      renderMode: "ALBEDO",
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("research-lab.png", SHOT_OPTS);
  });

  test("raking light (사광 105°/12°)", async ({ page }) => {
    await fixedScene(page, {
      representation: "PBR_PRESENTATION",
      lightingPreset: "RAKING",
      renderMode: "ALBEDO",
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("raking.png", SHOT_OPTS);
  });

  test("normal 분석 모드", async ({ page }) => {
    await fixedScene(page, { renderMode: "NORMAL" });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("normal.png", SHOT_OPTS);
  });

  test("curvature 분석 모드", async ({ page }) => {
    await fixedScene(page, { renderMode: "CURVATURE" });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("curvature.png", SHOT_OPTS);
  });
});
