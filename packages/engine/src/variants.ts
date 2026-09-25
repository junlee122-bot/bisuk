/**
 * 이체자(異體字) 레지스트리 — 같은 글자의 다른 자형을 동치류로 묶는다.
 * 쌍 목록(VariantPair)에서 union-find로 동치류를 만들고,
 * 검색 확장·후보 묶기·인용 검증 정규화에 쓴다.
 * 자료원: 연구실이 직접 내려받은 Unicode Unihan_Variants.txt 또는 사용자 등록 쌍 (자동 수집 없음).
 */
import type { VariantPair } from "@seokmun/types";

/** 데모 기본 쌍 — 실제 연구에서는 Unihan·연구실 목록으로 확장한다 */
export const DEFAULT_VARIANT_PAIRS: VariantPair[] = [
  { a: "大", b: "太", kind: "DEMO_SIMILAR", source: "demo" },
  { a: "戶", b: "戸", kind: "DEMO_SIMILAR", source: "demo" },
  { a: "戶", b: "尸", kind: "DEMO_SIMILAR", source: "demo" },
];

function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class VariantRegistry {
  private parent = new Map<string, string>();
  private members = new Map<string, Set<string>>();

  constructor(pairs: VariantPair[] = DEFAULT_VARIANT_PAIRS) {
    for (const p of pairs) this.union(p.a, p.b);
  }

  private find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (c !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }

  union(a: string, b: string): void {
    if (!a || !b || a === b) return;
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // 대표자는 코드포인트가 작은 쪽 (결정적)
    const [root, child] = codePointCompare(ra, rb) <= 0 ? [ra, rb] : [rb, ra];
    this.parent.set(child, root);
    const set = this.members.get(root) ?? new Set([root]);
    for (const m of this.members.get(child) ?? new Set([child])) set.add(m);
    set.add(child);
    this.members.set(root, set);
    this.members.delete(child);
  }

  /** 동치류 대표 글자 */
  representative(ch: string): string {
    return this.parent.has(ch) ? this.find(ch) : ch;
  }

  /** 같은 동치류의 모든 글자 (자기 포함) */
  classOf(ch: string): string[] {
    if (!this.parent.has(ch)) return [ch];
    return [...(this.members.get(this.find(ch)) ?? new Set([ch]))].sort(codePointCompare);
  }

  areVariants(a: string, b: string): boolean {
    return a === b || (this.parent.has(a) && this.parent.has(b) && this.find(a) === this.find(b));
  }

  /** 검색 확장용 — 자기 자신을 뺀 이체자 */
  expand(ch: string): string[] {
    return this.classOf(ch).filter((c) => c !== ch);
  }

  /** 문자열 안의 한자를 대표자로 접는다 (인용 검증 정규화용) */
  fold(text: string): string {
    return Array.from(text)
      .map((c) => this.representative(c))
      .join("");
  }

  get size(): number {
    return this.parent.size;
  }
}

const UNIHAN_KINDS = new Set([
  "kTraditionalVariant",
  "kSimplifiedVariant",
  "kZVariant",
  "kSemanticVariant",
  "kSpecializedSemanticVariant",
]);

function cp(token: string): string | null {
  const m = /^U\+([0-9A-F]{4,6})$/i.exec(token.split("<")[0]!.trim());
  return m ? String.fromCodePoint(parseInt(m[1]!, 16)) : null;
}

/**
 * Unihan_Variants.txt 파서 — "U+5927\tkSemanticVariant\tU+592A<kMatthews U+4EA3" 형식.
 * 주석(#)·빈 줄은 무시하고, 소스 태그(<kMatthews 등)는 떼어 낸다.
 */
export function parseUnihanVariants(text: string): { pairs: VariantPair[]; skipped: number } {
  const pairs: VariantPair[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [src, kind, value] = line.split("\t");
    if (!src || !kind || !value || !UNIHAN_KINDS.has(kind)) {
      skipped++;
      continue;
    }
    const a = cp(src);
    if (!a) {
      skipped++;
      continue;
    }
    for (const tok of value.split(/\s+/)) {
      const b = cp(tok);
      if (b && b !== a) pairs.push({ a, b, kind, source: "Unihan" });
    }
  }
  return { pairs, skipped };
}
