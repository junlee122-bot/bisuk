"use client";

import type { SlabParams } from "./geometryClient";

const NO_RAYCAST = () => null;

/**
 * 전시 무대 소품 — 프레젠테이션 바닥 + 낮은 받침대(플린스).
 * PRESENTATION_STAGE_ONLY: 비석 Evidence 자산과 별도 노드이며
 * 피킹(raycast 무효화)·측정·곡률·깊이 분석 대상에서 제외된다.
 * 전시 보기(EXHIBITION)에서만 장착 — 연구 보기는 중립 무대만 사용.
 */
export function PresentationStage({
  params,
  includePlinth = true,
}: {
  params: SlabParams;
  includePlinth?: boolean;
}) {
  const groundY = -params.height / 2;
  const floorY = groundY - (includePlinth ? 0.145 : 0.01);
  return (
    <group userData={{ provenance: "PRESENTATION_STAGE_ONLY" }}>
      {/* 플린스 — 비석 발치보다 살짝 넓은 낮은 석재 받침 */}
      {includePlinth && (
        <mesh raycast={NO_RAYCAST} position={[0, groundY - 0.075, 0]} receiveShadow>
          <boxGeometry args={[params.width + 0.55, 0.14, params.depth + 0.5]} />
          <meshStandardMaterial color="#cdc5b6" roughness={0.92} metalness={0} />
        </mesh>
      )}
      {/* 프레젠테이션 바닥 — 넓은 원반, 접지 그림자 수신 */}
      <mesh
        raycast={NO_RAYCAST}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, floorY, 0]}
        receiveShadow
      >
        <circleGeometry args={[4.5, 48]} />
        <meshStandardMaterial color="#ded6c8" roughness={0.96} metalness={0} />
      </mesh>
    </group>
  );
}
