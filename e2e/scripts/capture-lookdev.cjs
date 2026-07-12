/* 톤매핑 A/B + 전시 무대 룩 개발 캡처 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const OUT = "/home/user/bisuk/docs/portfolio-polish/screenshots/lookdev";
const SET = "early-korean-stelae-comparative";
const WEB = "http://localhost:3100";
const API = "http://localhost:4100";
const HERO = { position: [1.5, -0.12, 3.62], target: [0, 0.05, 0] };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.request.post(`${API}/api/dev/reset`);
  await page.request.post(`${API}/api/stele-tabs/chungju-goguryeobi/ui-state`, {
    data: {
      qualityTier: "BALANCED", lodLevel: "MEDIUM", exposure: 1, aoStrength: 0.6,
      lightAzimuthDeg: 105, lightElevationDeg: 12, renderMode: "ALBEDO",
      representation: "PBR_PRESENTATION", lightingPreset: "MUSEUM_NEUTRAL",
      activeGlyphCellId: null, camera: HERO,
    },
  });

  for (const tm of ["ACES", "AGX", "NEUTRAL"]) {
    await page.goto(`${WEB}/sets/${SET}?tab=chungju-goguryeobi&toneMapping=${tm}`);
    await page.waitForSelector("canvas", { timeout: 30000 });
    // 전시 보기 전환 (무대 소품 포함 상태로 비교)
    await page.getByTestId("mode-toggle-exhibition").click();
    await page.waitForTimeout(2500);
    const stage = await page.$("[data-testid=stele-stage]");
    await stage.screenshot({ path: path.join(OUT, `tonemap-${tm}-museum-hero.png`) });
    console.log(`captured tonemap-${tm}`);
  }

  // 연구 보기 중립 무대 확인 샷
  await page.goto(`${WEB}/sets/${SET}?tab=chungju-goguryeobi`);
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(2200);
  const stage = await page.$("[data-testid=stele-stage]");
  await stage.screenshot({ path: path.join(OUT, "research-neutral-stage.png") });
  console.log("captured research stage");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
