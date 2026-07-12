/* 업그레이드 후(After) 스크린샷 + 성능 계측 — Before와 동일 고정 카메라 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2] || "/home/user/bisuk/docs/3d-upgrade/screenshots/after";
const SET = "early-korean-stelae-comparative";
const BASE = "http://localhost:3100";

const CAMERAS = {
  "front-full": { position: [0, 0, 3.2], target: [0, 0, 0] },
  "front-medium": { position: [0.4, 0.1, 1.8], target: [0, 0.2, 0] },
  "front-glyph-closeup": { position: [0.05, 0.28, 0.75], target: [0.05, 0.28, 0] },
};

async function setUi(page, ui) {
  await page.request.post(`http://localhost:4100/api/stele-tabs/chungju-goguryeobi/ui-state`, {
    data: {
      qualityTier: "BALANCED", lodLevel: "MEDIUM", exposure: 1, aoStrength: 0.6,
      lightAzimuthDeg: 105, lightElevationDeg: 12, renderMode: "ALBEDO",
      representation: "PBR_PRESENTATION", lightingPreset: "MUSEUM_NEUTRAL",
      activeGlyphCellId: null, ...ui,
    },
  });
}

async function sidecar(page, name, meta) {
  const info = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      stats: window.__seokmunStats ?? null,
    };
  });
  fs.writeFileSync(
    path.join(OUT, `${name}.json`),
    JSON.stringify({ name, capturedAt: "2026-07-12", modelVersion: "procedural-demo-A (post-upgrade, seokmun-3d-pipeline-0.2.0)", toneMapping: "ACESFilmic", colorSpace: "sRGB", ...meta, ...info }, null, 2)
  );
}

const SHOTS = [
  ["front-full", { camera: CAMERAS["front-full"] }],
  ["front-medium", { camera: CAMERAS["front-medium"] }],
  ["front-glyph-closeup", { camera: CAMERAS["front-glyph-closeup"], activeGlyphCellId: "demoA-L2-C3", cameraMode: "PERSPECTIVE_MUSEUM", lodLevel: "FULL" }],
  ["raking-light-left", { camera: CAMERAS["front-medium"], lightingPreset: "RAKING", lightAzimuthDeg: 105 }],
  ["raking-light-right", { camera: CAMERAS["front-medium"], lightingPreset: "RAKING", lightAzimuthDeg: 255 }],
  ["normal-view", { camera: CAMERAS["front-medium"], renderMode: "NORMAL" }],
  ["curvature-view", { camera: CAMERAS["front-medium"], renderMode: "CURVATURE" }],
  ["research-lab", { camera: CAMERAS["front-medium"], representation: "RESEARCH_EVIDENCE", lightingPreset: "LABORATORY_NEUTRAL" }],
  ["splat-view", { camera: CAMERAS["front-full"], representation: "SPLAT" }],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.request.post("http://localhost:4100/api/dev/reset");

  const t0 = Date.now();
  await setUi(page, { camera: CAMERAS["front-full"] });
  await page.goto(`${BASE}/sets/${SET}?tab=chungju-goguryeobi`);
  await page.waitForSelector("canvas", { timeout: 30000 });
  const canvasVisibleMs = Date.now() - t0;
  await page.waitForTimeout(2500);

  for (const [name, ui] of SHOTS) {
    await setUi(page, ui);
    await page.reload();
    await page.waitForSelector("canvas", { timeout: 30000 });
    if (ui.representation === "SPLAT") {
      await page.waitForSelector("[data-testid=splat-loaded]", { timeout: 30000 });
    }
    if (ui.activeGlyphCellId) {
      await page.waitForSelector("[data-testid=patch-loaded]", { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(2200);
    const el = await page.$("[data-testid=viewer-3d]");
    await (el || page).screenshot({ path: path.join(OUT, `${name}.png`) });
    await sidecar(page, name, { ui });
  }

  // FPS 근사 (카메라 드래그로 실렌더 유도)
  await setUi(page, { camera: CAMERAS["front-medium"] });
  await page.reload();
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(2000);
  const canvas = await page.$("canvas");
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const tStart = Date.now();
  let steps = 0;
  while (Date.now() - tStart < 3000) {
    await page.mouse.move(cx + Math.sin(steps / 10) * 120, cy + Math.cos(steps / 13) * 60, { steps: 1 });
    steps++;
  }
  await page.mouse.up();
  const stats = await page.evaluate(() => window.__seokmunStats ?? null);

  // multi-tab + mobile
  await page.goto(`${BASE}/sets/${SET}?tab=uljin-bongpyeong-stele`);
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(OUT, "multi-tab-compare.png") });
  await sidecar(page, "multi-tab-compare", { note: "울진(DEMO-B) 탭" });

  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tm0 = Date.now();
  await mp.goto(`${BASE}/sets/${SET}?tab=chungju-goguryeobi`);
  await mp.waitForSelector("canvas", { timeout: 30000 });
  const mobileCanvasMs = Date.now() - tm0;
  await mp.waitForTimeout(2500);
  await mp.screenshot({ path: path.join(OUT, "mobile-portrait.png") });
  await sidecar(mp, "mobile-portrait", { canvasVisibleMs: mobileCanvasMs });

  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({
    desktopCanvasVisibleMs: canvasVisibleMs,
    mobileCanvasVisibleMs: mobileCanvasMs,
    interactionStats: stats,
    note: "SwiftShader 소프트웨어 렌더링 — 실제 GPU FPS 아님. interactionStats.fps = 드래그 중 1초 실렌더 프레임 수.",
  }, null, 2));
  console.log(JSON.stringify({ canvasVisibleMs, mobileCanvasMs, stats }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
