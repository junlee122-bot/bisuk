/* 포트폴리오 폴리시 AFTER 캡처 — BEFORE(capture-polish-before.cjs)와 동일
 * 카메라·뷰포트 + Appendix B 포트폴리오 캡처 팩 12장 (+sidecar JSON) */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const AFTER = "/home/user/bisuk/docs/portfolio-polish/screenshots/after";
const PACK = "/home/user/bisuk/docs/portfolio-polish/screenshots/portfolio-pack";
const BEFORE = "/home/user/bisuk/docs/portfolio-polish/screenshots/before";
const SET = "early-korean-stelae-comparative";
const WEB = "http://localhost:3100";
const API = "http://localhost:4100";
const WS = `${WEB}/sets/${SET}?tab=chungju-goguryeobi`;

const CAM_DEFAULT = { position: [0.85, 0.1, 4.0], target: [0, 0, 0] };
const CAM_HERO = { position: [1.7, -0.12, 4.55], target: [0, 0.05, 0] };
const CAM_MACRO = { position: [0.05, 0.28, 0.75], target: [0.05, 0.28, 0] };
const CAM_MEDIUM = { position: [0.4, 0.1, 1.8], target: [0, 0.2, 0] };

const BASE_UI = {
  qualityTier: "BALANCED", lodLevel: "MEDIUM", exposure: 1, aoStrength: 0.6,
  lightAzimuthDeg: 105, lightElevationDeg: 12, renderMode: "ALBEDO",
  representation: "PBR_PRESENTATION", lightingPreset: "MUSEUM_NEUTRAL",
  activeGlyphCellId: null, cameraMode: "PERSPECTIVE_MUSEUM", camera: CAM_DEFAULT,
};

async function setUi(page, ui) {
  await page.request.post(`${API}/api/stele-tabs/chungju-goguryeobi/ui-state`, {
    data: { ...BASE_UI, ...ui },
  });
}

function sidecar(dir, name, meta) {
  fs.writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify(
      {
        researchSetId: SET,
        steleId: "chungju-goguryeobi",
        assetVariantId: "asset-demo-a (VIRTUAL_DEMO)",
        sceneLookId: null,
        cameraBookmarkId: null,
        selectedGlyphId: null,
        measurementAllowed: false,
        createdAt: new Date().toISOString(),
        phase: "AFTER (CONTEMPORARY MUSEUM ARCHIVE)",
        ...meta,
      },
      null,
      2
    )
  );
}

async function newPage(browser, w, h, mobile = false) {
  return browser.newPage({
    viewport: { width: w, height: h },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
}

async function waitCanvas(page, count = 1) {
  await page.waitForFunction((c) => document.querySelectorAll("canvas").length >= c, count, {
    timeout: 30000,
  });
  await page.waitForTimeout(2500);
}

(async () => {
  fs.mkdirSync(AFTER, { recursive: true });
  fs.mkdirSync(PACK, { recursive: true });
  const browser = await chromium.launch();
  const warm = await browser.newPage();
  await warm.request.post(`${API}/api/dev/reset`);
  for (const u of [WS, `${WEB}/showcase/${SET}`]) await warm.goto(u).catch(() => {});
  await warm.close();

  // ── AFTER 7장 (BEFORE와 동일 조건) ──
  const afterShots = [
    ["AFTER_WORKSPACE_DEFAULT", 1440, 900, WS, {}, false],
    ["AFTER_WORKSPACE_DEFAULT_1920", 1920, 1080, WS, {}, false],
    ["AFTER_WORKSPACE_MACRO", 1440, 900, WS, { camera: CAM_MACRO, activeGlyphCellId: "demoA-L2-C3", lodLevel: "FULL" }, false],
    ["AFTER_SURFACE_COMPARE", 1440, 900, `${WEB}/sets/${SET}/surface-compare?cells=demoA-L2-C3,demoB-L1-C1`, null, false],
    ["AFTER_MOBILE", 390, 844, WS, {}, true],
    ["AFTER_TABLET", 768, 1024, WS, {}, true],
  ];
  for (const [name, w, h, url, ui, mobile] of afterShots) {
    const page = await newPage(browser, w, h, mobile);
    if (ui) await setUi(page, ui);
    await page.goto(url);
    await waitCanvas(page, url.includes("surface-compare") ? 2 : 1);
    if (ui && ui.activeGlyphCellId) {
      await page.waitForSelector("[data-testid=patch-loaded]", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: path.join(AFTER, `${name}.png`) });
    sidecar(AFTER, name, { viewport: { width: w, height: h, dpr: 1 }, url });
    await page.close();
    console.log("captured", name);
  }

  // AFTER_GLYPH_MATRIX — BEFORE와 동일 UI 플로우
  {
    const page = await newPage(browser, 1440, 900);
    await setUi(page, {});
    await page.goto(WS);
    await waitCanvas(page);
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("add-to-compare").click();
    await page.getByTestId("compare-tab-check-chungju-goguryeobi").check();
    await page.getByTestId("compare-tab-check-uljin-bongpyeong-stele").check();
    await page.getByTestId("compare-tab-check-gwanggaeto-stele").check();
    await page.getByTestId("open-glyph-matrix").click();
    await page.waitForSelector("[data-testid=glyph-matrix]", { timeout: 30000 });
    await page.getByTestId("row-analyze-demoA-L2-C3").click();
    await page.waitForSelector("[data-testid=row-candidates-demoA-L2-C3]", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(AFTER, "AFTER_GLYPH_MATRIX.png") });
    sidecar(AFTER, "AFTER_GLYPH_MATRIX", { viewport: { width: 1440, height: 900, dpr: 1 } });
    await page.close();
    console.log("captured AFTER_GLYPH_MATRIX");
  }

  await warmReset();
  async function warmReset() {
    const p = await browser.newPage();
    await p.request.post(`${API}/api/dev/reset`);
    await p.close();
  }

  // ── Appendix B 포트폴리오 캡처 팩 12장 ──
  // 01 showcase hero 1920
  {
    const page = await newPage(browser, 1920, 1080);
    await setUi(page, { camera: CAM_HERO });
    await page.goto(`${WEB}/showcase/${SET}?chapter=1`);
    await waitCanvas(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(PACK, "01_showcase_hero_1920x1080.png") });
    sidecar(PACK, "01_showcase_hero_1920x1080", {
      viewport: { width: 1920, height: 1080, dpr: 1 },
      sceneLookId: "look-portfolio-hero",
      cameraBookmarkId: "HERO_THREE_QUARTER",
    });
    await page.close();
    console.log("captured 01");
  }
  // 02 workspace overview 1920
  {
    const page = await newPage(browser, 1920, 1080);
    await setUi(page, { camera: CAM_HERO });
    await page.goto(WS);
    await waitCanvas(page);
    await page.screenshot({ path: path.join(PACK, "02_workspace_overview_1920x1080.png") });
    sidecar(PACK, "02_workspace_overview_1920x1080", {
      viewport: { width: 1920, height: 1080, dpr: 1 },
      cameraBookmarkId: "HERO_THREE_QUARTER",
    });
    await page.close();
    console.log("captured 02");
  }
  // 03 raking detail 1920
  {
    const page = await newPage(browser, 1920, 1080);
    await setUi(page, { camera: CAM_MEDIUM, lightingPreset: "RAKING" });
    await page.goto(WS);
    await waitCanvas(page);
    const stage = await page.$("[data-testid=stele-stage]");
    await stage.screenshot({ path: path.join(PACK, "03_raking_light_detail_1920x1080.png") });
    sidecar(PACK, "03_raking_light_detail_1920x1080", {
      viewport: { width: 1920, height: 1080, dpr: 1 },
      sceneLookId: "look-raking-east",
    });
    await page.close();
    console.log("captured 03");
  }
  // 04 glyph magnifier 1440
  {
    const page = await newPage(browser, 1440, 900);
    await setUi(page, { camera: CAM_MEDIUM, activeGlyphCellId: "demoA-L2-C3", lodLevel: "FULL" });
    await page.goto(WS);
    await waitCanvas(page);
    await page.keyboard.press("m");
    await page.getByTestId("magnifier-zoom").click(); // 4×
    const stage = await page.$("[data-testid=stele-stage]");
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.45);
    await page.waitForTimeout(1200);
    await stage.screenshot({ path: path.join(PACK, "04_glyph_magnifier_1440x900.png") });
    sidecar(PACK, "04_glyph_magnifier_1440x900", {
      viewport: { width: 1440, height: 900, dpr: 1 },
      selectedGlyphId: "demoA-L2-C3",
      note: "확대경 4× — Evidence Mesh 기준",
    });
    await page.close();
    console.log("captured 04");
  }
  // 05 glyph matrix (AFTER본 재사용 촬영)
  {
    const page = await newPage(browser, 1440, 900);
    await setUi(page, {});
    await page.goto(WS);
    await waitCanvas(page);
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("add-to-compare").click();
    await page.getByTestId("compare-tab-check-chungju-goguryeobi").check();
    await page.getByTestId("compare-tab-check-uljin-bongpyeong-stele").check();
    await page.getByTestId("compare-tab-check-gwanggaeto-stele").check();
    await page.getByTestId("open-glyph-matrix").click();
    await page.waitForSelector("[data-testid=glyph-matrix]", { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(PACK, "05_glyph_matrix_1440x900.png") });
    sidecar(PACK, "05_glyph_matrix_1440x900", { viewport: { width: 1440, height: 900, dpr: 1 }, selectedGlyphId: "demoA-L2-C3" });
    await page.close();
    console.log("captured 05");
  }
  // 06 surface compare
  {
    const page = await newPage(browser, 1440, 900);
    await page.goto(`${WEB}/sets/${SET}/surface-compare?cells=demoA-L2-C3,demoB-L1-C1`);
    await waitCanvas(page, 2);
    await page.screenshot({ path: path.join(PACK, "06_surface_compare_1440x900.png") });
    sidecar(PACK, "06_surface_compare_1440x900", { viewport: { width: 1440, height: 900, dpr: 1 }, selectedGlyphId: "demoA-L2-C3" });
    await page.close();
    console.log("captured 06");
  }
  // 07 evidence dossier
  {
    const page = await newPage(browser, 1440, 900);
    await setUi(page, {});
    await page.goto(WS);
    await waitCanvas(page);
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("analyze-button").click();
    await page.waitForSelector("[data-testid=decision-outcome]", { timeout: 20000 });
    await page.getByTestId("open-dossier").click();
    await page.waitForSelector("[data-testid=dossier-modal]", { timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(PACK, "07_evidence_dossier_1440x900.png") });
    sidecar(PACK, "07_evidence_dossier_1440x900", { viewport: { width: 1440, height: 900, dpr: 1 }, selectedGlyphId: "demoA-L2-C3" });
    await page.close();
    console.log("captured 07");
  }
  // 08 asset lineage (3D 품질 패널 — variants·LOD 오차)
  {
    const page = await newPage(browser, 1440, 900);
    await page.request.post(`${API}/api/3d/assets/asset-demo-a/upgrade`);
    await setUi(page, {});
    await page.goto(WS);
    await waitCanvas(page);
    await page.getByTestId("quality-panel-toggle").click();
    await page.waitForSelector("[data-testid=qp-variants]", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(PACK, "08_asset_lineage_1440x900.png") });
    sidecar(PACK, "08_asset_lineage_1440x900", {
      viewport: { width: 1440, height: 900, dpr: 1 },
      note: "파생 variant 계보 + LOD 오차 P95 (원본 불변)",
    });
    await page.close();
    console.log("captured 08");
  }
  // 09/10 mobile
  for (const [name, url] of [
    ["09_mobile_workspace_390x844", WS],
    ["10_mobile_showcase_390x844", `${WEB}/showcase/${SET}?chapter=1`],
  ]) {
    const page = await newPage(browser, 390, 844, true);
    await setUi(page, {});
    await page.goto(url);
    await waitCanvas(page);
    await page.screenshot({ path: path.join(PACK, `${name}.png`) });
    sidecar(PACK, name, { viewport: { width: 390, height: 844, dpr: 1 }, url });
    await page.close();
    console.log("captured", name);
  }
  // 11 before/after split 1920
  {
    const page = await newPage(browser, 1920, 1080);
    const b64 = (f) => fs.readFileSync(f).toString("base64");
    const before = b64(path.join(BEFORE, "BEFORE_WORKSPACE_DEFAULT.png"));
    const after = b64(path.join(AFTER, "AFTER_WORKSPACE_DEFAULT.png"));
    await page.setContent(`
      <body style="margin:0;background:#f3f0e9;font-family:sans-serif">
        <div style="display:flex;height:1040px">
          <figure style="flex:1;margin:8px"><figcaption style="font-size:14px;padding:4px">BEFORE — 다크 연구 도구</figcaption>
            <img src="data:image/png;base64,${before}" style="width:100%"/></figure>
          <figure style="flex:1;margin:8px"><figcaption style="font-size:14px;padding:4px">AFTER — CONTEMPORARY MUSEUM ARCHIVE</figcaption>
            <img src="data:image/png;base64,${after}" style="width:100%"/></figure>
        </div>
      </body>`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(PACK, "11_before_after_split_1920x1080.png") });
    sidecar(PACK, "11_before_after_split_1920x1080", {
      viewport: { width: 1920, height: 1080, dpr: 1 },
      note: "동일 카메라·뷰포트 BEFORE/AFTER 합성",
    });
    await page.close();
    console.log("captured 11");
  }
  // 12 research neutral 1920
  {
    const page = await newPage(browser, 1920, 1080);
    await setUi(page, {
      camera: CAM_HERO,
      representation: "RESEARCH_EVIDENCE",
      lightingPreset: "LABORATORY_NEUTRAL",
    });
    await page.goto(WS);
    await waitCanvas(page);
    await page.screenshot({ path: path.join(PACK, "12_research_neutral_1920x1080.png") });
    sidecar(PACK, "12_research_neutral_1920x1080", {
      viewport: { width: 1920, height: 1080, dpr: 1 },
      sceneLookId: "look-lab-neutral",
      measurementAllowed: true,
    });
    await page.close();
    console.log("captured 12");
  }

  await browser.close();
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
