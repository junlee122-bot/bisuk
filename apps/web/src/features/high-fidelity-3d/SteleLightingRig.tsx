"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { LightingPreset } from "@seokmun/types";
import { azimuthElevationToDirection, LIGHTING_PRESETS } from "./presets";

export type ToneMappingChoice = "ACES" | "AGX" | "NEUTRAL";

const TONE_MAPPING: Record<ToneMappingChoice, THREE.ToneMapping> = {
  ACES: THREE.ACESFilmicToneMapping,
  AGX: THREE.AgXToneMapping,
  NEUTRAL: THREE.NeutralToneMapping,
};

/** 프리셋 전환 보간 시간 (스펙 §5: 180–320ms) */
const PRESET_LERP_S = 0.24;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * 조명 리그 — 중성 IBL(RoomEnvironment, 외부 HDRI 불필요·라이선스 명확) + 프리셋 라이트.
 * HDRI가 실제 촬영지를 재현한다고 주장하지 않는다.
 * 캔버스는 투명(scene.background = null) — 무대 배경은 CSS cyclorama가 담당한다.
 * 프리셋 전환은 강도만 180–320ms 보간(표시 계층 전용, Evidence 데이터 불변).
 */
export function SteleLightingRig({
  preset,
  azimuthDeg,
  elevationDeg,
  exposure,
  shadowMapSize,
  sweep,
  groundY,
  toneMapping = "ACES",
}: {
  preset: LightingPreset;
  azimuthDeg: number;
  elevationDeg: number;
  exposure: number;
  shadowMapSize: number;
  sweep: boolean;
  groundY: number;
  toneMapping?: ToneMappingChoice;
}) {
  const { gl, scene, invalidate } = useThree();
  const config = LIGHTING_PRESETS[preset];
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);
  const sweepAngle = useRef(0);
  // 보간 상태 — 현재 적용값 (프리셋 전환 시 목표로 수렴)
  const animRef = useRef({
    env: config.envIntensity,
    exposure: exposure * config.exposure,
    key: config.key?.intensity ?? 0,
    rim: config.rim?.intensity ?? 0,
    settled: true,
  });

  // 중성 환경광 (PMREM) — 렌더러당 1회 생성
  const envTexture = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);

  useEffect(() => () => envTexture.dispose(), [envTexture]);

  useEffect(() => {
    gl.toneMapping = TONE_MAPPING[toneMapping];
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = shadowMapSize > 0 && Boolean(config.key?.castShadow);
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.environment = config.envIntensity > 0 ? envTexture : null;
    // 투명 캔버스 — 배경은 CSS 무대가 담당 (검은 clear color 금지)
    scene.background = null;
    if (prefersReducedMotion()) {
      animRef.current = {
        env: config.envIntensity,
        exposure: exposure * config.exposure,
        key: config.key?.intensity ?? 0,
        rim: config.rim?.intensity ?? 0,
        settled: true,
      };
      scene.environmentIntensity = config.envIntensity;
      gl.toneMappingExposure = exposure * config.exposure;
    } else {
      animRef.current.settled = false;
    }
    invalidate();
  }, [gl, scene, config, exposure, envTexture, shadowMapSize, toneMapping, invalidate]);

  const keyPosition = useMemo<[number, number, number]>(() => {
    if (config.raking) return azimuthElevationToDirection(azimuthDeg, elevationDeg, 4);
    return [2.2, 3.0, 3.5];
  }, [config.raking, azimuthDeg, elevationDeg]);

  // 프리셋 전환 보간 + sweep 회전
  useFrame((_, delta) => {
    const anim = animRef.current;
    if (!anim.settled) {
      // 지수 보간은 긴 프레임에서도 계수가 1을 넘지 않아 발산하지 않는다.
      // 기존 `step * 3`은 delta >= 160ms에서 오차를 키워 demand 렌더를 무한 반복했다.
      const frameDelta = Math.min(Math.max(delta, 0), 0.1);
      const alpha = 1 - Math.exp((-3 * frameDelta) / PRESET_LERP_S);
      const targets = {
        env: config.envIntensity,
        exposure: exposure * config.exposure,
        key: config.key?.intensity ?? 0,
        rim: config.rim?.intensity ?? 0,
      };
      let maxDiff = 0;
      for (const k of ["env", "exposure", "key", "rim"] as const) {
        anim[k] += (targets[k] - anim[k]) * alpha;
        maxDiff = Math.max(maxDiff, Math.abs(targets[k] - anim[k]));
      }
      if (maxDiff < 0.004) {
        Object.assign(anim, targets, { settled: true });
      }
      scene.environmentIntensity = anim.env;
      gl.toneMappingExposure = anim.exposure;
      if (keyRef.current) keyRef.current.intensity = anim.key;
      if (rimRef.current) rimRef.current.intensity = anim.rim;
      invalidate();
    }
    if (sweep && keyRef.current) {
      sweepAngle.current += delta * 40; // 도/초
      const az = (azimuthDeg + sweepAngle.current) % 360;
      const p = azimuthElevationToDirection(az, elevationDeg, 4);
      keyRef.current.position.set(p[0], p[1], p[2]);
      invalidate();
    }
  });

  return (
    <group>
      {config.key && (
        <directionalLight
          ref={keyRef}
          position={keyPosition}
          intensity={config.key.intensity}
          color={config.key.color}
          castShadow={shadowMapSize > 0 && config.key.castShadow}
          shadow-mapSize-width={Math.max(256, shadowMapSize)}
          shadow-mapSize-height={Math.max(256, shadowMapSize)}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-camera-near={0.5}
          shadow-camera-far={12}
          shadow-camera-left={-2.5}
          shadow-camera-right={2.5}
          shadow-camera-top={2.5}
          shadow-camera-bottom={-2.5}
        />
      )}
      {config.fill && (
        <directionalLight position={config.fill.position} intensity={config.fill.intensity} />
      )}
      {config.rim && (
        <directionalLight
          ref={rimRef}
          position={config.rim.position}
          intensity={config.rim.intensity}
          color={config.rim.color}
        />
      )}
      {/* 접지 그림자 판 — 중성, 반투명 (표시 전용) */}
      {shadowMapSize > 0 && config.key?.castShadow && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY + 0.002, 0]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <shadowMaterial opacity={0.32} />
        </mesh>
      )}
    </group>
  );
}
