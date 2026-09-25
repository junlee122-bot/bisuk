/**
 * 문헌 주장(claim) 자동 제안 — 문헌 본문에서 "제2행 제3자는 安으로 판독…" 같은 문장을 찾아
 * (셀, 글자, 지지/반대, 인용문) 후보를 만든다. 결과는 항상 SUGGESTED이며,
 * 연구원이 확인(CONFIRMED)해야 분석 근거로 쓰인다.
 */
import { extractPositionalRefs, MIN_QUOTE_LENGTH } from "./citation";

export interface ClaimSuggestCell {
  id: string;
  lineIndex: number;
  sequenceIndex: number;
}

export interface SuggestedClaim {
  targetGlyphCellId: string;
  character: string;
  stance: "SUPPORT" | "COUNTER";
  quote: string;
  offset: number;
  /** 제안 근거 설명 */
  reason: string;
  /** 0~1 — 규칙 기반 추정의 확실성 */
  confidence: number;
}

const HAN_RE = /\p{Script=Han}/u;
/** 위치 표기·수사에 쓰이는 한자 — 판독 글자로 오인하지 않는다 */
const POSITION_HAN = new Set([..."第行字一二三四五六七八九十面"]);

const COUNTER_CUES = ["아니", "않", "재검토", "신중", "의문", "어렵", "불확실", "오독", "非", "不", "잘못", "반박", "이견"];
const SUPPORT_CUES = ["판독", "읽", "보아", "타당", "가능성이 높", "확인", "분명", "틀림없", "해석"];

function sentenceBounds(text: string, index: number): [number, number] {
  const enders = /[.。!?！？\n]/u;
  let s = index;
  while (s > 0 && !enders.test(text[s - 1]!)) s--;
  let e = index;
  while (e < text.length && !enders.test(text[e]!)) e++;
  if (e < text.length) e++;
  return [s, e];
}

export function suggestClaims(content: string, cells: ClaimSuggestCell[]): SuggestedClaim[] {
  const byPos = new Map(cells.map((c) => [`${c.lineIndex}:${c.sequenceIndex}`, c]));
  const out: SuggestedClaim[] = [];
  const seen = new Set<string>();
  for (const ref of extractPositionalRefs(content)) {
    const cell = byPos.get(`${ref.line}:${ref.seq}`);
    if (!cell) continue;
    const [s, e] = sentenceBounds(content, ref.index);
    const sentence = content.slice(s, e);
    // 위치 표기 뒤에서 첫 판독 글자 (없으면 문장 안 첫 글자)
    const afterRef = content.slice(ref.index, e);
    const pick = (t: string) => [...t].find((ch) => HAN_RE.test(ch) && !POSITION_HAN.has(ch));
    const character = pick(afterRef) ?? pick(sentence);
    if (!character) continue;
    const counter = COUNTER_CUES.filter((c) => sentence.includes(c));
    const support = SUPPORT_CUES.filter((c) => sentence.includes(c));
    const stance: SuggestedClaim["stance"] = counter.length > 0 ? "COUNTER" : "SUPPORT";
    const quote = sentence.trim().slice(0, 200);
    if ([...quote.replace(/[\s\p{P}]/gu, "")].length < MIN_QUOTE_LENGTH) continue;
    const key = `${cell.id}|${character}|${stance}|${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const confidence = Math.min(
      0.9,
      0.4 + (support.length > 0 || counter.length > 0 ? 0.3 : 0) + (afterRef.includes(character) ? 0.1 : 0)
    );
    out.push({
      targetGlyphCellId: cell.id,
      character,
      stance,
      quote,
      offset: s + (sentence.length - sentence.trimStart().length),
      reason:
        `위치 표기 "${ref.line}행 ${ref.seq}자" 인식` +
        (counter.length ? `, 반대 표현: ${counter.join("·")}` : support.length ? `, 지지 표현: ${support.join("·")}` : ", 입장 표현 없음 (지지로 가정)"),
      confidence: Math.round(confidence * 100) / 100,
    });
  }
  return out;
}
