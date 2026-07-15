import { API_URL, expect, resetDb, SET_URL, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** 포트폴리오 폴리시 검증 — 스펙 §16.4 신규 E2E */

const SHOWCASE_URL = "/showcase/early-korean-stelae-comparative";

function luminance(rgb: string): number {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return -1;
  return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
}

async function getUiState(page: Page) {
  const res = await page.request.get(`${API_URL}/api/stele-tabs/chungju-goguryeobi`);
  return (await res.json()).tab.uiState;
}

test.describe("폴리시 1–2 — 밝은 배경 강제", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("기본 페이지 배경은 검은색이 아니다 (대시보드·쇼케이스)", async ({ page }) => {
    for (const url of ["/", SHOWCASE_URL]) {
      await page.goto(url);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(luminance(bg), `${url} 배경 ${bg}`).toBeGreaterThan(0.7);
    }
  });

  test("워크스페이스 첫 진입: 밝은 무대 + 다크 캔버스 배경 없음", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    const stageBg = await page
      .getByTestId("stele-stage")
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    // 그라데이션의 모든 색 정지점이 밝아야 한다 (사광 프리셋 아님 기준)
    const stops = stageBg.match(/rgba?\([^)]+\)/g) ?? [];
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(luminance(stop), `무대 색 ${stop}`).toBeGreaterThan(0.7);
    }
    // 캔버스 자체는 투명 — scene.background 없음
    const cleared = await page.evaluate(() => {
      const c = document.querySelector("[data-testid=stele-stage] canvas");
      return c ? getComputedStyle(c).backgroundColor : null;
    });
    expect(cleared === "rgba(0, 0, 0, 0)" || cleared === "transparent").toBe(true);
  });
});

test.describe("폴리시 3 — 모드 전환 상태 보존", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("전시↔연구 전환에도 선택 글자·카메라·탭이 유지된다", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await expect(page.getByTestId("evidence-panel")).toContainText("demoA-L2-C3");
    await page.waitForTimeout(600);
    const before = await getUiState(page);

    await page.getByTestId("mode-toggle-exhibition").click();
    await expect(page.getByTestId("exhibition-toolbar")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(1);
    await page.getByTestId("mode-toggle-research").click();
    await expect(page.getByTestId("exhibition-toolbar")).toHaveCount(0);

    // 선택 유지 + 카메라·활성 셀 서버 상태 불변 + 같은 탭
    await expect(page.getByTestId("evidence-panel")).toContainText("demoA-L2-C3");
    const after = await getUiState(page);
    expect(after.activeGlyphCellId).toBe(before.activeGlyphCellId);
    expect(after.camera).toEqual(before.camera);
    expect(page.url()).toContain("tab=chungju-goguryeobi");
  });
});

test.describe("폴리시 4–5 — 카메라 북마크", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("북마크 전환이 500–900ms 감속으로 카메라를 이동·저장한다", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("bookmark-FRONT_INSCRIPTION").click();
    await expect
      .poll(async () => (await getUiState(page)).camera?.position?.[2] ?? 0, {
        timeout: 5_000,
      })
      .toBeGreaterThan(4.0);
    const cam = (await getUiState(page)).camera;
    expect(Math.abs(cam.position[0])).toBeLessThan(0.05);
    expect(Math.abs(cam.target[0])).toBeLessThan(0.05);
  });

  test("전환 중 사용자 드래그가 자동 카메라를 즉시 중단시킨다", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    const canvas = page.locator("[data-testid=stele-stage] canvas");
    const box = (await canvas.boundingBox())!;
    await page.getByTestId("bookmark-FULL_ARTIFACT").click();
    // 애니메이션(0.7s) 중간에 드래그 개입
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const cam = (await getUiState(page)).camera;
    // FULL_ARTIFACT 목표 [0.7, 0.55, 5.8]에 도달하지 않았어야 함
    const dist = Math.hypot(cam.position[0] - 0.7, cam.position[1] - 0.55, cam.position[2] - 5.8);
    expect(dist).toBeGreaterThan(0.2);
  });

  test("reduced motion: 북마크가 즉시 이동한다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("bookmark-FRONT_INSCRIPTION").click();
    // 애니메이션 시간(700ms)보다 훨씬 짧은 창에서 저장 완료 확인
    await expect
      .poll(async () => (await getUiState(page)).camera?.position?.[2] ?? 0, {
        timeout: 600,
        intervals: [80, 120, 180],
      })
      .toBeGreaterThan(4.0);
  });
});

test.describe("폴리시 6·10·15 — 확대경·컴포저·자동 LOD", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("확대경 M 토글 + 2×/4×/8× 순환 (Evidence 기준 표기)", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.keyboard.press("m");
    await expect(page.getByTestId("magnifier-ring")).toBeVisible();
    await expect(page.getByTestId("magnifier-ring")).toContainText("Evidence 기준");
    await expect(page.getByTestId("magnifier-zoom")).toHaveText("2×");
    await page.getByTestId("magnifier-zoom").click();
    await expect(page.getByTestId("magnifier-zoom")).toHaveText("4×");
    await page.getByTestId("magnifier-zoom").click();
    await expect(page.getByTestId("magnifier-zoom")).toHaveText("8×");
    await page.keyboard.press("m");
    await expect(page.getByTestId("magnifier-ring")).toHaveCount(0);
  });

  test("스크린샷 컴포저: PNG + 메타데이터 sidecar 다운로드", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("screenshot-composer-open").click();
    await expect(page.getByTestId("screenshot-composer")).toBeVisible();
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await page.getByTestId("composer-capture").click();
    await expect.poll(() => downloads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    expect(downloads.some((f) => f.endsWith(".png"))).toBe(true);
    expect(downloads.some((f) => f.endsWith(".json"))).toBe(true);
  });

  test("자동 LOD: 히어로 거리 중간 → 글자 포커스 시 최대 (히스테리시스 승급)", async ({
    page,
  }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("lod-select").selectOption("AUTO");
    await expect(page.getByTestId("lod-select").locator("option").first()).toHaveText(
      /자동 \(중간\)/,
      { timeout: 10_000 }
    );
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("cam-GLYPH_FOCUS").click();
    await expect(page.getByTestId("lod-select").locator("option").first()).toHaveText(
      /자동 \(최대\)/,
      { timeout: 10_000 }
    );
  });
});

test.describe("폴리시 8–9·14 — 쇼케이스", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("스토리 모드 5개 챕터 이동 (점·키보드·URL)", async ({ page }) => {
    await page.goto(SHOWCASE_URL);
    await expect(page.getByTestId("showcase-hero")).toBeVisible({ timeout: 20_000 });
    // 실측 지표
    await expect(page.getByTestId("metric-tabs")).toContainText("6기");
    await expect(page.getByTestId("metric-unresolved")).toContainText("%");

    const chapters = ["artifact", "surface", "glyph", "compare", "evidence"];
    for (let i = 0; i < 5; i++) {
      await page.getByTestId(`chapter-dot-${i + 1}`).click();
      await expect(page.getByTestId(`chapter-body-${chapters[i]}`)).toBeVisible({
        timeout: 15_000,
      });
      await expect.poll(() => page.url(), { timeout: 5_000 }).toContain(`chapter=${i + 1}`);
    }
    // 근거 챕터: UNKNOWN을 정직하게 노출
    await expect(page.getByTestId("showcase-status-table")).toBeVisible();
    await expect(page.getByTestId("showcase-unknown-example")).toContainText("demoA-L3-C5");
    // 키보드 ←
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("chapter-body-compare")).toBeVisible({ timeout: 15_000 });
  });

  test("reduced motion: 쇼케이스 챕터 전환이 즉시 적용된다", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${SHOWCASE_URL}?chapter=1`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("chapter-dot-2").click();
    await expect(page.getByTestId("chapter-body-surface")).toBeVisible({ timeout: 10_000 });
    // 사용자 개입 → 가이드 일시정지 + 복귀 버튼
    const canvas = page.locator("[data-testid=stele-stage] canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId("guide-return")).toBeVisible();
    await page.getByTestId("guide-return").click();
    await expect(page.getByTestId("guide-return")).toHaveCount(0);
  });

  test("권리 미확인 자산은 공개 쇼케이스에서 차단·사유 표기", async ({ page }) => {
    // VERIFY_REQUIRED 업로드 자산 생성 (기존 업로드 플로우 재사용)
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await page.getByTestId("workbench-view-sources").click();
    await page.getByTestId("upload-input").setInputFiles({
      name: "chungju-download.ply",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(
        [
          "ply", "format ascii 1.0", "element vertex 3",
          "property float x", "property float y", "property float z",
          "element face 1", "property list uchar int vertex_indices", "end_header",
          "0 0 0", "550 0 0", "0 2030 0", "3 0 1 2", "",
        ].join("\n")
      ),
    });
    await page.getByTestId("upload-button").click();
    await expect(page.locator('[data-testid^="asset-asset-upload-"]')).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(`${SHOWCASE_URL}?chapter=1`);
    await expect(page.getByTestId("rights-gate-note")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("rights-gate-note")).toContainText("chungju-download.ply");
    await expect(page.getByTestId("rights-gate-note")).toContainText("VERIFY_REQUIRED");
    // 무대 3D는 가상 데모로 유지
    await expect(page.getByTestId("chapter-body-artifact")).toContainText("가상 데모");
  });
});

test.describe("폴리시 11 — Surface Compare 동기화 유지", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("두 캔버스 + 카메라 동기화 옵션 + 밝은 배경", async ({ page }) => {
    await page.goto(`${SET_URL}/surface-compare?cells=demoA-L2-C3,demoB-L1-C1`);
    await expect(page.locator("canvas")).toHaveCount(2, { timeout: 30_000 });
    const sync = page.getByLabel("카메라 동기화").or(page.getByText("카메라 동기화"));
    await expect(sync.first()).toBeVisible();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(luminance(bg)).toBeGreaterThan(0.7);
  });
});
