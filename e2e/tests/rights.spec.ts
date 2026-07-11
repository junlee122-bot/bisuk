import { expect, resetDb, SET_URL, test } from "./fixtures";

const DEMO_PLY = [
  "ply",
  "format ascii 1.0",
  "comment 사용자가 직접 내려받은 파일을 가장한 테스트 픽스처 (가상)",
  "element vertex 3",
  "property float x",
  "property float y",
  "property float z",
  "element face 1",
  "property list uchar int vertex_indices",
  "end_header",
  "0 0 0",
  "550 0 0",
  "0 2030 0",
  "3 0 1 2",
  "",
].join("\n");

test.describe("E2E 4 — 업로드 권리 게이트", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("업로드 → 분석 가능 + 공개 내보내기 차단 → 권리 확인 → 허용", async ({
    page,
  }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);

    // Source Card 화면에서 PLY 업로드
    await page.getByTestId("workbench-view-sources").click();
    await expect(page.getByTestId("importer")).toBeVisible();
    await page.getByTestId("upload-input").setInputFiles({
      name: "chungju-download.ply",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(DEMO_PLY),
    });
    await page.getByTestId("upload-button").click();

    // 자산 카드: 체크섬 + 품질 보고서 + 권리 미확인
    const assetCard = page.locator('[data-testid^="asset-asset-upload-"]');
    await expect(assetCard).toBeVisible({ timeout: 15_000 });
    await expect(assetCard).toContainText("chungju-download.ply");
    await expect(assetCard).toContainText("sha256");
    await expect(assetCard).toContainText("VERIFY_REQUIRED");
    await expect(assetCard).toContainText("정점 3");
    await expect(assetCard).toContainText("mm");

    // 외부 공개 내보내기 차단
    await page.getByTestId("open-export").click();
    await page.getByTestId("audience-public").check();
    await page.getByTestId("export-json").click();
    await expect(page.getByTestId("export-blocked")).toContainText(
      "chungju-download.ply"
    );
    await expect(page.getByTestId("export-message")).toContainText("차단");
    await page.getByTestId("export-modal").getByText("닫기 ✕").click();

    // 관리자 권리 확인
    const licenseForm = page.locator('[data-testid^="license-form-"]');
    await licenseForm.getByLabel("공공누리 유형").selectOption("KOGL_TYPE_1");
    await licenseForm.getByText("권리 확인 저장").click();
    await expect(assetCard).toContainText("라이선스 KOGL_TYPE_1", { timeout: 10_000 });

    // 이제 공개 내보내기 허용
    await page.getByTestId("open-export").click();
    await page.getByTestId("audience-public").check();
    await page.getByTestId("export-json").click();
    await expect(page.getByTestId("export-message")).toContainText("내보내기 완료");
  });

  test("내부 연구용 내보내기 4형식은 항상 동작", async ({ page }) => {
    await page.goto(SET_URL);
    await page.getByTestId("open-export").click();
    for (const fmt of ["json", "csv", "epidoc", "report"]) {
      await page.getByTestId(`export-${fmt}`).click();
      await expect(page.getByTestId("export-message")).toContainText("내보내기 완료");
    }
  });
});
