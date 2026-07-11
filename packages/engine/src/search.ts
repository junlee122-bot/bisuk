/**
 * 하이브리드 문헌 검색 — BM25 + CJK 문자 unigram/bigram + 이체자 확장.
 * P0에서는 인메모리 인덱스로 동작하며 PostgreSQL FTS 이전을 전제로 인터페이스를 유지한다.
 */

export interface SearchableDoc {
  id: string;
  title: string;
  content: string;
}

export interface SearchHit {
  id: string;
  score: number;
  matchOffsets: number[];
  snippet: string;
}

/** 데모 이체자/유사자 확장 테이블 */
export const VARIANT_TABLE: Record<string, string[]> = {
  大: ["太"],
  太: ["大"],
  戶: ["戸", "尸"],
  戸: ["戶"],
};

const CJK_RE = /[㐀-鿿豈-﫿]/;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const words = text.split(/[\s.,;:!?()\[\]{}"'·、。「」『』\-]+/).filter(Boolean);
  for (const word of words) {
    const chars = [...word];
    let hangulBuf = "";
    const flushHangul = () => {
      if (hangulBuf.length > 0) {
        tokens.push(hangulBuf);
        // 한글 bigram — 조사 변형에 강한 부분 일치
        for (let i = 0; i + 1 < hangulBuf.length; i++) {
          tokens.push(hangulBuf.slice(i, i + 2));
        }
        hangulBuf = "";
      }
    };
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      if (CJK_RE.test(ch)) {
        flushHangul();
        tokens.push(ch);
        if (i + 1 < chars.length && CJK_RE.test(chars[i + 1]!)) {
          tokens.push(ch + chars[i + 1]!);
        }
      } else {
        hangulBuf += ch;
      }
    }
    flushHangul();
  }
  return tokens;
}

export function expandQueryTokens(tokens: string[]): string[] {
  const out = [...tokens];
  for (const t of tokens) {
    const variants = VARIANT_TABLE[t];
    if (variants) out.push(...variants);
  }
  return [...new Set(out)];
}

interface IndexedDoc {
  id: string;
  length: number;
  tf: Map<string, number>;
  raw: SearchableDoc;
}

export class Bm25Index {
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(docs: SearchableDoc[]) {
    for (const d of docs) {
      const tokens = tokenize(`${d.title} ${d.content}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, length: tokens.length, tf, raw: d });
    }
    this.avgLen =
      this.docs.length > 0
        ? this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length
        : 0;
  }

  search(query: string, limit = 10): SearchHit[] {
    const qTokens = expandQueryTokens(tokenize(query));
    if (qTokens.length === 0) return [];
    const k1 = 1.2;
    const b = 0.75;
    const N = this.docs.length;
    const hits: SearchHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const t of qTokens) {
        const f = doc.tf.get(t) ?? 0;
        if (f === 0) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score +=
          (idf * f * (k1 + 1)) /
          (f + k1 * (1 - b + (b * doc.length) / Math.max(1, this.avgLen)));
      }
      if (score <= 0) continue;
      const offsets: number[] = [];
      for (const t of qTokens) {
        if ([...t].length > 2) continue;
        const idx = doc.raw.content.indexOf(t);
        if (idx >= 0) offsets.push(idx);
      }
      offsets.sort((a, c) => a - c);
      const first = offsets[0] ?? 0;
      const snippet = doc.raw.content.slice(
        Math.max(0, first - 40),
        Math.min(doc.raw.content.length, first + 80)
      );
      hits.push({ id: doc.id, score, matchOffsets: offsets, snippet });
    }
    hits.sort((a, c) => c.score - a.score || a.id.localeCompare(c.id));
    return hits.slice(0, limit);
  }
}
