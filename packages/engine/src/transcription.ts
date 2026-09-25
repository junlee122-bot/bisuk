/**
 * 판독문(Leiden-lite) 파서 — 출판된 판독문을 붙여 넣으면 면·행·자 단위 셀로 분해한다.
 *
 * 지원 관례 (한국 금석문 판독문에서 흔한 표기):
 *  - 면 머리글: "# 앞면", "[전면]", "<뒷면>", "面: 左側面" → 새 면
 *  - 행 번호(선택): "1 ", "1: ", "1.", "①", "(1)" — 있으면 행 번호로 사용
 *  - 글자: CJK 한자(확장 B 이상 포함, 이체자 선택자 유지)
 *  - □ ■ ▨ ○ : 결락 1자 / [?] : 판독 불가 1자
 *  - [字] 〔字〕 : 복원(보충) — 괄호 안 여러 자면 각 자가 보충
 *  - 字? 字(?) : 불확실(밑점 대응)
 *  - [...3...] [---3---] [.3.] [3자 결락] (3자 결락) : 연속 결락 n자
 *  - U+3000(전각 공백) : 공격(空格) — 셀을 만들지 않고 기록만
 *  - "/" : 같은 줄 안의 행 바꿈
 *  - 구두점은 무시(경고)
 */

export type TranscriptionCellKind = "CHARACTER" | "ILLEGIBLE" | "LACUNA";

export interface TranscriptionCell {
  sequenceIndex: number;
  reading: string | null;
  kind: TranscriptionCellKind;
  supplied: boolean;
  unclear: boolean;
  raw: string;
}

export interface TranscriptionLine {
  lineIndex: number;
  cells: TranscriptionCell[];
  /** 공격(空格) 위치 — 이 sequenceIndex 앞에 공백이 있었다 */
  spacesBefore: number[];
}

export interface TranscriptionFace {
  faceId: string;
  label: string;
  lines: TranscriptionLine[];
}

export interface ParsedTranscription {
  faces: TranscriptionFace[];
  warnings: string[];
  stats: { cells: number; characters: number; lacunae: number; illegible: number; supplied: number; unclear: number };
}

const HAN = /\p{Script=Han}/u;
const LACUNA_MARKS = new Set(["□", "■", "▨", "○", "〇"]);
const FACE_LABELS: Record<string, string> = {
  앞면: "front",
  전면: "front",
  뒷면: "back",
  후면: "back",
  좌측면: "left",
  왼쪽면: "left",
  우측면: "right",
  오른쪽면: "right",
  윗면: "top",
  상면: "top",
  左側面: "left",
  右側面: "right",
  前面: "front",
  後面: "back",
};
const CIRCLED_DIGITS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

function faceHeader(line: string): string | null {
  const t = line.trim();
  let m = /^#+\s*(.+)$/.exec(t);
  if (m) return m[1]!.trim();
  m = /^[[<〈【]\s*([^\]>〉】]+?)\s*[\]>〉】]$/.exec(t);
  if (m && /면|面|碑陰|碑陽|측|側/.test(m[1]!)) return m[1]!.trim();
  m = /^(?:面|면)\s*[:：]\s*(.+)$/.exec(t);
  if (m) return m[1]!.trim();
  return null;
}

function slugFace(label: string, index: number): string {
  const known = FACE_LABELS[label.replace(/\s+/g, "")];
  return known ?? `face-${index}`;
}

/** 행 앞의 번호를 떼어 낸다 */
function stripLineNumber(line: string): { number: number | null; rest: string } {
  const t = line.replace(/^\s+/, "");
  let m = /^\(?(\d{1,3})\)?(?:\s*[:.．、)]\s*|\s+)/.exec(t);
  if (m) return { number: Number(m[1]), rest: t.slice(m[0].length) };
  m = /^\((\d{1,3})\)/.exec(t);
  if (m) return { number: Number(m[1]), rest: t.slice(m[0].length) };
  const circled = CIRCLED_DIGITS.indexOf(t[0] ?? "");
  if (circled >= 0) return { number: circled + 1, rest: t.slice(1) };
  return { number: null, rest: line };
}

/** 문자열을 코드포인트 단위로 (이체자 선택자·결합 문자는 앞 글자에 붙인다) */
function graphemes(s: string): string[] {
  const out: string[] = [];
  for (const ch of Array.from(s)) {
    const cp = ch.codePointAt(0)!;
    const isSelector = (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
    const isCombining = cp >= 0x0300 && cp <= 0x036f;
    if ((isSelector || isCombining) && out.length > 0) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

const LACUNA_RUN = /^[[(〔]\s*(?:[.·…\-–—]+\s*(\d+)\s*[.·…\-–—]+|(\d+)\s*자\s*결락|결락\s*(\d+)\s*자)\s*[\])〕]/;

function parseLineBody(
  body: string,
  lineIndex: number,
  warnings: string[],
  faceLabel: string
): TranscriptionLine {
  const cells: TranscriptionCell[] = [];
  const spacesBefore: number[] = [];
  let seq = 0;
  let i = 0;
  const chars = graphemes(body);
  const push = (c: Omit<TranscriptionCell, "sequenceIndex">) => {
    seq++;
    cells.push({ ...c, sequenceIndex: seq });
  };
  const rest = () => chars.slice(i).join("");
  while (i < chars.length) {
    const ch = chars[i]!;
    const base = Array.from(ch)[0]!;
    // 연속 결락 [...n...], (n자 결락)
    const run = LACUNA_RUN.exec(rest());
    if (run) {
      const n = Number(run[1] ?? run[2] ?? run[3]);
      for (let k = 0; k < n; k++) push({ reading: null, kind: "LACUNA", supplied: false, unclear: false, raw: run[0] });
      i += graphemes(run[0]).length;
      continue;
    }
    if (rest().startsWith("[?]")) {
      push({ reading: null, kind: "ILLEGIBLE", supplied: false, unclear: false, raw: "[?]" });
      i += 3;
      continue;
    }
    // 보충 [字…] 〔字…〕
    if (base === "[" || base === "〔") {
      const close = base === "[" ? "]" : "〕";
      let j = i + 1;
      const inner: string[] = [];
      while (j < chars.length && chars[j] !== close) {
        inner.push(chars[j]!);
        j++;
      }
      if (j < chars.length) {
        for (const g of inner) {
          const b = Array.from(g)[0]!;
          if (HAN.test(b)) push({ reading: g, kind: "CHARACTER", supplied: true, unclear: false, raw: `${base}${g}${close}` });
          else if (LACUNA_MARKS.has(b)) push({ reading: null, kind: "LACUNA", supplied: false, unclear: false, raw: g });
          else if (b.trim()) warnings.push(`${faceLabel} ${lineIndex}행: 보충 괄호 안의 '${g}' 무시`);
        }
        i = j + 1;
        continue;
      }
      warnings.push(`${faceLabel} ${lineIndex}행: 닫히지 않은 괄호 '${base}'`);
      i++;
      continue;
    }
    if (LACUNA_MARKS.has(base)) {
      push({ reading: null, kind: "LACUNA", supplied: false, unclear: false, raw: ch });
      i++;
      continue;
    }
    if (ch === "　") {
      spacesBefore.push(seq + 1);
      i++;
      continue;
    }
    if (HAN.test(base)) {
      // 불확실 표시: 字? / 字(?)
      let unclear = false;
      let raw = ch;
      const after = chars.slice(i + 1, i + 4).join("");
      if (after.startsWith("(?)") || after.startsWith("（?）")) {
        unclear = true;
        raw += "(?)";
        i += 3;
      } else if (after.startsWith("?") || after.startsWith("？")) {
        unclear = true;
        raw += "?";
        i += 1;
      }
      if (Array.from(ch).some((c) => c === "̣")) unclear = true;
      push({ reading: ch.replace(/̣/g, ""), kind: "CHARACTER", supplied: false, unclear, raw });
      i++;
      continue;
    }
    if (/\s/u.test(ch)) {
      i++;
      continue;
    }
    warnings.push(`${faceLabel} ${lineIndex}행: 해석하지 않은 기호 '${ch}' 무시`);
    i++;
  }
  return { lineIndex, cells, spacesBefore };
}

export function parseTranscription(text: string, opts: { defaultFaceLabel?: string } = {}): ParsedTranscription {
  const warnings: string[] = [];
  const faces: TranscriptionFace[] = [];
  const defaultLabel = opts.defaultFaceLabel ?? "앞면";
  let current: TranscriptionFace | null = null;
  const ensureFace = () => {
    if (!current) {
      current = { faceId: slugFace(defaultLabel, 1), label: defaultLabel, lines: [] };
      faces.push(current);
    }
    return current;
  };
  const usedFaceIds = new Set<string>();
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) continue;
    const header = faceHeader(rawLine);
    if (header) {
      let id = slugFace(header, faces.length + 1);
      while (usedFaceIds.has(id)) id = `${id}-${faces.length + 1}`;
      usedFaceIds.add(id);
      current = { faceId: id, label: header, lines: [] };
      faces.push(current);
      continue;
    }
    const face = ensureFace();
    usedFaceIds.add(face.faceId);
    const { number, rest } = stripLineNumber(rawLine);
    const segments = rest.split("/");
    segments.forEach((seg, k) => {
      const lineIndex =
        k === 0 && number !== null ? number : (face.lines[face.lines.length - 1]?.lineIndex ?? 0) + 1;
      if (face.lines.some((l) => l.lineIndex === lineIndex)) {
        warnings.push(`${face.label} ${lineIndex}행이 중복되었습니다 — 뒤의 행을 이어 붙입니다`);
      }
      const parsed = parseLineBody(seg, lineIndex, warnings, face.label);
      const existing = face.lines.find((l) => l.lineIndex === lineIndex);
      if (existing) {
        const offset = existing.cells.length;
        existing.cells.push(...parsed.cells.map((c) => ({ ...c, sequenceIndex: c.sequenceIndex + offset })));
        existing.spacesBefore.push(...parsed.spacesBefore.map((s) => s + offset));
      } else if (parsed.cells.length > 0) {
        face.lines.push(parsed);
      }
    });
  }
  const all = faces.flatMap((f) => f.lines.flatMap((l) => l.cells));
  return {
    faces: faces.filter((f) => f.lines.length > 0),
    warnings,
    stats: {
      cells: all.length,
      characters: all.filter((c) => c.kind === "CHARACTER").length,
      lacunae: all.filter((c) => c.kind === "LACUNA").length,
      illegible: all.filter((c) => c.kind === "ILLEGIBLE").length,
      supplied: all.filter((c) => c.supplied).length,
      unclear: all.filter((c) => c.unclear).length,
    },
  };
}

/**
 * 셀 자리 배치 — 이미지 위에서 칸을 그리기 전의 임시 격자.
 * 세로쓰기(vertical-rtl): 오른쪽 행부터 왼쪽으로, 위에서 아래로 (한국 비석의 일반적 읽기 순서)
 */
export function layoutTranscriptionGrid(
  face: TranscriptionFace,
  writingDirection: "vertical-rtl" | "horizontal-ltr" = "vertical-rtl",
  margin = 0.04
): Map<string, [number, number, number, number]> {
  const out = new Map<string, [number, number, number, number]>();
  const nLines = Math.max(1, face.lines.length);
  const maxSeq = Math.max(1, ...face.lines.map((l) => l.cells.length));
  const usable = 1 - margin * 2;
  face.lines.forEach((line, li) => {
    line.cells.forEach((cell) => {
      const s = cell.sequenceIndex - 1;
      let box: [number, number, number, number];
      if (writingDirection === "vertical-rtl") {
        const w = usable / nLines;
        const h = usable / maxSeq;
        box = [margin + (nLines - 1 - li) * w, margin + s * h, w * 0.92, h * 0.92];
      } else {
        const w = usable / maxSeq;
        const h = usable / nLines;
        box = [margin + s * w, margin + li * h, w * 0.92, h * 0.92];
      }
      out.set(`${line.lineIndex}:${cell.sequenceIndex}`, box.map((v) => Math.round(v * 10000) / 10000) as [number, number, number, number]);
    });
  });
  return out;
}

/** 셀 읽기 상태 매핑 — 판독문 표기 → 셀 상태 (출판 판독문 기준, 연구실 관측과 구분) */
export function transcriptionCellStatus(
  c: TranscriptionCell
): "OBSERVED" | "PARTIALLY_OBSERVED" | "TEXTUAL_SUPPLEMENT" | "ILLEGIBLE" | "UNKNOWN" {
  if (c.kind === "LACUNA") return "UNKNOWN";
  if (c.kind === "ILLEGIBLE") return "ILLEGIBLE";
  if (c.supplied) return "TEXTUAL_SUPPLEMENT";
  if (c.unclear) return "PARTIALLY_OBSERVED";
  return "OBSERVED";
}
