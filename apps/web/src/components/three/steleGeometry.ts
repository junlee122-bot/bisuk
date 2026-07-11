"use client";

import * as THREE from "three";
import type { GlyphCell } from "@seokmun/types";
import { hashString, mulberry32 } from "@seokmun/engine";

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

function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 결정적 격자 값 노이즈 — 가상 석재 표면 요철 */
function makeValueNoise(seed: number) {
  const cache = new Map<string, number>();
  const lattice = (ix: number, iy: number): number => {
    const key = `${ix},${iy}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = mulberry32(hashString(`${seed}:${key}`))();
      cache.set(key, v);
    }
    return v;
  };
  return (u: number, v: number): number => {
    const gu = u * 14;
    const gv = v * 40;
    const iu = Math.floor(gu);
    const iv = Math.floor(gv);
    const fu = gu - iu;
    const fv = gv - iv;
    const a = lattice(iu, iv);
    const b = lattice(iu + 1, iv);
    const c = lattice(iu, iv + 1);
    const d = lattice(iu + 1, iv + 1);
    const top = a + (b - a) * fu;
    const bottom = c + (d - c) * fu;
    return (top + (bottom - top) * fv) * 2 - 1;
  };
}

export interface SteleGeometryResult {
  geometry: THREE.BufferGeometry;
  albedoColors: THREE.BufferAttribute;
  depthColors: THREE.BufferAttribute;
}

/**
 * 가상 비석 지오메트리 — 장방형 슬래브 전면에 노이즈·글자 홈·균열을 새긴다.
 * 실제 유물 형상을 복제하지 않은 절차 생성 데모 모델이다.
 */
export function createSteleGeometry(
  params: MeshParams,
  cells: GlyphCell[],
  lod: "PREVIEW" | "MEDIUM" | "FULL" = "MEDIUM"
): SteleGeometryResult {
  const [gx, gy] = params.lodGrids?.[lod] ?? [48, 128];
  const geometry = new THREE.BoxGeometry(
    params.width,
    params.height,
    params.depth,
    gx,
    gy,
    1
  );
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const noise = makeValueNoise(params.noiseSeed);

  const count = pos.count;
  const albedo = new Float32Array(count * 3);
  const depthCol = new Float32Array(count * 3);
  const base = new THREE.Color("#8f8a7d");
  const engraveColor = new THREE.Color("#55503f");
  const crackColor = new THREE.Color("#3c382c");

  const cellStrokes = cells
    .filter((c) => c.strokes)
    .map((c) => ({
      bbox: c.bbox2d,
      observed: c.strokes!.polylines.filter(
        (_, i) => !c.strokes!.erodedStrokeIndexes.includes(i)
      ),
      eroded: c.strokes!.polylines.filter((_, i) =>
        c.strokes!.erodedStrokeIndexes.includes(i)
      ),
    }));

  for (let i = 0; i < count; i++) {
    const nz = normal.getZ(i);
    let color = base;
    let engrave = 0;
    if (nz > 0.9) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const u = x / params.width + 0.5;
      const v = 0.5 - y / params.height;
      engrave += Math.max(0, noise(u, v)) * params.noiseAmp;

      for (const cs of cellStrokes) {
        const [bx, by, bw, bh] = cs.bbox;
        if (u < bx - 0.01 || u > bx + bw + 0.01 || v < by - 0.01 || v > by + bh + 0.01)
          continue;
        const lx = ((u - bx) / bw) * 100;
        const ly = ((v - by) / bh) * 100;
        let minD = Infinity;
        let erodedD = Infinity;
        for (const line of cs.observed) {
          for (let s = 0; s + 1 < line.length; s++) {
            minD = Math.min(
              minD,
              distToSegment(lx, ly, line[s]![0], line[s]![1], line[s + 1]![0], line[s + 1]![1])
            );
          }
        }
        for (const line of cs.eroded) {
          for (let s = 0; s + 1 < line.length; s++) {
            erodedD = Math.min(
              erodedD,
              distToSegment(lx, ly, line[s]![0], line[s]![1], line[s + 1]![0], line[s + 1]![1])
            );
          }
        }
        if (minD < 5) {
          engrave += 0.02 * (1 - minD / 5);
          color = engraveColor;
        } else if (erodedD < 5) {
          engrave += 0.006 * (1 - erodedD / 5);
        }
      }

      if (params.crack) {
        const d = distToSegment(
          u, v,
          params.crack.from[0], params.crack.from[1],
          params.crack.to[0], params.crack.to[1]
        );
        if (d < params.crack.widthFrac) {
          engrave += params.crack.depth * (1 - d / params.crack.widthFrac);
          color = crackColor;
        }
      }
      pos.setZ(i, pos.getZ(i) - engrave);
    }
    albedo[i * 3] = color.r;
    albedo[i * 3 + 1] = color.g;
    albedo[i * 3 + 2] = color.b;
    const t = Math.min(1, engrave / 0.03);
    depthCol[i * 3] = 0.2 + 0.8 * t;
    depthCol[i * 3 + 1] = 0.25;
    depthCol[i * 3 + 2] = 1 - 0.8 * t;
  }
  geometry.computeVertexNormals();
  const albedoAttr = new THREE.BufferAttribute(albedo, 3);
  const depthAttr = new THREE.BufferAttribute(depthCol, 3);
  geometry.setAttribute("color", albedoAttr);
  return { geometry, albedoColors: albedoAttr, depthColors: depthAttr };
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
    // 위쪽은 반듯, 아래쪽이 파단면
    shape.moveTo(-w / 2, h / 2);
    shape.lineTo(w / 2, h / 2);
    for (let i = curve.length - 1; i >= 0; i--) {
      const [cx, cy] = curve[i]!;
      shape.lineTo(-w / 2 + cx * w, h / 2 - cy * h);
    }
    shape.closePath();
  } else {
    // 아래쪽은 반듯, 위쪽이 파단면
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

declare global {
  interface Window {
    __seokmunGl?: { active: number; created: number; disposed: number };
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
