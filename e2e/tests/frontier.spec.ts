import { expect, resetDb, SET_ID, test } from "./fixtures";

test.describe("E2E 3 — Frontier Watch", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("창녕 Watch Item: 1차 판독 배지 + 원본 미확보 + 사진 재배포 금지", async ({
    page,
  }) => {
    await page.goto("/frontier");
    const item = page.getByTestId("watch-item-watch-changnyeong");
    await expect(item).toBeVisible();
    await expect(page.getByTestId("watch-status-watch-changnyeong")).toHaveText(
      "1차 판독"
    );
    await expect(item).toContainText("확정 아님");
    await expect(item).toContainText("권리 미확인");
    await expect(item).toContainText("NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED");
    // 이미 연구 세트 탭으로 연결됨
    await expect(page.getByTestId("watch-open-tab-watch-changnyeong")).toBeVisible();
  });

  test("DEMO-D 승격: 메타데이터 탭 생성, 확정 판독으로 표시되지 않음", async ({
    page,
  }) => {
    await page.goto("/frontier");
    const demoItem = page.getByTestId("watch-item-watch-demo-d");
    await expect(demoItem).toContainText("[가상]");

    await page.getByTestId("watch-promote-watch-demo-d").click();
    await expect(page.getByTestId("frontier-message")).toContainText(
      "확정 판독으로 표시되지 않습니다"
    );
    // 승격 후 연결된 탭 열기
    await page.getByTestId("watch-open-tab-watch-demo-d").click();
    await page.waitForURL(new RegExp(`/sets/${SET_ID}`));
    await expect(page.getByTestId("metadata-viewer")).toBeVisible();
    // 1차 판독 주장이 확정으로 표시되지 않는지 확인
    await expect(page.getByTestId("preliminary-badge")).toContainText("확정 아님");
    await expect(page.getByTestId("metadata-viewer")).toContainText("1차 판독");
  });
});
