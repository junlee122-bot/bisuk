import { expect, resetDb, SET_URL, test } from "./fixtures";

test.describe("E2E 1 — 멀티 탭 상태", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("6개 기본 탭 표시, 활성/고정/순서변경 후 새로고침 시 복원", async ({ page }) => {
    await page.goto(SET_URL);
    await expect(page.getByTestId("set-title")).toHaveText("고구려·초기 신라 비문 비교");

    // 6개 기본 탭
    const tabIds = [
      "chungju-goguryeobi",
      "gwanggaeto-stele",
      "uljin-bongpyeong-stele",
      "wolseong-stele-fragments",
      "jian-goguryeo-stele",
      "changnyeong-gwanryongsan-stele",
    ];
    for (const id of tabIds) {
      await expect(page.getByTestId(`tab-${id}`)).toBeVisible();
    }
    // 기본 활성 탭 = 충주 (PRIMARY)
    await expect(page.getByTestId("tab-chungju-goguryeobi")).toHaveAttribute(
      "data-active",
      "true"
    );

    // 월성 탭 활성화
    const orderSave = page.waitForResponse((r) => r.url().includes("/tab-order"));
    await page.getByTestId("tab-wolseong-stele-fragments").getByRole("tab").click();
    await orderSave;
    await expect(page.getByTestId("tab-wolseong-stele-fragments")).toHaveAttribute(
      "data-active",
      "true"
    );

    // 울진 탭 고정
    await page.getByTestId("tab-uljin-bongpyeong-stele").hover();
    const pinSave = page.waitForResponse((r) => r.url().includes("/tab-order"));
    await page.getByTestId("tab-pin-uljin-bongpyeong-stele").click();
    await pinSave;
    await expect(page.getByTestId("tab-uljin-bongpyeong-stele")).toHaveAttribute(
      "data-pinned",
      "true"
    );

    // 광개토 탭을 오른쪽으로 이동
    await page.getByTestId("tab-gwanggaeto-stele").hover();
    const moveSave = page.waitForResponse((r) => r.url().includes("/tab-order"));
    await page.getByTestId("tab-move-right-gwanggaeto-stele").click();
    await moveSave;

    // 새로고침 → 상태 복원
    await page.reload();
    await expect(page.getByTestId("tab-wolseong-stele-fragments")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(page.getByTestId("tab-uljin-bongpyeong-stele")).toHaveAttribute(
      "data-pinned",
      "true"
    );
    // 이동된 순서 확인: 광개토는 이제 울진 뒤
    const tabs = page.locator('[data-testid^="tab-"][data-active]');
    const ids = await tabs.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-testid"))
    );
    const gwIdx = ids.indexOf("tab-gwanggaeto-stele");
    const uljinIdx = ids.indexOf("tab-uljin-bongpyeong-stele");
    expect(gwIdx).toBeGreaterThan(uljinIdx);
  });

  test("탭 딥링크(?tab=)와 탭별 자산 모드 전환", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=jian-goguryeo-stele`);
    await expect(page.getByTestId("tab-jian-goguryeo-stele")).toHaveAttribute(
      "data-active",
      "true"
    );
    // 지안 탭 = 판독문 전용 (가상 표시)
    await expect(page.getByTestId("transcription-viewer")).toBeVisible();
    await expect(page.getByTestId("workbench")).toContainText("TRANSCRIPTION_ONLY");

    // 창녕 탭 = 메타데이터 전용, 1차 판독 배지
    await page.getByTestId("tab-changnyeong-gwanryongsan-stele").getByRole("tab").click();
    await expect(page.getByTestId("metadata-viewer")).toBeVisible();
    await expect(page.getByTestId("preliminary-badge")).toContainText("확정 아님");

    // 월성 탭 = 조각 접합 뷰어
    await page.getByTestId("tab-wolseong-stele-fragments").getByRole("tab").click();
    await expect(page.getByTestId("fragment-viewer")).toBeVisible();
    await expect(page.getByTestId("join-result")).toBeVisible();
  });

  test("3D 탭 비활성화 시 WebGL 컨텍스트 해제 (GPU 메모리 회수)", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await expect
      .poll(async () => page.evaluate(() => window.__seokmunGl?.active ?? -1))
      .toBe(1);

    // 문헌 전용 탭으로 전환 → 캔버스 언마운트 + 컨텍스트 카운터 0
    await page.getByTestId("tab-jian-goguryeo-stele").getByRole("tab").click();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect
      .poll(async () => page.evaluate(() => window.__seokmunGl?.active ?? -1))
      .toBe(0);
    const counters = await page.evaluate(() => window.__seokmunGl);
    expect(counters?.disposed).toBeGreaterThanOrEqual(1);
  });
});

test.describe("E2E 5 — 미상 결정 (Decision Gate 실패)", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("시각 근거 약한 글자 → 반증 수집 → UNKNOWN 저장 + 실패 사유 표시", async ({
    page,
  }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    // 트리에서 마모 심한 셀 선택
    await page.getByTestId("glyph-cell-demoA-L3-C5").click();
    await expect(page.getByTestId("evidence-panel")).toContainText("demoA-L3-C5");

    // 독립 분석 실행
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("decision-outcome")).toHaveText("UNKNOWN", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("failed-rules")).toContainText("independent_lineage_count");

    // 반증(반대 근거)이 수집되어 표시됨
    await expect(page.getByTestId("evidence-list")).toContainText("반대");

    // Dossier: 실패한 규칙이 ✗로 표시
    await page.getByTestId("open-dossier").click();
    await expect(page.getByTestId("dossier-modal")).toBeVisible();
    await expect(page.getByTestId("dossier-decision")).toContainText("UNKNOWN");
    await expect(page.getByTestId("dossier-decision")).toContainText("✗");
    await page.getByTestId("dossier-close").click();

    // 트리 배지도 미상으로 갱신
    await expect(
      page.getByTestId("glyph-cell-demoA-L3-C5").locator(".badge")
    ).toContainText("미상");
  });

  test("자동 채택 시나리오: demoA-L2-C3 → MULTI_SOURCE_AUTOMATIC + 계보 병합", async ({
    page,
  }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await page.getByTestId("glyph-cell-demoA-L2-C3").click();
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("decision-outcome")).toHaveText("AUTO_ACCEPTED", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("evidence-panel")).toContainText("독립 계보 2개");
    await expect(page.getByTestId("candidate-安")).toBeVisible();

    await page.getByTestId("open-dossier").click();
    await expect(page.getByTestId("dossier-conclusion")).toContainText("安");
    await expect(page.getByTestId("dossier-genealogy")).toContainText(
      "독립 근거 1개로 계산"
    );
    // 가상 데모 고지
    await expect(page.getByTestId("dossier-modal")).toContainText("실제 판독 아님");
  });
});

test.describe("문헌 검색 (지지·반증)", () => {
  test("반증 검색 필터가 동작한다", async ({ page }) => {
    await resetDb(page);
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await page.getByTestId("literature-query").fill("戶 판독");
    await page.getByTestId("literature-stance").selectOption("COUNTER");
    await page.getByTestId("literature-submit").click();
    await expect(page.getByTestId("literature-hit").first()).toContainText("[가상 문헌]");
    await expect(page.getByTestId("literature-search")).toContainText("허구 문헌");
  });
});
