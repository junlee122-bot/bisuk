/* 업그레이드 전(Before) 기준 스크린샷 + 성능 계측 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2] || "/home/user/bisuk/docs/3d-upgrade/screenshots/before";
const SET = "early-korean-stelae-comparative";
const BASE = "http://localhost:3100";

const CAMERAS = {
  "front-full": { position: [0, 0, 3.2], target: [0, 0, 0] },
  "front-medium": { position: [0.4, 0.1, 1.8], target: [0, 0.2, 0] },
  "front-glyph-closeup": { position: [0.05, 0.28, 0.75], target: [0.05, 0.28, 0] },
};

async function setCamera(page, cam, renderMode) {
  await page.request.post(`http://localhost:4100/api/stele-tabs/chungju-goguryeobi/ui-state`, {
    data: { camera: cam, renderMode, activeGlyphCellId: "demoA-L2-C3" },
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
    };
  });
  fs.writeFileSync(
    path.join(OUT, `${name}.json`),
    JSON.stringify({ name, capturedAt: "2026-07-12", modelVersion: "procedural-demo-A (pre-upgrade)", ...meta, ...info }, null, 2)
  );
}

async function measureFps(page, ms = 2500) {
  return page.evaluate(async (dur) => {
    // 카메라를 살짝 계속 움직여 렌더 루프 유도 (frameloop=demand 대비)
    const canvas = document.querySelector("canvas");
    let frames = 0;
    let raf;
    const bump = () => {
      if (canvas) {
        canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
      }
      frames++;
      raf = requestAnimationFrame(bump);
    };
    raf = requestAnimationFrame(bump);
    await new Promise((r) => setTimeout(r, dur));
    cancelAnimationFrame(raf);
    return Math.round((frames / dur) * 1000);
  }, ms);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.request.post("http://localhost:4100/api/dev/reset");

  const t0 = Date.now();
  await setCamera(page, CAMERAS["front-full"], "ALBEDO");
  await page.goto(`${BASE}/sets/${SET}?tab=chungju-goguryeobi`);
  await page.waitForSelector("canvas", { timeout: 30000 });
  const canvasVisibleMs = Date.now() - t0;
  await page.waitForTimeout(2500);

  const shots = [
    ["front-full", CAMERAS["front-full"], "ALBEDO"],
    ["front-medium", CAMERAS["front-medium"], "ALBEDO"],
    ["front-glyph-closeup", CAMERAS["front-glyph-closeup"], "ALBEDO"],
    ["raking-light-left", CAMERAS["front-medium"], "RAKING_LIGHT"],
    ["normal-view", CAMERAS["front-medium"], "NORMAL"],
    ["curvature-view", CAMERAS["front-medium"], "CURVATURE"],
  ];
  for (const [name, cam, mode] of shots) {
    await setCamera(page, cam, mode);
    await page.reload();
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(2200);
    const el = await page.$("[data-testid=viewer-3d]");
    await (el || page).screenshot({ path: path.join(OUT, `${name}.png`) });
    await sidecar(page, name, { camera: cam, renderMode: mode, lighting: mode === "RAKING_LIGHT" ? "directional [4,0.4,0.6] i=2.6 + ambient 0.12" : "ambient 0.55 + dir [2,3,4] i=1.4 + dir [-2,-1,2] i=0.4", toneMapping: "three default (ACES? unset)", exposure: 1 });
  }

  const fps = await measureFps(page);

  // multi-tab compare: 울진 탭
  await page.goto(`${BASE}/sets/${SET}?tab=uljin-bongpyeong-stele`);
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "multi-tab-compare.png") });
  await sidecar(page, "multi-tab-compare", { note: "울진(DEMO-B) 탭 전환 후" });

  // mobile
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tm0 = Date.now();
  await mp.goto(`${BASE}/sets/${SET}?tab=chungju-goguryeobi`);
  await mp.waitForSelector("canvas", { timeout: 30000 });
  const mobileCanvasMs = Date.now() - tm0;
  await mp.waitForTimeout(2500);
  await mp.screenshot({ path: path.join(OUT, "mobile-portrait.png") });
  const mobileFps = await mp.evaluate(async (dur) => {
    let frames = 0;
    const canvas = document.querySelector("canvas");
    let raf;
    const bump = () => { if (canvas) canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })); frames++; raf = requestAnimationFrame(bump); };
    raf = requestAnimationFrame(bump);
    await new Promise((r) => setTimeout(r, dur));
    cancelAnimationFrame(raf);
    return Math.round((frames / dur) * 1000);
  }, 2500);
  await sidecar(mp, "mobile-portrait", { canvasVisibleMs: mobileCanvasMs, fpsApprox: mobileFps });

  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({
    desktopCanvasVisibleMs: canvasVisibleMs,
    desktopFpsApprox: fps,
    mobileCanvasVisibleMs: mobileCanvasMs,
    mobileFpsApprox: mobileFps,
    note: "SwiftShader 소프트웨어 렌더링 기준 — 실제 GPU FPS 아님. rAF 유도 방식 근사치.",
  }, null, 2));

  console.log(JSON.stringify({ canvasVisibleMs, fps, mobileCanvasMs, mobileFps }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
