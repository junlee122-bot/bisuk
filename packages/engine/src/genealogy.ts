/**
 * 출처 계보 — 같은 판독을 재인용한 문서를 독립 근거로 세지 않는다.
 * v2: independenceGroup이 같거나 derivedFrom 사슬로 이어지면 하나의 계보로 병합한다
 * (주석자가 다른 그룹을 붙였더라도 파생 관계가 있으면 독립이 아니다).
 */
export interface GenealogyDoc {
  id: string;
  title: string;
  independenceGroup: string;
  derivedFromDocumentId: string | null;
  reliabilityTier: number;
}

export interface LineageGroup {
  /** 대표 그룹명 (병합된 그룹 중 사전순 첫째) */
  independenceGroup: string;
  /** derivedFrom 사슬로 병합된 모든 그룹 */
  mergedGroups: string[];
  documentIds: string[];
  rootDocumentId: string | null;
  titles: string[];
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
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
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

/**
 * 문서 id → 계보 키. universe에 있는 조상 문서까지 따라가 파생 관계를 병합한다.
 * universe를 주지 않으면 docs 안에서만 판단한다(조상이 목록 밖이면 같은 조상을 가리키는 문서끼리만 병합).
 */
export function lineageKeys(docs: GenealogyDoc[], universe: GenealogyDoc[] = docs): Map<string, string> {
  const uf = new UnionFind();
  const all = new Map<string, GenealogyDoc>();
  for (const d of [...universe, ...docs]) all.set(d.id, d);
  for (const d of all.values()) {
    uf.union(`doc:${d.id}`, `group:${d.independenceGroup}`);
    if (d.derivedFromDocumentId) uf.union(`doc:${d.id}`, `doc:${d.derivedFromDocumentId}`);
  }
  const out = new Map<string, string>();
  for (const d of docs) out.set(d.id, uf.find(`doc:${d.id}`));
  return out;
}

export function buildLineages(docs: GenealogyDoc[], universe: GenealogyDoc[] = docs): LineageGroup[] {
  const keys = lineageKeys(docs, universe);
  const groups = new Map<string, GenealogyDoc[]>();
  for (const d of docs) {
    const k = keys.get(d.id)!;
    const list = groups.get(k) ?? [];
    list.push(d);
    groups.set(k, list);
  }
  const out: LineageGroup[] = [];
  for (const members of groups.values()) {
    const merged = [...new Set(members.map((m) => m.independenceGroup))].sort();
    const roots = members
      .filter((m) => m.derivedFromDocumentId === null)
      .sort((a, b) => a.reliabilityTier - b.reliabilityTier || a.id.localeCompare(b.id));
    out.push({
      independenceGroup: merged[0]!,
      mergedGroups: merged,
      documentIds: members.map((m) => m.id).sort(),
      rootDocumentId: roots[0]?.id ?? null,
      titles: members.map((m) => m.title),
    });
  }
  out.sort((a, b) => a.independenceGroup.localeCompare(b.independenceGroup));
  return out;
}

/** 검증된 지지 근거 문서 집합에서 독립 계보 수 계산 */
export function countIndependentLineages(docs: GenealogyDoc[], universe: GenealogyDoc[] = docs): number {
  return new Set(lineageKeys(docs, universe).values()).size;
}

/**
 * 1차 또는 직접 판독 출처 수 — 계보의 뿌리 문서이면서
 * 신뢰 계층이 3 이하(기관/동료평가/조사보고서)인 문서.
 */
export function countVerifiedPrimaryOrDirect(docs: GenealogyDoc[]): number {
  return new Set(
    docs
      .filter((d) => d.derivedFromDocumentId === null && d.reliabilityTier <= 3)
      .map((d) => d.id)
  ).size;
}
