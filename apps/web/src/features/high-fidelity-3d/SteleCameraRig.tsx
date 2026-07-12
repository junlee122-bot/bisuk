"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { CameraMode, GlyphCell, TabUiState } from "@seokmun/types";
import type { SlabParams } from "./geometryClient";

type OrbitControlsImpl = {
  object: THREE.Camera;
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (e: string, cb: () => void) => void;
  removeEventListener: (e: string, cb: () => void) => void;
};

/**
 * 카메라 리그 — 관람(원근 fov32)/연구(정사영)/정면 입면/글자 포커스.
 * 글자 포커스는 부드럽게 이동하되 사용자 조작 즉시 중단.
 * near/far는 장면 스케일(≈2m)에 맞춰 depth 정밀도를 낭비하지 않는다.
 */
export interface FlyToRequest {
  position: [number, number, number];
  target: [number, number, number];
  /** 전환 시간(초) — 스펙 §7.2: 0.5–0.9 */
  duration?: number;
  /** 동일 포즈 재요청 구분용 시퀀스 */
  seq: number;
}

export function SteleCameraRig({
  mode,
  params,
  cells,
  selectedId,
  uiState,
  onCameraChange,
  flyTo,
}: {
  mode: CameraMode;
  params: SlabParams;
  cells: GlyphCell[];
  selectedId: string | null;
  uiState: TabUiState;
  onCameraChange: (camera: { position: [number, number, number]; target: [number, number, number] }) => void;
  flyTo?: FlyToRequest | null;
}) {
  const { invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const animRef = useRef<{
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
    t: number;
    duration: number;
  } | null>(null);

  const ortho = mode === "ORTHOGRAPHIC_RESEARCH" || mode === "FRONT_ELEVATION";
  const maxDim = Math.max(params.width, params.height, params.depth);
  // 기본 진입: ¾ 히어로 구도 — 약간 낮은 시점에서 올려봄 (무대 높이 62–78% 프레이밍)
  const savedPos = uiState.camera?.position ?? [1.7, -0.12, 4.55];
  const savedTarget = uiState.camera?.target ?? [0, 0.05, 0];

  // 글자 포커스: 선택 셀의 3D bounds → 카메라 target/거리 계산 → 부드러운 이동
  useEffect(() => {
    if (mode !== "GLYPH_FOCUS" || !selectedId || !controlsRef.current) return;
    const cell = cells.find((c) => c.id === selectedId);
    if (!cell) return;
    const [bx, by, bw, bh] = cell.bbox2d;
    const cx = (bx + bw / 2 - 0.5) * params.width;
    const cy = (0.5 - (by + bh / 2)) * params.height;
    const cz = params.depth / 2;
    const dist = Math.max(0.45, Math.max(bw * params.width, bh * params.height) * 2.6);
    const c = controlsRef.current;
    animRef.current = {
      fromPos: c.object.position.clone(),
      toPos: new THREE.Vector3(cx + dist * 0.25, cy + dist * 0.1, cz + dist),
      fromTarget: c.target.clone(),
      toTarget: new THREE.Vector3(cx, cy, cz),
      t: 0,
      duration: 0.6,
    };
    invalidate();
  }, [mode, selectedId, cells, params, invalidate]);

  // 프레젠테이션 북마크 flyTo — 500–900ms 감속, 사용자 입력 시 즉시 중단,
  // prefers-reduced-motion에서는 즉시 이동
  useEffect(() => {
    if (!flyTo || !controlsRef.current) return;
    const c = controlsRef.current;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (reduced) {
      c.object.position.set(...flyTo.position);
      c.target.set(...flyTo.target);
      c.update();
      invalidate();
      onCameraChange({ position: flyTo.position, target: flyTo.target });
      return;
    }
    animRef.current = {
      fromPos: c.object.position.clone(),
      toPos: new THREE.Vector3(...flyTo.position),
      fromTarget: c.target.clone(),
      toTarget: new THREE.Vector3(...flyTo.target),
      t: 0,
      duration: Math.min(0.9, Math.max(0.5, flyTo.duration ?? 0.7)),
    };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.seq]);

  // 사용자 조작 시 포커스 애니메이션 즉시 중단
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const cancel = () => {
      animRef.current = null;
    };
    c.addEventListener("start", cancel);
    return () => c.removeEventListener("start", cancel);
  }, []);

  useFrame((_, delta) => {
    const anim = animRef.current;
    const c = controlsRef.current;
    if (!anim || !c) return;
    anim.t = Math.min(1, anim.t + delta / anim.duration);
    const e = 1 - Math.pow(1 - anim.t, 3);
    c.object.position.lerpVectors(anim.fromPos, anim.toPos, e);
    c.target.lerpVectors(anim.fromTarget, anim.toTarget, e);
    c.update();
    invalidate();
    if (anim.t >= 1) {
      animRef.current = null;
      const p = c.object.position;
      const t = c.target;
      onCameraChange({ position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] });
    }
  });

  const frontPos: [number, number, number] = [0, 0, maxDim * 1.6];

  return (
    <>
      {ortho ? (
        <OrthographicCamera
          makeDefault
          position={mode === "FRONT_ELEVATION" ? frontPos : (savedPos as [number, number, number])}
          zoom={mode === "FRONT_ELEVATION" ? 330 / maxDim : 300 / maxDim}
          near={0.01}
          far={maxDim * 12}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          position={savedPos as [number, number, number]}
          fov={mode === "GLYPH_FOCUS" ? 25 : 32}
          near={0.01}
          far={maxDim * 25}
        />
      )}
      <OrbitControls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={controlsRef as any}
        target={mode === "FRONT_ELEVATION" ? [0, 0, 0] : (savedTarget as [number, number, number])}
        enableDamping={false}
        enableRotate={mode !== "FRONT_ELEVATION"}
        makeDefault
        onEnd={() => {
          const c = controlsRef.current;
          if (!c) return;
          const p = c.object.position;
          const t = c.target;
          onCameraChange({ position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] });
        }}
      />
    </>
  );
}
