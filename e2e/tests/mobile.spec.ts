import { expect, resetDb, SET_URL, test } from "./fixtures";

test.describe("모바일 레이아웃 (iPhone 13)", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("대시보드·워크스페이스 패널 전환·가로 스크롤 없음", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("set-card-early-korean-stelae-comparative")).toBeVisible();
    // 본문 가로 오버플로 없음
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflowX).toBeLessThanOrEqual(2);

    await page.goto(SET_URL);
    // 모바일 패널 전환 버튼 표시
    await expect(page.getByTestId("mobile-panel-workbench")).toBeVisible();
    // 기본: 작업대만 표시
    await expect(page.getByTestId("workbench")).toBeVisible();

    // 트리 패널 전환
    await page.getByTestId("mobile-panel-tree").click();
    await expect(page.getByTestId("glyph-tree")).toBeVisible();
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();

    // 근거 패널 전환 → 선택 글자 표시
    await page.getByTestId("mobile-panel-evidence").click();
    await expect(page.getByTestId("evidence-panel")).toContainText("demoA-L2-C3");

    // 탭 스트립은 가로 스크롤 컨테이너
    const stripOverflow = await page
      .locator('[role="tablist"]')
      .evaluate((el) => el.scrollWidth >= el.clientWidth);
    expect(stripOverflow).toBeTruthy();

    // 본문 가로 오버플로 없음 (모바일 워크스페이스)
    const wsOverflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(wsOverflowX).toBeLessThanOrEqual(2);
  });

  test("모바일 Frontier 목록", async ({ page }) => {
    await page.goto("/frontier");
    await expect(page.getByTestId("watch-item-watch-changnyeong")).toBeVisible();
    await expect(page.getByTestId("watch-status-watch-changnyeong")).toHaveText("1차 판독");
  });
});
