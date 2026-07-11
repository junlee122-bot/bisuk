/**
 * 출처 계보 — 같은 판독을 재인용한 문서를 독립 근거로 세지 않는다.
 * independenceGroup 이 같으면 하나의 계보로 병합한다.
 */
export interface GenealogyDoc {
  id: string;
  title: string;
  independenceGroup: string;
  derivedFromDocumentId: string | null;
  reliabilityTier: number;
}

export interface LineageGroup {
  independenceGroup: string;
  documentIds: string[];
  rootDocumentId: string | null;
  titles: string[];
}

export function buildLineages(docs: GenealogyDoc[]): LineageGroup[] {
  const groups = new Map<string, GenealogyDoc[]>();
  for (const d of docs) {
    const list = groups.get(d.independenceGroup) ?? [];
    list.push(d);
    groups.set(d.independenceGroup, list);
  }
  const out: LineageGroup[] = [];
  for (const [group, members] of groups) {
    const root = members.find((m) => m.derivedFromDocumentId === null) ?? null;
    out.push({
      independenceGroup: group,
      documentIds: members.map((m) => m.id).sort(),
      rootDocumentId: root?.id ?? null,
      titles: members.map((m) => m.title),
    });
  }
  out.sort((a, b) => a.independenceGroup.localeCompare(b.independenceGroup));
  return out;
}

/** 검증된 지지 근거 문서 집합에서 독립 계보 수 계산 */
export function countIndependentLineages(docs: GenealogyDoc[]): number {
  return new Set(docs.map((d) => d.independenceGroup)).size;
}

/**
 * 1차 또는 직접 판독 출처 수 — 계보의 뿌리 문서이면서
 * 신뢰 계층이 3 이하(기관/동료평가/조사보고서)인 문서.
 */
export function countVerifiedPrimaryOrDirect(docs: GenealogyDoc[]): number {
  return docs.filter(
    (d) => d.derivedFromDocumentId === null && d.reliabilityTier <= 3
  ).length;
}
