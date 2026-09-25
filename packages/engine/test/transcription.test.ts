import { describe, expect, it } from "vitest";
import {
  layoutTranscriptionGrid,
  parseTranscription,
  transcriptionCellStatus,
} from "../src/transcription";

describe("판독문 파서 (Leiden-lite)", () => {
  it("기본: 행마다 글자 셀, 행 번호 자동", () => {
    const p = parseTranscription("王國土\n山川");
    expect(p.faces).toHaveLength(1);
    expect(p.faces[0]!.label).toBe("앞면");
    expect(p.faces[0]!.faceId).toBe("front");
    expect(p.faces[0]!.lines.map((l) => l.lineIndex)).toEqual([1, 2]);
    expect(p.faces[0]!.lines[0]!.cells.map((c) => c.reading)).toEqual(["王", "國", "土"]);
    expect(p.stats).toMatchObject({ cells: 5, characters: 5, lacunae: 0 });
  });

  it("보충 [ ]·〔 〕, 불확실 ?·(?), 결락 □·[?]", () => {
    const p = parseTranscription("[高句]麗?王〔大〕□[?]太(?)");
    const cells = p.faces[0]!.lines[0]!.cells;
    expect(cells.map((c) => [c.reading, c.kind, c.supplied, c.unclear])).toEqual([
      ["高", "CHARACTER", true, false],
      ["句", "CHARACTER", true, false],
      ["麗", "CHARACTER", false, true],
      ["王", "CHARACTER", false, false],
      ["大", "CHARACTER", true, false],
      [null, "LACUNA", false, false],
      [null, "ILLEGIBLE", false, false],
      ["太", "CHARACTER", false, true],
    ]);
    expect(p.stats.supplied).toBe(3);
    expect(p.stats.unclear).toBe(2);
    expect(cells.map((c) => c.sequenceIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("연속 결락 표기 [...3...]·[---2---]·(4자 결락)", () => {
    const p = parseTranscription("王[...3...]土[---2---]山(4자 결락)川");
    const cells = p.faces[0]!.lines[0]!.cells;
    expect(cells).toHaveLength(1 + 3 + 1 + 2 + 1 + 4 + 1);
    expect(cells.filter((c) => c.kind === "LACUNA")).toHaveLength(9);
    expect(cells[cells.length - 1]!.reading).toBe("川");
  });

  it("면 머리글 여러 개 + 번호 달린 행 + 행 안의 / 줄바꿈", () => {
    const text = ["# 앞면", "1: 王國", "3 土山", "[뒷면]", "① 大/太", "<左側面>", "(2) 川"].join("\n");
    const p = parseTranscription(text);
    expect(p.faces.map((f) => [f.faceId, f.label])).toEqual([
      ["front", "앞면"],
      ["back", "뒷면"],
      ["left", "左側面"],
    ]);
    expect(p.faces[0]!.lines.map((l) => l.lineIndex)).toEqual([1, 3]);
    expect(p.faces[1]!.lines.map((l) => [l.lineIndex, l.cells.map((c) => c.reading).join("")])).toEqual([
      [1, "大"],
      [2, "太"],
    ]);
    expect(p.faces[2]!.lines[0]!.lineIndex).toBe(2);
  });

  it("확장 B 한자(𠀋)와 이체자 선택자를 한 글자로 유지", () => {
    const p = parseTranscription("𠀋葛\u{E0100}王");
    const cells = p.faces[0]!.lines[0]!.cells;
    expect(cells.map((c) => c.reading)).toEqual(["𠀋", "葛\u{E0100}", "王"]);
  });

  it("공격(전각 공백)은 셀을 만들지 않고 위치만 기록, 구두점은 경고", () => {
    const p = parseTranscription("王　國。土");
    const line = p.faces[0]!.lines[0]!;
    expect(line.cells.map((c) => c.reading)).toEqual(["王", "國", "土"]);
    expect(line.spacesBefore).toEqual([2]);
    expect(p.warnings.some((w) => w.includes("。"))).toBe(true);
  });

  it("닫히지 않은 괄호는 경고", () => {
    const p = parseTranscription("王[國");
    expect(p.warnings.some((w) => w.includes("닫히지 않은"))).toBe(true);
  });

  it("세로쓰기 격자: 1행이 가장 오른쪽, 위에서 아래로", () => {
    const p = parseTranscription("王國\n土山");
    const grid = layoutTranscriptionGrid(p.faces[0]!, "vertical-rtl");
    const l1c1 = grid.get("1:1")!;
    const l2c1 = grid.get("2:1")!;
    const l1c2 = grid.get("1:2")!;
    expect(l1c1[0]).toBeGreaterThan(l2c1[0]);
    expect(l1c2[1]).toBeGreaterThan(l1c1[1]);
    for (const box of grid.values()) {
      expect(box[0] + box[2]).toBeLessThanOrEqual(1);
      expect(box[1] + box[3]).toBeLessThanOrEqual(1);
    }
    const h = layoutTranscriptionGrid(p.faces[0]!, "horizontal-ltr");
    expect(h.get("1:2")![0]).toBeGreaterThan(h.get("1:1")![0]);
  });

  it("셀 상태 매핑: 출판 판독문 표기 → 셀 상태", () => {
    const p = parseTranscription("王[國]土?□[?]");
    expect(p.faces[0]!.lines[0]!.cells.map(transcriptionCellStatus)).toEqual([
      "OBSERVED",
      "TEXTUAL_SUPPLEMENT",
      "PARTIALLY_OBSERVED",
      "UNKNOWN",
      "ILLEGIBLE",
    ]);
  });
});
