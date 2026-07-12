import { describe, expect, it } from "vitest";
import {
  chooseLodLevel,
  LOD_ENTER_PX,
  LOD_EXIT_PX,
  screenSpaceHeightPx,
  type AutoLodInput,
  type LodLevel,
} from "../src/autoLod";

const RANK: Record<LodLevel, number> = { PREVIEW: 0, MEDIUM: 1, FULL: 2 };

function persp(distance: number, currentLod: LodLevel = "MEDIUM"): AutoLodInput {
  return {
    currentLod,
    projection: "perspective",
    distance,
    fovDeg: 32,
    viewportHeightPx: 900,
    modelHeight: 2,
  };
}

describe("자동 LOD — 화면 공간 오차 + 히스테리시스", () => {
  it("가까워질수록(거리 감소) LOD가 절대 낮아지지 않는다 (단조성)", () => {
    let lod: LodLevel = "PREVIEW";
    let prevRank = 0;
    // 12 → 0.4 world 단위로 접근
    for (let d = 12; d >= 0.4; d -= 0.1) {
      lod = chooseLodLevel({ ...persp(d, lod) });
      expect(RANK[lod]).toBeGreaterThanOrEqual(prevRank);
      prevRank = RANK[lod];
    }
    expect(lod).toBe("FULL");
  });

  it("멀어질수록 강등되며 PREVIEW까지 내려간다", () => {
    let lod: LodLevel = "FULL";
    for (let d = 0.5; d <= 30; d += 0.25) {
      lod = chooseLodLevel({ ...persp(d, lod) });
    }
    expect(lod).toBe("PREVIEW");
  });

  it("경계 바로 주변을 왕복해도 진동하지 않는다 (히스테리시스 밴드)", () => {
    // FULL enter 임계값 근처 거리 계산
    const halfFov = (32 * Math.PI) / 360;
    const distAtPx = (px: number) => (2 * 900) / (2 * Math.tan(halfFov) * px);
    const enterD = distAtPx(LOD_ENTER_PX.FULL);
    // FULL 진입
    let lod = chooseLodLevel(persp(enterD * 0.98, "MEDIUM"));
    expect(lod).toBe("FULL");
    // enter와 exit 사이 밴드에서 흔들림 → FULL 유지 (강등 없음)
    const bandD = distAtPx((LOD_ENTER_PX.FULL + LOD_EXIT_PX.FULL) / 2);
    const flips: LodLevel[] = [];
    for (let i = 0; i < 20; i++) {
      const jitter = i % 2 === 0 ? 0.99 : 1.01;
      lod = chooseLodLevel({ ...persp(bandD * jitter, lod) });
      flips.push(lod);
    }
    expect(new Set(flips).size).toBe(1);
    expect(flips[0]).toBe("FULL");
  });

  it("정사영: zoom이 커지면(확대) 승급한다", () => {
    const ortho = (zoom: number, currentLod: LodLevel): AutoLodInput => ({
      currentLod,
      projection: "orthographic",
      distance: 5, // 정사영에서는 무시
      fovDeg: 32,
      viewportHeightPx: 900,
      modelHeight: 2,
      orthoZoom: zoom,
    });
    expect(chooseLodLevel(ortho(100, "PREVIEW"))).toBe("PREVIEW");
    expect(chooseLodLevel(ortho(LOD_ENTER_PX.MEDIUM / 2 + 1, "PREVIEW"))).toBe("MEDIUM");
    expect(chooseLodLevel(ortho(LOD_ENTER_PX.FULL / 2 + 1, "MEDIUM"))).toBe("FULL");
    // 히스테리시스: exit 위에서는 FULL 유지
    expect(chooseLodLevel(ortho(LOD_EXIT_PX.FULL / 2 + 1, "FULL"))).toBe("FULL");
  });

  it("선택 글자 포커스 중에는 거리와 무관하게 FULL", () => {
    expect(chooseLodLevel({ ...persp(30, "PREVIEW"), glyphFocused: true })).toBe("FULL");
  });

  it("screenSpaceHeightPx: 거리 반비례 (perspective)", () => {
    const near = screenSpaceHeightPx(persp(2));
    const far = screenSpaceHeightPx(persp(4));
    expect(near / far).toBeCloseTo(2, 5);
  });
});
