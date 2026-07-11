import { test as base, expect, type Page } from "@playwright/test";

export const SET_ID = "early-korean-stelae-comparative";
export const SET_URL = `/sets/${SET_ID}`;

/** 모든 테스트에서 콘솔 오류·페이지 예외를 수집하고 테스트 종료 시 0건을 검증한다. */
export const test = base.extend<{ consoleGuard: string[] }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      // 의도된 4xx 응답(권리 게이트 403 등)의 브라우저 네트워크 로그는 앱 오류가 아니다
      const EXPECTED = /Failed to load resource.*status of 4\d\d/;
      page.on("console", (msg) => {
        if (msg.type() === "error" && !EXPECTED.test(msg.text())) {
          errors.push(msg.text());
        }
      });
      page.on("pageerror", (err) => errors.push(String(err)));
      await use(errors);
      expect(errors, "콘솔 오류가 없어야 한다").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function resetDb(page: Page): Promise<void> {
  const res = await page.request.post("http://localhost:4100/api/dev/reset");
  expect(res.ok()).toBeTruthy();
}
