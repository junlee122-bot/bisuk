import { deflateSync } from "node:zlib";
import { expect, resetDb, SET_URL, test } from "./fixtures";

/** 테스트용 단색 PNG (가상 픽스처 — 실제 비석 사진 아님) */
function makePng(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((w + 1) * h, 0xb0);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test.describe("연구실 흐름 — 판독·가져오기·이미지·검색·로그인", () => {
  test.beforeEach(async ({ page }) => {
    await resetDb(page);
  });

  test("판독 제안 → PI 채택 → 판독 비교표 반영", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi&cell=demoA-L3-C5`);
    await expect(page.getByTestId("readings-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("propose-reading").click();
    await page.getByTestId("reading-char").fill("戶");
    await page.getByTestId("reading-rationale").fill("상단 사선과 우측 세로획 흔적 (시험 판독)");
    await page.getByTestId("reading-submit").click();
    const row = page.getByTestId("reading-row").first();
    await expect(row).toContainText("검토 대기");
    await row.getByTestId("reading-accept").click();
    await expect(page.getByTestId("reading-adopted")).toBeVisible();

    await page.getByTestId("open-reading-table").click();
    await expect(page.getByTestId("reading-table")).toContainText("戶", { timeout: 15_000 });
    await expect(page.getByTestId("reading-table")).toContainText("3행 5자");
  });

  test("새 비석 탭 → 판독문 가져오기(미리보기 → 생성) → 트리에 셀 생성", async ({ page }) => {
    await page.goto(SET_URL);
    await page.getByTestId("tab-add").click();
    await page.getByLabel("새 탭 비석 이름").fill("시험비");
    await page.getByRole("tablist", { name: "비석 탭" }).getByRole("button", { name: "추가", exact: true }).click();
    await page.getByRole("tab", { name: /시험비/ }).click();
    await page.getByTestId("open-tab-manager").click();
    await page.getByTestId("tab-manager-import").click();
    await page.getByTestId("transcription-text").fill("# 전면\n國安[王]□\n守?墓");
    await page.getByTestId("transcription-preview").click();
    await expect(page.getByTestId("transcription-preview-result")).toContainText("글자 자리 6개");
    await page.getByTestId("transcription-create").click();
    await expect(page.getByTestId("transcription-import")).toContainText("셀 6개");
    await page.getByTestId("tab-manager").getByText("닫기 ✕").click();
    await expect(page.getByTestId("glyph-tree")).toContainText("전면 · 2행");
  });

  test("사진 등록 → 이미지 뷰어 거리 측정 (단위 미확정 표시)", async ({ page }) => {
    await page.goto(`${SET_URL}?tab=chungju-goguryeobi`);
    await page.getByTestId("workbench-view-sources").click();
    await page.getByTestId("upload-input").setInputFiles({ name: "rubbing-test.png", mimeType: "image/png", buffer: makePng(400, 300) });
    await page.getByTestId("upload-button").click();
    await expect(page.locator('[data-testid^="asset-asset-upload-"]')).toContainText("400×300", { timeout: 15_000 });
    await page.getByTestId("workbench-view-image").click();
    await expect(page.getByTestId("image-annotator")).toBeVisible();
    await page.getByTestId("annot-mode-measure").click();
    const img = page.getByAltText("rubbing-test.png");
    await expect(img).toBeVisible();
    const box = (await img.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await expect(page.getByTestId("measure-result")).toContainText("px — 단위 미확정");
  });

  test("전역 검색(Ctrl+K)으로 글자를 찾아 셀로 이동", async ({ page }) => {
    await page.goto(SET_URL);
    await expect(page.getByTestId("open-search")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Control+k");
    await page.getByTestId("search-input").fill("安");
    await page.getByTestId("search-hit-cell").first().click();
    await expect(page).toHaveURL(/cell=/);
    await expect(page.getByTestId("evidence-panel")).toContainText("demo");
  });

  test("로그인 화면(개발 모드): 연구원 계정으로 들어가면 PI 전용 기능이 없다", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("dev-users")).toBeVisible();
    await page.getByTestId("dev-login-RESEARCHER").click();
    await expect(page.getByTestId("user-menu")).toContainText("연구원", { timeout: 15_000 });
    await page.goto("/admin");
    await expect(page.getByText("연구실 관리는 PI만 할 수 있습니다.")).toBeVisible();
  });
});
