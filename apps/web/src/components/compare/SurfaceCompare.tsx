"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useQueries } from "@tanstack/react-query";
import * as THREE from "three";
import type { GlyphCell } from "@seokmun/types";
import { buildDetailPatchMesh } from "@seokmun/engine";
import { api } from "@/lib/api";
import { DemoBadge } from "@/components/badges";
import {
  meshArraysToGeometry,
  webglSupported,
  type SlabParams,
} from "@/features/high-fidelity-3d/geometryClient";

type PatchMode = "PBR" | "RAKING" | "NORMAL" | "CURVATURE" | "DEPTH";

interface SharedCamera {
  position: [number, number, number];
  target: [number, number, number];
  seq: number;
}

function falseColors(positions: Float32Array, zMax: number, mode: "CURVATURE" | "DEPTH") {
  const n = positions.length / 3;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (zMax - positions[i * 3 + 2]!) / 0.035));
    if (mode === "DEPTH") {
      arr[i * 3] = 0.15 + 0.85 * t;
      arr[i * 3 + 1] = 0.2;
      arr[i * 3 + 2] = 1 - 0.85 * t;
    } else {
      arr[i * 3] = 0.25 + 0.75 * t;
      arr[i * 3 + 1] = 0.3 + 0.25 * (1 - t);
      arr[i * 3 + 2] = 0.9 - 0.8 * t;
    }
  }
  return new THREE.BufferAttribute(arr, 3);
}

function PatchScene({
  params,
  cells,
  cell,
  mode,
  shared,
  sync,
  onCamera,
}: {
  params: SlabParams;
  cells: GlyphCell[];
  cell: GlyphCell;
  mode: PatchMode;
  shared: SharedCamera | null;
  sync: boolean;
  onCamera: (c: SharedCamera) => void;
}) {
  const { invalidate } = useThree();
  const controlsRef = useRef<{ object: THREE.Camera; target: THREE.Vector3; update: () => void } | null>(null);
  const appliedSeq = useRef(0);

  const built = useMemo(() => {
    const arrays = buildDetailPatchMesh(params, cells, cell, 128, { cavityStrength: 0.6 });
    const geometry = meshArraysToGeometry(arrays);
    return {
      geometry,
      albedo: geometry.getAttribute("color") as THREE.BufferAttribute,
      curvature: falseColors(arrays.positions, params.depth / 2, "CURVATURE"),
      depth: falseColors(arrays.positions, params.depth / 2, "DEPTH"),
      center: new THREE.Vector3(
        (arrays.bounds.min[0] + arrays.bounds.max[0]) / 2,
        (arrays.bounds.min[1] + arrays.bounds.max[1]) / 2,
        params.depth / 2
      ),
      size: Math.max(
        arrays.bounds.max[0] - arrays.bounds.min[0],
        arrays.bounds.max[1] - arrays.bounds.min[1]
      ),
    };
  }, [params, cells, cell]);

  useEffect(() => {
    const g = built.geometry;
    return () => g.dispose();
  }, [built]);

  useEffect(() => {
    const g = built.geometry;
    if (mode === "CURVATURE") g.setAttribute("color", built.curvature);
    else if (mode === "DEPTH") g.setAttribute("color", built.depth);
    else g.setAttribute("color", built.albedo);
    (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    invalidate();
  }, [mode, built, invalidate]);

  // 카메라 동기화 (상대 좌표: 패치 중심 기준 오프셋 공유)
  useEffect(() => {
    if (!sync || !shared || shared.seq === appliedSeq.current) return;
    const c = controlsRef.current;
    if (!c) return;
    appliedSeq.current = shared.seq;
    c.object.position.set(
      built.center.x + shared.position[0],
      built.center.y + shared.position[1],
      built.center.z + shared.position[2]
    );
    c.target.set(
      built.center.x + shared.target[0],
      built.center.y + shared.target[1],
      built.center.z + shared.target[2]
    );
    c.update();
    invalidate();
  }, [shared, sync, built.center, invalidate]);

  const camPos: [number, number, number] = [
    built.center.x + built.size * 0.3,
    built.center.y + built.size * 0.2,
    built.center.z + built.size * 1.6,
  ];

  return (
    <>
      <color attach="background" args={["#e8e5de"]} />
      {mode === "RAKING" ? (
        <>
          <ambientLight intensity={0.1} />
          <directionalLight position={[built.center.x + 3, built.center.y + 0.4, built.center.z + 0.5]} intensity={3} />
        </>
      ) : (
        <>
          <ambientLight intensity={0.75} />
          <directionalLight position={[2, 3, 4]} intensity={1.0} />
        </>
      )}
      <mesh geometry={built.geometry}>
        {mode === "NORMAL" ? (
          <meshNormalMaterial />
        ) : mode === "CURVATURE" || mode === "DEPTH" ? (
          <meshBasicMaterial vertexColors />
        ) : (
          <meshPhysicalMaterial vertexColors roughness={0.85} metalness={0} />
        )}
      </mesh>
      <OrbitControls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={controlsRef as any}
        makeDefault
        camera-position={camPos}
        target={[built.center.x, built.center.y, built.center.z]}
        enableDamping={false}
        onEnd={() => {
          const c = controlsRef.current;
          if (!c) return;
          onCamera({
            position: [
              c.object.position.x - built.center.x,
              c.object.position.y - built.center.y,
              c.object.position.z - built.center.z,
            ],
            target: [
              c.target.x - built.center.x,
              c.target.y - built.center.y,
              c.target.z - built.center.z,
            ],
            seq: Date.now(),
          });
        }}
      />
      <PatchCamera position={camPos} />
    </>
  );
}

function PatchCamera({ position }: { position: [number, number, number] }) {
  const { camera, invalidate } = useThree();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    camera.position.set(...position);
    invalidate();
  }, [camera, position, invalidate]);
  return null;
}

const MODES: Array<[PatchMode, string]> = [
  ["PBR", "PBR"],
  ["RAKING", "사광"],
  ["NORMAL", "법선"],
  ["CURVATURE", "곡률"],
  ["DEPTH", "깊이"],
];

export function SurfaceCompare({ setId }: { setId: string }) {
  const searchParams = useSearchParams();
  const cellIds = (searchParams.get("cells") ?? "").split(",").filter(Boolean).slice(0, 2);
  const [mode, setMode] = useState<PatchMode>("RAKING");
  const [sync, setSync] = useState(true);
  const [shared, setShared] = useState<SharedCamera | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(webglSupported()), []);

  // 셀 → 소속 탭 detail 로딩
  const { data: overview } = useQueries({
    queries: [{ queryKey: ["set", setId], queryFn: () => api.getSet(setId) }],
    combine: (rs) => rs[0]!,
  });
  const tabIds = overview?.tabs.map((t) => t.tab.id) ?? [];
  const tabDetails = useQueries({
    queries: tabIds.map((id) => ({
      queryKey: ["tab", id],
      queryFn: () => api.getTab(id),
    })),
  });

  const panels = cellIds.map((cellId) => {
    for (const q of tabDetails) {
      const detail = q.data;
      if (!detail) continue;
      const cell = detail.glyphCells.find((c) => c.id === cellId);
      if (!cell) continue;
      const meshAsset = detail.assets.find(
        (a) => a.assetType === "MESH" && a.format === "PROCEDURAL_MESH"
      );
      if (!meshAsset?.meshParams) return { cellId, error: "3D 자산 없음 (문헌 전용 탭)" };
      return {
        cellId,
        cell,
        cells: detail.glyphCells,
        params: meshAsset.meshParams as unknown as SlabParams,
        tabTitle: detail.tab.title,
      };
    }
    return { cellId, error: "셀을 찾는 중…" };
  });

  return (
    <main className="flex min-h-screen flex-col p-3 sm:p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Link href={`/sets/${setId}`} className="text-sm text-ink-2 hover:text-[var(--accent)]">
          ← 워크스페이스
        </Link>
        <h1 className="text-lg font-semibold">Surface Compare (3D 표면 패치)</h1>
        <DemoBadge label="가상 표면 비교 — 절대 깊이 비교 없음 (단위 미확정)" />
        <span className="ml-auto flex items-center gap-2 text-xs">
          {MODES.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={`badge ${mode === key ? "badge-demo" : "badge-neutral"}`}
              data-testid={`surface-mode-${key}`}
            >
              {label}
            </button>
          ))}
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={sync}
              onChange={(e) => setSync(e.target.checked)}
              data-testid="camera-sync"
            />
            카메라 동기화
          </label>
        </span>
      </header>
      {cellIds.length < 2 && (
        <p className="text-sm text-ink-2">
          비교할 문자 셀 2개가 필요합니다 (Glyph Matrix에서 "표면 비교"로 진입).
        </p>
      )}
      {webgl === false && (
        <p className="text-sm text-[var(--state-warning)]" data-testid="webgl-fallback">
          WebGL 불가 — 표면 비교는 3D 환경이 필요합니다.
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-2" data-testid="surface-compare">
        {webgl &&
          panels.map((p) => (
            <section key={p.cellId} className="panel flex min-h-[420px] flex-col overflow-hidden">
              <header className="flex items-center gap-2 border-b border-[var(--panel-border)] px-2 py-1 text-xs">
                <strong>{p.cellId}</strong>
                {"tabTitle" in p && <span className="text-ink-3">{p.tabTitle}</span>}
                <span className="badge badge-demo ml-auto">가상</span>
              </header>
              {"error" in p ? (
                <p className="p-4 text-xs text-ink-3">{p.error}</p>
              ) : (
                <div className="min-h-0 flex-1">
                  <Canvas frameloop="demand" dpr={[1, 1.5]} gl={{ powerPreference: "low-power" }}>
                    <PatchScene
                      params={p.params}
                      cells={p.cells}
                      cell={p.cell}
                      mode={mode}
                      shared={shared}
                      sync={sync}
                      onCamera={setShared}
                    />
                  </Canvas>
                </div>
              )}
            </section>
          ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        스케일 정규화: 두 패치는 각자 셀 크기 기준으로 정규화되어 표시됩니다. 좌표계·단위가
        확정되지 않아 절대 깊이 차이는 계산하지 않습니다 (형태 비교 전용).
      </p>
    </main>
  );
}
