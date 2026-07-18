import { API_URL, expect, resetDb, SET_URL, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 시각 회귀 — 고정 카메라·조명·fixture 스크린샷을 커밋된 기준과 비교 (스펙 §16.5).
 * SwiftShader 렌더링은 결정적이나 AA 미세 차이를 고려해 완충 threshold 적용.
 * 검은 전체 배경이 다시 생기면 기준 대비 diff로 실패한다 (+polish.spec의 명시적 밝기 게이트).
 * 기준 갱신: pnpm exec playwright test tests/visual.spec.ts --update-snapshots
 */
const SHOT_OPTS = { maxDiffPixelRatio: 0.03, timeout: 20_000 } as const;
const SHOWCASE_URL = "/showcase/early-korean-stelae-comparative";
const HERO_CAM = { position: [1.7, -0.12, 4.55], target: [0, 0.05, 0] };

async function setUi(page: Page, ui: Record<string, unknown>): Promise<void> {
  await page.request.post(
    `${API_URL}/api/stele-tabs/chungju-goguryeobi/ui-state`,
    {
      data: {
        camera: HERO_CAM,
        activeGlyphCellId: null,
        qualityTier: "BALANCED",
        lodLevel: "MEDIUM",
        exposure: 1,
        aoStrength: 0.6,
        lightAzimuthDeg: 105,
        lightElevationDeg: 12,
        renderMode: "ALBEDO",
        representation: "PBR_PRESENTATION",
        lightingPreset: "MUSEUM_NEUTRAL",
        cameraMode: "PERSPECTIVE_MUSEUM",
        ...ui,
      },
    }
  );
}

async function openWorkspace(page: Page, ui: Record<string, unknown> = {}): Promise<void> {
  await setUi(page, ui);
  await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
  await page.waitForTimeout(2500);
}

test.describe("시각 회귀 (고정 카메라)", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  // ── 기존 5종 (라이트 테마 기준으로 재생성) ──
  test("mesh PBR — Museum Neutral", async ({ page }) => {
    await openWorkspace(page, {
      camera: { position: [0.85, 0.1, 4.0], target: [0, 0, 0] },
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("pbr-museum.png", SHOT_OPTS);
  });

  test("mesh 연구형 — Laboratory Neutral", async ({ page }) => {
    await openWorkspace(page, {
      camera: { position: [0.85, 0.1, 4.0], target: [0, 0, 0] },
      representation: "RESEARCH_EVIDENCE",
      lightingPreset: "LABORATORY_NEUTRAL",
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("research-lab.png", SHOT_OPTS);
  });

  test("raking light (사광 105°/12°)", async ({ page }) => {
    await openWorkspace(page, {
      camera: { position: [0.85, 0.1, 4.0], target: [0, 0, 0] },
      lightingPreset: "RAKING",
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("raking.png", SHOT_OPTS);
  });

  test("normal 분석 모드", async ({ page }) => {
    await openWorkspace(page, {
      camera: { position: [0.85, 0.1, 4.0], target: [0, 0, 0] },
      renderMode: "NORMAL",
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("normal.png", SHOT_OPTS);
  });

  test("curvature 분석 모드", async ({ page }) => {
    await openWorkspace(page, {
      camera: { position: [0.85, 0.1, 4.0], target: [0, 0, 0] },
      renderMode: "CURVATURE",
    });
    await expect(page.getByTestId("viewer-3d")).toHaveScreenshot("curvature.png", SHOT_OPTS);
  });

  // ── 신규: 라이트 워크스페이스 레이아웃 ──
  test("workspace-light-1440", async ({ page }) => {
    await openWorkspace(page);
    await expect(page).toHaveScreenshot("workspace-light-1440.png", SHOT_OPTS);
  });

  test("workspace-light-1920", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openWorkspace(page);
    await expect(page).toHaveScreenshot("workspace-light-1920.png", SHOT_OPTS);
  });

  test("workspace-macro (글자 포커스 + FULL LOD)", async ({ page }) => {
    await openWorkspace(page, {
      camera: { position: [0.05, 0.28, 0.75], target: [0.05, 0.28, 0] },
      activeGlyphCellId: "demoA-L2-C3",
      lodLevel: "FULL",
    });
    await page
      .waitForSelector("[data-testid=patch-loaded]", { timeout: 30_000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("stele-stage")).toHaveScreenshot(
      "workspace-macro.png",
      SHOT_OPTS
    );
  });

  test("workspace-research-neutral (연구 보기 중립 무대)", async ({ page }) => {
    await openWorkspace(page, {
      representation: "RESEARCH_EVIDENCE",
      lightingPreset: "LABORATORY_NEUTRAL",
    });
    await expect(page.getByTestId("stele-stage")).toHaveScreenshot(
      "workspace-research-neutral.png",
      SHOT_OPTS
    );
  });

  // ── 신규: 쇼케이스 ──
  test("showcase-hero", async ({ page }) => {
    await setUi(page, {});
    await page.goto(`${SHOWCASE_URL}?chapter=1`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot("showcase-hero.png", SHOT_OPTS);
  });

  test("showcase-surface-chapter", async ({ page }) => {
    await setUi(page, {});
    await page.goto(`${SHOWCASE_URL}?chapter=2`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.waitForTimeout(3200);
    await expect(page.getByTestId("chapter-panel")).toHaveScreenshot(
      "showcase-surface-chapter.png",
      SHOT_OPTS
    );
  });

  // ── 신규: 비교·근거 화면 ──
  test("glyph-matrix", async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("add-to-compare").click();
    await page.getByTestId("compare-tab-check-chungju-goguryeobi").check();
    await page.getByTestId("compare-tab-check-uljin-bongpyeong-stele").check();
    await page.getByTestId("compare-tab-check-gwanggaeto-stele").check();
    await page.getByTestId("open-glyph-matrix").click();
    await expect(page.getByTestId("glyph-matrix")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await expect(page.getByTestId("glyph-matrix")).toHaveScreenshot(
      "glyph-matrix.png",
      SHOT_OPTS
    );
  });

  test("surface-compare", async ({ page }) => {
    await page.goto(`${SET_URL}/surface-compare?cells=demoA-L2-C3,demoB-L1-C1`);
    await expect(page.locator("canvas")).toHaveCount(2, { timeout: 30_000 });
    await page.waitForTimeout(2500);
    await expect(page).toHaveScreenshot("surface-compare.png", SHOT_OPTS);
  });

  test("evidence-dossier", async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("decision-outcome")).toHaveText("AUTO_ACCEPTED", {
      timeout: 20_000,
    });
    await page.getByTestId("open-dossier").click();
    await expect(page.getByTestId("dossier-modal")).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByTestId("dossier-modal")).toHaveScreenshot(
      "evidence-dossier.png",
      SHOT_OPTS
    );
  });

  // ── 신규: 모바일 뷰포트 ──
  test("mobile-workspace", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page);
    await expect(page).toHaveScreenshot("mobile-workspace.png", SHOT_OPTS);
  });

  test("mobile-showcase", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setUi(page, {});
    await page.goto(`${SHOWCASE_URL}?chapter=1`);
    await expect(page.getByTestId("showcase-hero")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot("mobile-showcase.png", SHOT_OPTS);
  });

  // ── 신규: reduced motion ──
  test("reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkspace(page);
    await expect(page).toHaveScreenshot("reduced-motion.png", SHOT_OPTS);
  });
});
