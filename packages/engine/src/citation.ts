/**
 * Citation Verifier — 인용 문자열이 실제 문서 본문에 존재하는지 확인하고
 * 위치·앞뒤 문맥을 기록한다. 검증 실패 인용은 자동 채택 근거가 될 수 없다.
 */
export interface CitationCheck {
  verified: boolean;
  offset: number | null;
  context: string;
  reason: string;
}

/** 인용 최소 길이 — 흔한 글자 한두 자로 '검증됨'을 만드는 우회를 막는다 */
export const MIN_QUOTE_LENGTH = 8;

export function verifyCitation(content: string, quote: string): CitationCheck {
  const trimmed = quote.trim();
  if (trimmed.length === 0) {
    return { verified: false, offset: null, context: "", reason: "빈 인용문" };
  }
  if ([...trimmed].length < MIN_QUOTE_LENGTH) {
    return {
      verified: false,
      offset: null,
      context: "",
      reason: `인용문이 너무 짧아 검증 불충분 (최소 ${MIN_QUOTE_LENGTH}자)`,
    };
  }
  const offset = content.indexOf(trimmed);
  if (offset < 0) {
    return {
      verified: false,
      offset: null,
      context: "",
      reason: "인용문이 문서 본문에 존재하지 않음",
    };
  }
  const before = content.slice(Math.max(0, offset - 40), offset);
  const after = content.slice(
    offset + trimmed.length,
    Math.min(content.length, offset + trimmed.length + 40)
  );
  return {
    verified: true,
    offset,
    context: `…${before}【${trimmed}】${after}…`,
    reason: "본문 내 인용 위치 확인",
  };
}
