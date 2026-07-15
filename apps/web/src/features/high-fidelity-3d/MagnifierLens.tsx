"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export const LENS_SIZE = 200; // px (스펙 §7.5: 160–240)

export interface MagnifierState {
  active: boolean;
  zoom: 2 | 4 | 8;
  /** 캔버스 좌표 (CSS px, 좌상단 기준) */
  x: number;
  y: number;
}

/** 렌즈 클램프 위치 계산 (분석 범례가 있는 하단을 피해 위로 오프셋) */
export function lensCenter(state: MagnifierState, width: number, height: number) {
  const cx = Math.min(width - LENS_SIZE / 2, Math.max(LENS_SIZE / 2, state.x));
  const cy = Math.min(height - LENS_SIZE / 2, Math.max(LENS_SIZE / 2, state.y - 24));
  return { cx, cy };
}

/**
 * 확대경 — priority 1 useFrame이 메인 렌더와 렌즈 scissor 렌더를 모두 수행
 * (R3F는 priority>0 구독이 있으면 자동 렌더를 끄므로 여기서 전체 렌더를 담당).
 * 활성일 때만 마운트할 것.
 * 렌즈는 항상 Evidence Mesh 기준: splat 표시 레이어를 숨기고 evidence 메시를
 * 강제 표시한 뒤 렌더한다 (측정·판독 기준 유지 — 표시 계층 전용 기능).
 */
export function MagnifierLens({ state }: { state: MagnifierState }) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const perspectiveLensCam = useRef<THREE.PerspectiveCamera | null>(null);
  const orthographicLensCam = useRef<THREE.OrthographicCamera | null>(null);

  useEffect(() => {
    invalidate();
    return () => invalidate();
  }, [state, invalidate]);

  useFrame(() => {
    // WebGLRenderer의 viewport/scissor API가 pixelRatio를 내부 적용하므로 CSS 픽셀을 전달한다.
    // 여기서 DPR을 다시 곱하면 Retina/고DPI에서 렌즈가 두 배로 어긋난다.
    // 1) 메인 렌더 (전체 뷰포트)
    gl.setViewport(0, 0, size.width, size.height);
    gl.render(scene, camera);

    // 2) 렌즈 렌더 — 포인터 주변 영역을 setViewOffset으로 확대 투영
    const { cx, cy } = lensCenter(state, size.width, size.height);
    const subW = LENS_SIZE / state.zoom;
    let lc: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      if (!perspectiveLensCam.current) perspectiveLensCam.current = new THREE.PerspectiveCamera();
      lc = perspectiveLensCam.current;
      lc.copy(camera as THREE.PerspectiveCamera);
    } else if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      if (!orthographicLensCam.current) orthographicLensCam.current = new THREE.OrthographicCamera();
      lc = orthographicLensCam.current;
      lc.copy(camera as THREE.OrthographicCamera);
    } else {
      return;
    }
    lc.setViewOffset(size.width, size.height, cx - subW / 2, cy - subW / 2, subW, subW);
    lc.updateProjectionMatrix();

    // Evidence 기준 강제
    const restore: Array<[THREE.Object3D, boolean]> = [];
    scene.traverse((o) => {
      if (o.userData.splatLayer || o.userData.presentationMesh) {
        restore.push([o, o.visible]);
        o.visible = false;
      } else if (o.userData.evidenceMesh) {
        restore.push([o, o.visible]);
        o.visible = true;
      }
    });

    const px = cx - LENS_SIZE / 2;
    const py = size.height - (cy + LENS_SIZE / 2); // GL 좌하단 기준
    const pw = LENS_SIZE;
    gl.setScissorTest(true);
    gl.setScissor(px, py, pw, pw);
    gl.setViewport(px, py, pw, pw);
    gl.render(scene, lc);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    lc.clearViewOffset();

    for (const [o, v] of restore) o.visible = v;
  }, 1);

  return null;
}
