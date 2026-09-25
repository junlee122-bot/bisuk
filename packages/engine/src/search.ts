/**
 * 문헌 검색 — BM25 + 한자 unigram/bigram + 한글 어절·bigram + 이체자 확장.
 * 인메모리 인덱스이며, 의미 기반(임베딩) 검색은 아니다.
 * 한자 판별은 Unicode Script=Han (확장 B 이후 보조 평면 포함)으로 한다.
 */
import { VariantRegistry } from "./variants";

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

/** 데모 이체자/유사자 확장 테이블 (하위 호환 — 실제 확장은 VariantRegistry 사용) */
export const VARIANT_TABLE: Record<string, string[]> = {
  大: ["太"],
  太: ["大"],
  戶: ["戸", "尸"],
  戸: ["戶"],
};

const CJK_RE = /\p{Script=Han}/u;
const DEFAULT_REGISTRY = new VariantRegistry();
/** 이체자로 확장된 토큰의 가중치 — 정확 일치를 우선한다 */
export const VARIANT_TOKEN_WEIGHT = 0.6;

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

/** 질의 토큰 + 이체자 토큰 (한 글자·두 글자 한자 토큰을 확장) */
export function expandQueryTokens(tokens: string[], registry: VariantRegistry = DEFAULT_REGISTRY): string[] {
  return expandQueryTokensWeighted(tokens, registry).map((t) => t.token);
}

export function expandQueryTokensWeighted(
  tokens: string[],
  registry: VariantRegistry = DEFAULT_REGISTRY
): Array<{ token: string; weight: number }> {
  const out = new Map<string, number>();
  for (const t of tokens) out.set(t, 1);
  for (const t of tokens) {
    const chars = [...t];
    if (chars.length === 1) {
      for (const v of registry.expand(t)) if (!out.has(v)) out.set(v, VARIANT_TOKEN_WEIGHT);
    } else if (chars.length === 2 && chars.every((c) => CJK_RE.test(c))) {
      for (const a of registry.classOf(chars[0]!)) {
        for (const b of registry.classOf(chars[1]!)) {
          const v = a + b;
          if (!out.has(v)) out.set(v, VARIANT_TOKEN_WEIGHT);
        }
      }
    }
  }
  return [...out].map(([token, weight]) => ({ token, weight }));
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

  constructor(docs: SearchableDoc[], private registry: VariantRegistry = DEFAULT_REGISTRY) {
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
    const weighted = expandQueryTokensWeighted(tokenize(query), this.registry);
    if (weighted.length === 0) return [];
    const qTokens = weighted.map((w) => w.token);
    const k1 = 1.2;
    const b = 0.75;
    const N = this.docs.length;
    const hits: SearchHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const { token: t, weight } of weighted) {
        const f = doc.tf.get(t) ?? 0;
        if (f === 0) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score +=
          (weight * idf * f * (k1 + 1)) /
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
