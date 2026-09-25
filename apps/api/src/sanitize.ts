import type { GlyphCell as GlyphCellEntity } from "@seokmun/types";

/**
 * 숨김 벤치마크 셀은 마모(eroded) 획 좌표를 API 밖으로 내보내지 않는다.
 * 전체 자형이 노출되면 클라이언트가 자형 참조표 대조만으로 정답을 복원할 수 있다.
 */
export function sanitizeCell(stored: { entity: GlyphCellEntity; extra: { hiddenBenchmark?: boolean } }): GlyphCellEntity {
  if (!stored.extra.hiddenBenchmark || !stored.entity.strokes) return stored.entity;
  const eroded = new Set(stored.entity.strokes.erodedStrokeIndexes);
  return {
    ...stored.entity,
    strokes: {
      polylines: stored.entity.strokes.polylines.filter((_, i) => !eroded.has(i)),
      erodedStrokeIndexes: [],
    },
  };
}

