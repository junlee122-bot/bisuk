"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { LightingPreset } from "@seokmun/types";
import { azimuthElevationToDirection, LIGHTING_PRESETS } from "./presets";

/**
 * 조명 리그 — 중성 IBL(RoomEnvironment, 외부 HDRI 불필요·라이선스 명확) + 프리셋 라이트.
 * HDRI가 실제 촬영지를 재현한다고 주장하지 않는다.
 */
export function SteleLightingRig({
  preset,
  azimuthDeg,
  elevationDeg,
  exposure,
  shadowMapSize,
  sweep,
  groundY,
}: {
  preset: LightingPreset;
  azimuthDeg: number;
  elevationDeg: number;
  exposure: number;
  shadowMapSize: number;
  sweep: boolean;
  groundY: number;
}) {
  const { gl, scene, invalidate } = useThree();
  const config = LIGHTING_PRESETS[preset];
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const sweepAngle = useRef(0);

  // 중성 환경광 (PMREM) — 렌더러당 1회 생성
  const envTexture = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);

  useEffect(() => () => envTexture.dispose(), [envTexture]);

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure * config.exposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = shadowMapSize > 0 && Boolean(config.key?.castShadow);
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.environment = config.envIntensity > 0 ? envTexture : null;
    scene.environmentIntensity = config.envIntensity;
    scene.background = new THREE.Color(config.background);
    invalidate();
  }, [gl, scene, config, exposure, envTexture, shadowMapSize, invalidate]);

  const keyPosition = useMemo<[number, number, number]>(() => {
    if (config.raking) return azimuthElevationToDirection(azimuthDeg, elevationDeg, 4);
    return [2.2, 3.0, 3.5];
  }, [config.raking, azimuthDeg, elevationDeg]);

  // Cross-light sweep — 프레임마다 방위각 회전 (사용자 프리셋일 때만)
  useFrame((_, delta) => {
    if (!sweep || !keyRef.current) return;
    sweepAngle.current += delta * 40; // 도/초
    const az = (azimuthDeg + sweepAngle.current) % 360;
    const p = azimuthElevationToDirection(az, elevationDeg, 4);
    keyRef.current.position.set(p[0], p[1], p[2]);
    invalidate();
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
      {/* 접지 그림자 판 — 중성, 반투명 */}
      {shadowMapSize > 0 && config.key?.castShadow && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY, 0]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <shadowMaterial opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}
