/**
 * Citation Verifier — 인용 문자열이 실제 문서 본문에 존재하는지 확인하고
 * 위치·앞뒤 문맥을 기록한다. 검증 실패 인용은 자동 채택 근거가 될 수 없다.
 *
 * v2: 정확 일치 → 정규화 일치(NFKC·공백·구두점 무시) → 이체자 접기 일치 순으로 찾고,
 * 어떤 방식으로 찾았는지(matchType)와 인용이 대상 글자·위치를 특정하는지(targetSpecificity)를 남긴다.
 * 정규화·이체자 일치도 원문 위치(offset)는 원본 기준으로 돌려준다.
 */
import type { VariantRegistry } from "./variants";

export type CitationMatchType = "EXACT" | "NORMALIZED" | "VARIANT_FOLDED" | "NONE";

/**
 * POSITIONAL: 인용(또는 바로 앞뒤 문맥)이 대상 셀의 행·자 위치를 명시
 * CHARACTER: 대상 글자(또는 이체자)를 언급하지만 위치는 없음
 * NONE: 대상 글자도 위치도 없음 — 문서 어딘가의 문장일 뿐 이 셀의 근거인지 알 수 없다
 */
export type TargetSpecificity = "POSITIONAL" | "CHARACTER" | "NONE";

export interface CitationTarget {
  character?: string | null;
  lineIndex?: number | null;
  sequenceIndex?: number | null;
}

export interface CitationCheck {
  verified: boolean;
  offset: number | null;
  /** 원문 기준 일치 구간 길이 (UTF-16) */
  length: number | null;
  context: string;
  reason: string;
  matchType: CitationMatchType;
  targetSpecificity: TargetSpecificity;
}

export interface VerifyCitationOptions {
  registry?: VariantRegistry;
  target?: CitationTarget;
  /** 위치 표기를 찾을 앞뒤 문맥 폭 (글자) */
  contextWindow?: number;
}

/** 인용 최소 길이 — 흔한 글자 한두 자로 '검증됨'을 만드는 우회를 막는다 (정규화 후 글자 수) */
export const MIN_QUOTE_LENGTH = 8;

const SKIP_RE = /[\s\p{P}\p{S}]/u;

interface NormalizedText {
  text: string;
  /** text의 UTF-16 위치 → 원문 UTF-16 시작 위치 */
  orig: number[];
  /** text의 UTF-16 위치 → 원문 글자 길이 */
  origLen: number[];
}

/** NFKC + 공백·구두점·기호 제거 (+ 선택적 이체자 접기), 원문 위치 매핑 유지 */
export function normalizeForCitation(input: string, registry?: VariantRegistry): NormalizedText {
  let text = "";
  const orig: number[] = [];
  const origLen: number[] = [];
  let pos = 0;
  for (const ch of input) {
    const len = ch.length;
    for (const n of ch.normalize("NFKC")) {
      if (SKIP_RE.test(n)) continue;
      const out = registry ? registry.representative(n) : n;
      for (let k = 0; k < out.length; k++) {
        orig.push(pos);
        origLen.push(len);
      }
      text += out;
    }
    pos += len;
  }
  return { text, orig, origLen };
}

function contextAround(content: string, offset: number, length: number): string {
  const before = content.slice(Math.max(0, offset - 40), offset);
  const quoted = content.slice(offset, offset + length);
  const after = content.slice(offset + length, Math.min(content.length, offset + length + 40));
  return `…${before}【${quoted}】${after}…`;
}

const HANJA_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1 && HANJA_NUM[s] !== undefined) return HANJA_NUM[s]!;
  if (s.length === 2 && s[0] === "十" && HANJA_NUM[s[1]!]) return 10 + HANJA_NUM[s[1]!]!;
  if (s.length === 2 && s[1] === "十" && HANJA_NUM[s[0]!]) return HANJA_NUM[s[0]!]! * 10;
  return null;
}

/**
 * 한국어·한문 위치 표기 추출 — "제2행 제3자", "2행 3자", "第二行 第三字", "L2-C3", "2:3".
 * 반환값은 (행, 자) 쌍 목록.
 */
export function extractPositionalRefs(text: string): Array<{ line: number; seq: number; index: number }> {
  const out: Array<{ line: number; seq: number; index: number }> = [];
  const patterns: RegExp[] = [
    /[제第]?\s*([0-9]+|[一二三四五六七八九十]{1,2})\s*[행行]\s*[의,]?\s*[제第]?\s*([0-9]+|[一二三四五六七八九十]{1,2})\s*(?:번째\s*)?[자字]/gu,
    /\bL\s*([0-9]+)\s*[-·:]?\s*C\s*([0-9]+)\b/giu,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const line = parseNum(m[1]!);
      const seq = parseNum(m[2]!);
      if (line !== null && seq !== null) out.push({ line, seq, index: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function specificityFor(
  quote: string,
  surrounding: string,
  target: CitationTarget | undefined,
  registry: VariantRegistry | undefined
): TargetSpecificity {
  if (!target) return "NONE";
  if (target.lineIndex != null && target.sequenceIndex != null) {
    const refs = extractPositionalRefs(surrounding);
    if (refs.some((r) => r.line === target.lineIndex && r.seq === target.sequenceIndex)) return "POSITIONAL";
  }
  if (target.character) {
    const chars = registry ? registry.classOf(target.character) : [target.character];
    if (chars.some((c) => quote.includes(c))) return "CHARACTER";
  }
  return "NONE";
}

export function verifyCitation(
  content: string,
  quote: string,
  opts: VerifyCitationOptions = {}
): CitationCheck {
  const fail = (reason: string): CitationCheck => ({
    verified: false,
    offset: null,
    length: null,
    context: "",
    reason,
    matchType: "NONE",
    targetSpecificity: "NONE",
  });
  const trimmed = quote.trim();
  if (trimmed.length === 0) return fail("빈 인용문");
  const normQuote = normalizeForCitation(trimmed);
  if ([...normQuote.text].length < MIN_QUOTE_LENGTH) {
    return fail(`인용문이 너무 짧아 검증 불충분 (공백·구두점 제외 최소 ${MIN_QUOTE_LENGTH}자)`);
  }

  let offset = -1;
  let length = 0;
  let matchType: CitationMatchType = "NONE";

  const exact = content.indexOf(trimmed);
  if (exact >= 0) {
    offset = exact;
    length = trimmed.length;
    matchType = "EXACT";
  } else {
    const tries: Array<[CitationMatchType, VariantRegistry | undefined]> = [["NORMALIZED", undefined]];
    if (opts.registry) tries.push(["VARIANT_FOLDED", opts.registry]);
    for (const [kind, reg] of tries) {
      const nc = normalizeForCitation(content, reg);
      const nq = reg ? normalizeForCitation(trimmed, reg).text : normQuote.text;
      const idx = nc.text.indexOf(nq);
      if (idx < 0) continue;
      const last = idx + nq.length - 1;
      offset = nc.orig[idx]!;
      length = nc.orig[last]! + nc.origLen[last]! - offset;
      matchType = kind;
      break;
    }
  }

  if (offset < 0) return fail("인용문이 문서 본문에 존재하지 않음 (정규화·이체자 접기 후에도 불일치)");

  const win = opts.contextWindow ?? 30;
  const surrounding = content.slice(Math.max(0, offset - win), Math.min(content.length, offset + length + win));
  const matched = content.slice(offset, offset + length);
  const reasons: Record<Exclude<CitationMatchType, "NONE">, string> = {
    EXACT: "본문 내 인용 위치 확인 (정확 일치)",
    NORMALIZED: "본문 내 인용 위치 확인 (공백·구두점·호환 문자 정규화 후 일치)",
    VARIANT_FOLDED: "본문 내 인용 위치 확인 (이체자 동치 접기 후 일치 — 원문 자형 확인 필요)",
  };
  return {
    verified: true,
    offset,
    length,
    context: contextAround(content, offset, length),
    reason: reasons[matchType as Exclude<CitationMatchType, "NONE">],
    matchType,
    targetSpecificity: specificityFor(matched, surrounding, opts.target, opts.registry),
  };
}
