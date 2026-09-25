/**
 * 재현성 — 분석 입력을 키 정렬 JSON으로 직렬화해 해시를 만들 수 있게 한다.
 * (해시 계산 자체는 node:crypto가 있는 API 쪽에서 한다 — 엔진은 브라우저 호환 유지)
 */
export const ENGINE_ANALYSIS_VERSION = "seokmun-engine/2.0.0";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (v instanceof Map) return sortDeep(Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), x])));
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] === undefined) continue;
      out[k] = sortDeep(o[k]);
    }
    return out;
  }
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}
