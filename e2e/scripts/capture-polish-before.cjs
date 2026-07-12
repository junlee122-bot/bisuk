/* 포트폴리오 폴리시(시각 개편) BEFORE 기준 캡처.
 * AFTER 캡처(capture-polish-after.cjs)와 동일 카메라·동일 모델·동일 뷰포트를 사용해야 한다. */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2] || "/home/user/bisuk/docs/portfolio-polish/screenshots/before";
const SET = "early-korean-stelae-comparative";
const WEB = "http://localhost:3100";
const API = "http://localhost:4100";

const CAM_DEFAULT = { position: [0.85, 0.1, 4.0], target: [0, 0, 0] };
const CAM_MACRO = { position: [0.05, 0.28, 0.75], target: [0.05, 0.28, 0] };

const BASE_UI = {
  qualityTier: "BALANCED",
  lodLevel: "MEDIUM",
  exposure: 1,
  aoStrength: 0.6,
  lightAzimuthDeg: 105,
  lightElevationDeg: 12,
  renderMode: "ALBEDO",
  representation: "PBR_PRESENTATION",
  lightingPreset: "MUSEUM_NEUTRAL",
  activeGlyphCellId: null,
  camera: CAM_DEFAULT,
};

async function setUi(page, ui) {
  await page.request.post(`${API}/api/stele-tabs/chungju-goguryeobi/ui-state`, {
    data: { ...BASE_UI, ...ui },
  });
}

async function sidecar(page, name, meta) {
  const info = await page.evaluate(() => ({
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    stats: window.__seokmunStats ?? null,
  }));
  fs.writeFileSync(
    path.join(OUT, `${name}.json`),
    JSON.stringify(
      {
        name,
        phase: "BEFORE (다크 테마 · 포트폴리오 폴리시 이전)",
        capturedAt: "2026-07-12",
        model: "procedural-demo (VIRTUAL_DEMO, seokmun-3d-pipeline-0.2.0)",
        ...meta,
        ...info,
      },
      null,
      2
    )
  );
}

async function shot(browser, name, { viewport, url, ui, waitFor, isMobile }) {
  const page = await browser.newPage({
    viewport,
    ...(isMobile ? { isMobile: true, hasTouch: true } : {}),
  });
  if (ui !== undefined) await setUi(page, ui);
  await page.goto(url);
  for (const sel of waitFor ?? ["canvas"]) {
    await page.waitForSelector(sel, { timeout: 30000 }).catch(() => {});
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await sidecar(page, name, { url, viewport, ui: ui ?? null });
  await page.close();
  console.log(`captured ${name}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const warm = await browser.newPage();
  await warm.request.post(`${API}/api/dev/reset`);
  // 라우트 웜업 (서버 콜드 스타트 시간이 캡처에 섞이지 않도록)
  for (const u of [`${WEB}/sets/${SET}?tab=chungju-goguryeobi`, `${WEB}/sets/${SET}/compare`]) {
    await warm.goto(u).catch(() => {});
  }
  await warm.close();

  const WS = `${WEB}/sets/${SET}?tab=chungju-goguryeobi`;

  await shot(browser, "BEFORE_WORKSPACE_DEFAULT", {
    viewport: { width: 1440, height: 900 },
    url: WS,
    ui: {},
  });
  await shot(browser, "BEFORE_WORKSPACE_DEFAULT_1920", {
    viewport: { width: 1920, height: 1080 },
    url: WS,
    ui: {},
  });
  await shot(browser, "BEFORE_WORKSPACE_MACRO", {
    viewport: { width: 1440, height: 900 },
    url: WS,
    ui: { camera: CAM_MACRO, activeGlyphCellId: "demoA-L2-C3", lodLevel: "FULL" },
    waitFor: ["canvas", "[data-testid=patch-loaded]"],
  });
  // Glyph Matrix — 비교 트레이를 실제 UI 플로우로 채운 뒤 캡처
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await setUi(page, {});
    await page.goto(WS);
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("add-to-compare").click();
    await page.getByTestId("compare-tab-check-chungju-goguryeobi").check();
    await page.getByTestId("compare-tab-check-uljin-bongpyeong-stele").check();
    await page.getByTestId("compare-tab-check-gwanggaeto-stele").check();
    await page.getByTestId("open-glyph-matrix").click();
    await page.waitForSelector("[data-testid=glyph-matrix]", { timeout: 30000 });
    await page.getByTestId("row-analyze-demoA-L2-C3").click();
    await page
      .waitForSelector("[data-testid=row-candidates-demoA-L2-C3]", { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, "BEFORE_GLYPH_MATRIX.png") });
    await sidecar(page, "BEFORE_GLYPH_MATRIX", {
      url: `${WEB}/sets/${SET}/compare`,
      viewport: { width: 1440, height: 900 },
      note: "demoA-L2-C3 + 3개 탭 비교, 행 분석 실행 후",
    });
    await page.close();
    console.log("captured BEFORE_GLYPH_MATRIX");
  }
  await shot(browser, "BEFORE_SURFACE_COMPARE", {
    viewport: { width: 1440, height: 900 },
    url: `${WEB}/sets/${SET}/surface-compare?cells=demoA-L2-C3,demoB-L1-C1`,
    waitFor: ["canvas"],
  });
  await shot(browser, "BEFORE_MOBILE", {
    viewport: { width: 390, height: 844 },
    url: WS,
    ui: {},
    isMobile: true,
  });
  await shot(browser, "BEFORE_TABLET", {
    viewport: { width: 768, height: 1024 },
    url: WS,
    ui: {},
    isMobile: true,
  });

  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
