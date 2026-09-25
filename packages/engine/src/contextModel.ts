/**
 * 문맥 모델 — 연구실이 확정한 판독문(행 단위 글자열)에서 학습한 글자 n-gram.
 * 후보 글자 c에 대해 앞 글자 p·뒤 글자 n이 주어졌을 때
 *   P(c | p) 과 P(n | c) 의 기하 평균(add-k 평활)을 문맥 점수로 쓴다.
 * 학습 글자 수가 MIN_CONTEXT_CORPUS_CHARS 미만이면 쓰지 않는다(파이프라인이 휴리스틱으로 대체하고 표시).
 * 숨김 벤치마크 정답·분석 대상 셀 자신의 판독은 학습에 넣지 말 것(호출자 책임).
 */
export const MIN_CONTEXT_CORPUS_CHARS = 200;

export class CharContextModel {
  private unigram = new Map<string, number>();
  private bigram = new Map<string, number>();
  private total = 0;
  constructor(sequences: string[][], private readonly k = 0.5) {
    for (const seq of sequences) {
      for (let i = 0; i < seq.length; i++) {
        const c = seq[i]!;
        if (!c) continue;
        this.unigram.set(c, (this.unigram.get(c) ?? 0) + 1);
        this.total++;
        const next = seq[i + 1];
        if (next) this.bigram.set(c + "\u0000" + next, (this.bigram.get(c + "\u0000" + next) ?? 0) + 1);
      }
    }
  }

  get totalChars(): number {
    return this.total;
  }

  get vocabularySize(): number {
    return this.unigram.size;
  }

  get usable(): boolean {
    return this.total >= MIN_CONTEXT_CORPUS_CHARS;
  }

  private cond(a: string, b: string): number {
    const v = this.unigram.size + 1;
    return ((this.bigram.get(a + "\u0000" + b) ?? 0) + this.k) / ((this.unigram.get(a) ?? 0) + this.k * v);
  }

  /** 원시 문맥 확률 (비교용, 0~1 작은 값) */
  probability(prev: string | null, candidate: string, next: string | null): number {
    const v = this.unigram.size + 1;
    const parts: number[] = [];
    if (prev) parts.push(this.cond(prev, candidate));
    if (next) parts.push(this.cond(candidate, next));
    if (parts.length === 0) return ((this.unigram.get(candidate) ?? 0) + this.k) / (this.total + this.k * v);
    return Math.exp(parts.reduce((s, p) => s + Math.log(p), 0) / parts.length);
  }

  /**
   * 후보 집합 안에서 상대 점수 (0.2~0.8) — 가장 그럴듯한 후보 0.8, 나머지는 비례.
   * 이웃 글자가 모두 없으면 0.5 균일(문맥 정보 없음).
   */
  scoreCandidates(prev: string | null, next: string | null, candidates: string[]): Map<string, number> {
    const out = new Map<string, number>();
    if (!prev && !next) {
      for (const c of candidates) out.set(c, 0.5);
      return out;
    }
    const probs = candidates.map((c) => [c, this.probability(prev, c, next)] as const);
    const max = Math.max(...probs.map(([, p]) => p), 1e-12);
    for (const [c, p] of probs) out.set(c, Math.round((0.2 + 0.6 * (p / max)) * 1000) / 1000);
    return out;
  }
}
