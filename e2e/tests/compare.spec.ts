import { expect, resetDb, SET_URL, test } from "./fixtures";

test.describe("E2E 2 — Glyph Matrix 글자 비교", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("글자 선택 → 비교 트레이 → 매트릭스 → 후보 점수 → 근거 열기", async ({
    page,
  }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);

    // 충주 데모 글자 선택 후 비교 트레이에 추가
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("add-to-compare").click();
    await expect(page.getByTestId("compare-tray")).toContainText("demoA-L2-C3");

    // 울진·광개토·충주 탭 선택
    await page.getByTestId("compare-tab-check-chungju-goguryeobi").check();
    await page.getByTestId("compare-tab-check-uljin-bongpyeong-stele").check();
    await page.getByTestId("compare-tab-check-gwanggaeto-stele").check();
    await page.getByTestId("open-glyph-matrix").click();

    // Glyph Matrix 표시
    await expect(page.getByTestId("glyph-matrix")).toBeVisible();
    const uljinCell = page.getByTestId("matrix-cell-demoA-L2-C3-uljin-bongpyeong-stele");
    await expect(uljinCell).toContainText("기존 판독");
    await expect(uljinCell).toContainText("安");
    await expect(uljinCell).toContainText("유사도");
    await expect(uljinCell).toContainText("가상");

    // 후보 점수 확인 (행 분석 실행)
    await page.getByTestId("row-analyze-demoA-L2-C3").click();
    await expect(page.getByTestId("row-candidates-demoA-L2-C3")).toContainText(
      "현재 후보 安",
      { timeout: 15_000 }
    );

    // 근거 열기 → Dossier
    await page.getByTestId("open-evidence-demoA-L2-C3").click();
    await expect(page.getByTestId("dossier-modal")).toBeVisible();
    await expect(page.getByTestId("dossier-evidence")).toContainText("인용 위치 확인");
    await expect(page.getByTestId("dossier-evidence")).toContainText("반대");
  });

  test("조각 접합 데모: 슬라이더 이동 시 접합 신뢰도 변화", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=wolseong-stele-fragments`);
    await expect(page.getByTestId("fragment-viewer")).toBeVisible();
    await expect(page.getByTestId("join-result")).toBeVisible({ timeout: 15_000 });
    const initial = await page.getByTestId("join-confidence").textContent();

    // 간격 0으로 → 신뢰도 상승
    await page.getByTestId("join-slider").fill("0");
    await expect
      .poll(async () => Number(await page.getByTestId("join-confidence").textContent()))
      .toBeGreaterThan(0.9);
    expect(Number(initial)).toBeLessThan(1);
    // 가상 조각 고지
    await expect(page.getByTestId("fragment-viewer")).toContainText("실제 유물");
  });
});
