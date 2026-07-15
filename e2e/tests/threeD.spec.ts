import { API_URL, expect, resetDb, SET_URL, test } from "./fixtures";

test.describe("3D 업그레이드 — 하이브리드 뷰포트", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("표현·조명·분석 모드 전환 + 새로고침 복원 (탭 렌더 상태)", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });

    // 연구형 표현 + Raking 조명 + 곡률 분석
    const save1 = page.waitForResponse((r) => r.url().includes("/ui-state"));
    await page.getByTestId("rep-RESEARCH_EVIDENCE").click();
    await save1;
    const save2 = page.waitForResponse((r) => r.url().includes("/ui-state"));
    await page.getByTestId("light-RAKING").click();
    await save2;
    // 사광 방위각 슬라이더 노출
    await expect(page.getByTestId("raking-azimuth")).toBeVisible();
    const save3 = page.waitForResponse((r) => r.url().includes("/ui-state"));
    await page.getByTestId("mode-CURVATURE").click();
    await save3;
    // 곡률 범례 표시 (가상 단위 명시)
    await expect(page.getByTestId("viewer-3d")).toContainText("가상 단위");

    await page.reload();
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("rep-RESEARCH_EVIDENCE")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("light-RAKING")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mode-CURVATURE")).toHaveAttribute("aria-pressed", "true");
  });

  test("글자 선택 → 고해상 detail patch 스트리밍 + 글자 포커스 카메라", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("cam-GLYPH_FOCUS").click();
    await expect(page.getByTestId("patch-loaded")).toBeVisible({ timeout: 20_000 });
    // 서버에 GLYPH_DETAIL_PATCH variant가 생성됨 (스트리밍 경로)
    const variants = await (
      await page.request.get(`${API_URL}/api/3d/assets/asset-demo-a/variants`)
    ).json();
    expect(
      variants.some(
        (v: { variantType: string; glyphCellId: string | null }) =>
          v.variantType === "GLYPH_DETAIL_PATCH" && v.glyphCellId === "demoA-L2-C3"
      )
    ).toBe(true);
  });

  test("Splat 전환: 표시 전용 경고 + Evidence 좌표 피킹 유지 + 카메라 유지", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    // 같은 Canvas 요소가 유지되는지 확인하기 위한 마커 (컨텍스트 재생성 없음 = 카메라 유지)
    await page.evaluate(() => {
      document.querySelector("canvas")?.setAttribute("data-marker", "keep");
    });
    await page.getByTestId("rep-SPLAT").click();
    await expect(page.getByTestId("splat-warning")).toContainText("측정/판독 기준 아님");
    await expect(page.getByTestId("splat-loaded")).toBeVisible({ timeout: 30_000 });
    const sameCanvas = await page.evaluate(
      () => document.querySelector("canvas")?.getAttribute("data-marker") === "keep"
    );
    expect(sameCanvas).toBe(true);
    await expect
      .poll(async () => page.evaluate(() => window.__seokmunGl?.active ?? -1))
      .toBe(1);
    // Splat 표시 중에도 글자 선택은 Evidence 피킹 평면으로 동작
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    const candidates: Array<[number, number]> = [
      [0.44, 0.42], [0.4, 0.3], [0.47, 0.55], [0.38, 0.5], [0.5, 0.45], [0.42, 0.65],
    ];
    let picked = false;
    for (const [fx, fy] of candidates) {
      await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
      const text = await page.getByTestId("evidence-panel").textContent();
      if (text?.includes("demoA-")) {
        picked = true;
        break;
      }
    }
    expect(picked, "splat 모드에서 evidence 피킹 평면 선택").toBe(true);
  });

  test("3D 품질 패널: 파이프라인 실행 → 실측 수치·계보·고지문", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("quality-panel-toggle").click();
    await expect(page.getByTestId("quality-panel")).toBeVisible();
    // 베이스 메시 실측 삼각형 수 표시
    await expect(page.getByTestId("qp-triangles")).not.toHaveText("0");
    // 파생 파이프라인 실행 → LOD variant 목록
    await page.getByTestId("run-pipeline").click();
    await expect(page.getByTestId("qp-variants").locator("li")).toHaveCount(5, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("qp-variants")).toContainText("EVIDENCE_MESH_HIGH");
    await expect(page.getByTestId("qp-variants")).toContainText("측정 허용");
    await expect(page.getByTestId("qp-variants")).toContainText("LOD오차 P95");
    await expect(page.getByTestId("qp-disclaimers")).toContainText(
      "원본 기하 정밀도보다 높은 측정 정확도를 보장하지 않음"
    );
  });

  test("GPU 해제: Splat 표시 후 문헌 탭 전환 시 컨텍스트·지오메트리 해제", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("rep-SPLAT").click();
    await expect(page.getByTestId("splat-loaded")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tab-jian-goguryeo-stele").getByRole("tab").click();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect
      .poll(async () => page.evaluate(() => window.__seokmunGl?.active ?? -1))
      .toBe(0);
  });

  test("Surface Compare: 두 비석 표면 패치 + 모드 전환 + 카메라 동기화 토글", async ({ page }) => {
    await page.goto(
      `${SET_URL}/surface-compare?cells=demoA-L2-C3,demoB-L1-C1`
    );
    await expect(page.getByTestId("surface-compare")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId("camera-sync")).toBeChecked();
    // 깊이 모드 전환
    await page.getByTestId("surface-mode-DEPTH").click();
    await expect(page.getByTestId("surface-mode-DEPTH")).toHaveAttribute("aria-pressed", "true");
    // 절대 깊이 비교 금지 고지
    await expect(page.locator("main")).toContainText("절대 깊이 차이는 계산하지 않습니다");
  });

  test("어댑터 레지스트리 API — 이 환경에선 전부 미가용으로 정직하게 보고", async ({ page }) => {
    const adapters = await (
      await page.request.get(`${API_URL}/api/3d/adapters`)
    ).json();
    expect(adapters.length).toBeGreaterThanOrEqual(8);
    expect(adapters.every((a: { available: boolean }) => !a.available)).toBe(true);
  });
});
