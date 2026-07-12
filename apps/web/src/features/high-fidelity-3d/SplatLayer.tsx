"use client";

import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

interface SplatData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  count: number;
}

function parseSplatBin(buf: ArrayBuffer): SplatData {
  const count = new Uint32Array(buf, 0, 1)[0]!;
  const positions = new Float32Array(buf, 4, count * 3);
  const colors = new Float32Array(buf, 4 + count * 12, count * 3);
  const sizes = new Float32Array(buf, 4 + count * 24, count);
  return { positions, colors, sizes, count };
}

const VERT = /* glsl */ `
attribute float size;
uniform float uScale;
uniform float uSizeFactor;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * uSizeFactor * uScale / -mv.z, 1.0, 64.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
uniform float uHardEdge;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float a = uHardEdge > 0.5 ? 1.0 : smoothstep(0.25, 0.03, r2);
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

/**
 * Point-splat 표시 레이어 (가상 데모) — 실감 표시 전용.
 * 측정·글자 선택은 항상 Evidence Mesh(피킹 평면)를 사용한다.
 * mode="POINTS"는 점군 뷰(불투명 소형 점).
 */
export function SplatLayer({
  assetId,
  mode,
  fraction,
  onStatus,
}: {
  assetId: string;
  mode: "SPLAT" | "POINTS";
  fraction: number;
  onStatus: (s: { loading: boolean; count: number | null; error: string | null }) => void;
}) {
  const { size, invalidate } = useThree();
  const [data, setData] = useState<SplatData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    onStatus({ loading: true, count: null, error: null });
    (async () => {
      try {
        const job = await fetch("/api/3d/splat/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetId }),
        });
        if (!job.ok) throw new Error(`splat 생성 실패 (${job.status})`);
        const { outputVariantIds } = (await job.json()) as { outputVariantIds: string[] };
        const binId = outputVariantIds[1] ?? outputVariantIds[0];
        const file = await fetch(`/api/3d/variants/${binId}/file`);
        if (!file.ok) throw new Error(`splat 파일 로딩 실패 (${file.status})`);
        const parsed = parseSplatBin(await file.arrayBuffer());
        if (cancelled) return;
        setData(parsed);
        onStatus({ loading: false, count: parsed.count, error: null });
        invalidate();
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        onStatus({ loading: false, count: null, error: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, onStatus, invalidate]);

  const visibleCount = data ? Math.floor(data.count * Math.min(1, fraction)) : 0;

  const geometry = useMemo(() => {
    if (!data || visibleCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(data.positions.subarray(0, visibleCount * 3), 3)
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(data.colors.subarray(0, visibleCount * 3), 3)
    );
    g.setAttribute("size", new THREE.BufferAttribute(data.sizes.subarray(0, visibleCount), 1));
    return g;
  }, [data, visibleCount]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      vertexColors: true,
      transparent: mode === "SPLAT",
      depthWrite: mode === "POINTS",
      uniforms: {
        uScale: { value: size.height },
        uSizeFactor: { value: mode === "SPLAT" ? 1.4 : 0.5 },
        uHardEdge: { value: mode === "POINTS" ? 1 : 0 },
      },
    });
  }, [mode, size.height]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);
  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  if (error || !geometry) return null;
  return <points geometry={geometry} material={material} />;
}
