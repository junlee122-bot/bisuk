"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GlyphCell, SteleAsset, TabUiState } from "@seokmun/types";
import { DemoBadge } from "@/components/badges";
import {
  createSteleGeometry,
  glCounter,
  webglSupported,
  type MeshParams,
} from "./steleGeometry";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";

type RenderMode = TabUiState["renderMode"];
type LodLevel = TabUiState["lodLevel"];

function SteleMesh({
  params,
  cells,
  lod,
  renderMode,
  selectedId,
  onSelect,
}: {
  params: MeshParams;
  cells: GlyphCell[];
  lod: LodLevel;
  renderMode: RenderMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const built = useMemo(
    () => createSteleGeometry(params, cells, lod),
    [params, cells, lod]
  );
  useEffect(() => {
    const g = built.geometry;
    return () => g.dispose();
  }, [built]);

  useEffect(() => {
    built.geometry.setAttribute(
      "color",
      renderMode === "CURVATURE" ? built.depthColors : built.albedoColors
    );
    built.geometry.attributes.color!.needsUpdate = true;
  }, [renderMode, built]);

  const zFace = params.depth / 2 + 0.004;
  return (
    <group>
      <mesh geometry={built.geometry}>
        {renderMode === "NORMAL" ? (
          <meshNormalMaterial />
        ) : (
          <meshStandardMaterial
            vertexColors
            roughness={0.92}
            metalness={0.02}
            flatShading={renderMode === "CURVATURE"}
          />
        )}
      </mesh>
      {cells.map((cell) => {
        const [bx, by, bw, bh] = cell.bbox2d;
        const cx = (bx + bw / 2 - 0.5) * params.width;
        const cy = (0.5 - (by + bh / 2)) * params.height;
        const selected = cell.id === selectedId;
        return (
          <group key={cell.id} position={[cx, cy, zFace]}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onSelect(cell.id);
              }}
            >
              <planeGeometry args={[bw * params.width, bh * params.height]} />
              <meshBasicMaterial
                transparent
                opacity={selected ? 0.28 : 0.001}
                color={selected ? "#d3a95f" : "#ffffff"}
                depthWrite={false}
              />
            </mesh>
            {selected && (
              <lineSegments>
                <edgesGeometry
                  args={[new THREE.PlaneGeometry(bw * params.width, bh * params.height)]}
                />
                <lineBasicMaterial color="#d3a95f" />
              </lineSegments>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Lights({ mode }: { mode: RenderMode }) {
  if (mode === "RAKING_LIGHT") {
    return (
      <>
        <ambientLight intensity={0.12} />
        <directionalLight position={[4, 0.4, 0.6]} intensity={2.6} />
      </>
    );
  }
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[2, 3, 4]} intensity={1.4} />
      <directionalLight position={[-2, -1, 2]} intensity={0.4} />
    </>
  );
}

/** WebGL 불가 환경용 이미지(SVG) 폴백 */
function SvgFallback({
  cells,
  selectedId,
  onSelect,
  demoLabel,
}: {
  cells: GlyphCell[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  demoLabel: string | null;
}) {
  return (
    <div className="p-4" data-testid="webgl-fallback">
      <p className="mb-2 text-xs text-neutral-400">
        WebGL을 사용할 수 없어 2D 이미지 폴백으로 표시합니다.
      </p>
      <div className="flex flex-wrap gap-2">
        {cells.map((c) => (
          <button key={c.id} onClick={() => onSelect(c.id)} aria-label={`문자 셀 ${c.id}`}>
            <GlyphPatchSvg cell={c} size={56} selected={c.id === selectedId} />
          </button>
        ))}
      </div>
      {demoLabel && <p className="mt-2 text-xs text-amber-300">{demoLabel}</p>}
    </div>
  );
}

export function Viewer3D({
  asset,
  cells,
  uiState,
  selectedId,
  onSelect,
  onUiStateChange,
}: {
  asset: SteleAsset;
  cells: GlyphCell[];
  uiState: TabUiState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUiStateChange: (patch: Partial<TabUiState>) => void;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const controlsRef = useRef<{ object: THREE.Camera; target: THREE.Vector3 } | null>(null);
  useEffect(() => setWebgl(webglSupported()), []);

  const params = asset.meshParams as unknown as MeshParams;
  const renderMode = uiState.renderMode;
  const lod = uiState.lodLevel;

  useEffect(() => {
    if (!webgl) return;
    const counter = glCounter();
    if (counter) {
      counter.active++;
      counter.created++;
    }
    return () => {
      const c = glCounter();
      if (c) {
        c.active--;
        c.disposed++;
      }
    };
  }, [webgl]);

  if (webgl === null) {
    return <div className="p-6 text-sm text-neutral-400">3D 뷰어 준비 중…</div>;
  }
  if (!webgl) {
    return (
      <SvgFallback
        cells={cells}
        selectedId={selectedId}
        onSelect={onSelect}
        demoLabel={asset.demoLabel}
      />
    );
  }

  const initialCamera = uiState.camera?.position ?? [0.9, 0.15, 3.1];

  return (
    <div className="relative h-full min-h-[320px]" data-testid="viewer-3d">
      <Canvas
        frameloop="demand"
        camera={{ position: initialCamera, fov: 40 }}
        gl={{ powerPreference: "low-power", antialias: true }}
      >
        <color attach="background" args={["#111114"]} />
        <Lights mode={renderMode} />
        <SteleMesh
          params={params}
          cells={cells}
          lod={lod}
          renderMode={renderMode}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <OrbitControls
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={controlsRef as any}
          enableDamping={false}
          onEnd={() => {
            const c = controlsRef.current;
            if (!c) return;
            const p = c.object.position;
            const t = c.target;
            onUiStateChange({
              camera: {
                position: [p.x, p.y, p.z],
                target: [t.x, t.y, t.z],
              },
            });
          }}
        />
      </Canvas>
      <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
        <DemoBadge label={asset.demoLabel ?? "가상 데모 메시"} />
        <span className="badge badge-neutral">실제 유물 3D 아님 · 절차 생성 데모</span>
      </div>
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
        {(["ALBEDO", "RAKING_LIGHT", "NORMAL", "CURVATURE"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onUiStateChange({ renderMode: m })}
            className={`badge ${renderMode === m ? "badge-demo" : "badge-neutral"}`}
            aria-pressed={renderMode === m}
          >
            {m === "ALBEDO"
              ? "기본"
              : m === "RAKING_LIGHT"
                ? "사광"
                : m === "NORMAL"
                  ? "법선"
                  : "깊이"}
          </button>
        ))}
        <select
          value={lod}
          onChange={(e) => onUiStateChange({ lodLevel: e.target.value as LodLevel })}
          className="badge badge-neutral bg-[var(--panel-bg)]"
          aria-label="LOD 선택"
        >
          <option value="PREVIEW">LOD 미리보기</option>
          <option value="MEDIUM">LOD 중간</option>
          <option value="FULL">LOD 최대</option>
        </select>
      </div>
    </div>
  );
}
