"use client";

/**
 * (구) 절차 지오메트리 모듈 — 슬래브 생성은 features/high-fidelity-3d 로 이전됨.
 * 조각(Fragment) 지오메트리와 공용 유틸 재수출만 유지한다.
 */
import * as THREE from "three";

export { glCounter, webglSupported } from "@/features/high-fidelity-3d/geometryClient";

export interface MeshParams {
  width: number;
  height: number;
  depth: number;
  noiseSeed: number;
  noiseAmp: number;
  crack?: {
    from: [number, number];
    to: [number, number];
    depth: number;
    widthFrac: number;
  } | null;
  lodGrids?: Record<string, [number, number]>;
  breakEdge?: "TOP" | "BOTTOM";
  breakCurve?: Array<[number, number]>;
}

/** 파단면 곡선을 가진 가상 조각 지오메트리 (ExtrudeGeometry) */
export function createFragmentGeometry(params: MeshParams): THREE.BufferGeometry {
  const w = params.width;
  const h = params.height;
  const curve = params.breakCurve ?? [
    [0, 0.5],
    [1, 0.5],
  ];
  const shape = new THREE.Shape();
  if (params.breakEdge === "BOTTOM") {
    shape.moveTo(-w / 2, h / 2);
    shape.lineTo(w / 2, h / 2);
    for (let i = curve.length - 1; i >= 0; i--) {
      const [cx, cy] = curve[i]!;
      shape.lineTo(-w / 2 + cx * w, h / 2 - cy * h);
    }
    shape.closePath();
  } else {
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    for (let i = curve.length - 1; i >= 0; i--) {
      const [cx, cy] = curve[i]!;
      shape.lineTo(-w / 2 + cx * w, -h / 2 + (1 - cy) * h);
    }
    shape.closePath();
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: params.depth,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -params.depth / 2);
  return geometry;
}
