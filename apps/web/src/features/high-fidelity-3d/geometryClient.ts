"use client";

/**
 * 클라이언트 지오메트리 — 엔진의 공유 높이장/메시 빌더 사용.
 * 서버 파생 GLB와 동일 수식이므로 클라이언트 생성 폴백과 서버 variant가 일치한다.
 */
import * as THREE from "three";
import type { GlyphCell, TabUiState } from "@seokmun/types";
import { buildSlabMesh, type MeshArrays, type SlabParams } from "@seokmun/engine";

export type { SlabParams };

export function meshArraysToGeometry(arrays: MeshArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(arrays.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(arrays.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(arrays.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  return geometry;
}

const LOD_GRIDS: Record<TabUiState["lodLevel"], [number, number]> = {
  PREVIEW: [24, 64],
  MEDIUM: [48, 128],
  FULL: [144, 384],
};

export interface ClientSlabBuild {
  geometry: THREE.BufferGeometry;
  albedo: THREE.BufferAttribute;
  /** 곡률(파임) false-color */
  curvature: THREE.BufferAttribute;
  /** 깊이(전면 z) false-color */
  depth: THREE.BufferAttribute;
  triangleCount: number;
  vertexCount: number;
  gpuBytesEstimate: number;
}

export function buildClientSlab(
  params: SlabParams,
  cells: GlyphCell[],
  lod: TabUiState["lodLevel"],
  cavityStrength: number
): ClientSlabBuild {
  const arrays = buildSlabMesh(params, cells, LOD_GRIDS[lod], { cavityStrength });
  const geometry = meshArraysToGeometry(arrays);
  const albedo = geometry.getAttribute("color") as THREE.BufferAttribute;

  const n = arrays.vertexCount;
  const curvatureArr = new Float32Array(n * 3);
  const depthArr = new Float32Array(n * 3);
  const zMax = params.depth / 2;
  const engraveScale = 0.035;
  for (let i = 0; i < n; i++) {
    const z = arrays.positions[i * 3 + 2]!;
    const front = z > 0;
    const engrave = front ? Math.max(0, zMax - z) : 0;
    const t = Math.min(1, engrave / engraveScale);
    // 곡률: 흰(평면) → 주황(홈)
    curvatureArr[i * 3] = 0.25 + 0.75 * t;
    curvatureArr[i * 3 + 1] = 0.3 + 0.25 * (1 - t);
    curvatureArr[i * 3 + 2] = 0.9 - 0.8 * t;
    // 깊이: 파랑(표면) → 빨강(깊음)
    depthArr[i * 3] = 0.15 + 0.85 * t;
    depthArr[i * 3 + 1] = 0.2;
    depthArr[i * 3 + 2] = 1.0 - 0.85 * t;
  }
  const gpuBytesEstimate =
    arrays.positions.byteLength +
    arrays.normals.byteLength +
    arrays.colors.byteLength +
    arrays.indices.byteLength +
    curvatureArr.byteLength; // 활성 색만 실제 업로드되나 상한 추정
  return {
    geometry,
    albedo,
    curvature: new THREE.BufferAttribute(curvatureArr, 3),
    depth: new THREE.BufferAttribute(depthArr, 3),
    triangleCount: arrays.triangleCount,
    vertexCount: arrays.vertexCount,
    gpuBytesEstimate,
  };
}

declare global {
  interface Window {
    __seokmunGl?: { active: number; created: number; disposed: number };
    __seokmunStats?: {
      fps: number;
      drawCalls: number;
      triangles: number;
      geometries: number;
      textures: number;
      gpuBytesEstimate: number;
    };
  }
}

export function glCounter() {
  if (typeof window === "undefined") return null;
  window.__seokmunGl ??= { active: 0, created: 0, disposed: 0 };
  return window.__seokmunGl;
}

export function webglSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}
