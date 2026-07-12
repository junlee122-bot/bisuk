"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GlyphCell, SteleAsset } from "@seokmun/types";
import { api } from "@/lib/api";
import { DemoBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import {
  createFragmentGeometry,
  glCounter,
  webglSupported,
  type MeshParams,
} from "./steleGeometry";

function FragmentMesh({ params, y }: { params: MeshParams; y: number }) {
  const geometry = useMemo(() => createFragmentGeometry(params), [params]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={[0, y, 0]}>
      <meshStandardMaterial color="#8f8a7d" roughness={0.9} />
    </mesh>
  );
}

export function FragmentViewer({
  tabId,
  assets,
  cells,
  selectedId,
  onSelect,
}: {
  tabId: string;
  assets: SteleAsset[];
  cells: GlyphCell[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const fragments = assets.filter((a) => a.format === "PROCEDURAL_FRAGMENT");
  const [gap, setGap] = useState(0.25);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(webglSupported()), []);

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

  const { data: join } = useQuery({
    queryKey: ["fragment-join", tabId, gap],
    queryFn: () => api.evaluateFragments({ tabId, offset: gap }),
    enabled: fragments.length >= 2,
  });

  if (fragments.length < 2) {
    return <p className="p-4 text-sm text-ink-2">가상 조각 자산이 없습니다.</p>;
  }
  const pA = fragments[0]!.meshParams as unknown as MeshParams;
  const pB = fragments[1]!.meshParams as unknown as MeshParams;

  const byFace = new Map<string, GlyphCell[]>();
  for (const c of cells) {
    const list = byFace.get(c.faceId) ?? [];
    list.push(c);
    byFace.set(c.faceId, list);
  }

  return (
    <div className="flex h-full flex-col" data-testid="fragment-viewer">
      <div className="relative min-h-[280px] flex-1">
        {webgl ? (
          <Canvas frameloop="demand" camera={{ position: [0.7, 0.2, 1.6], fov: 45 }}>
            <color attach="background" args={["#e8e5de"]} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[2, 3, 4]} intensity={1.3} />
            {/* 조각 1(위, 파단면 아래) / 조각 2(아래, 파단면 위) */}
            <FragmentMesh params={pA} y={pA.height / 2 + gap / 2} />
            <FragmentMesh params={pB} y={-pB.height / 2 - gap / 2} />
            <OrbitControls enableDamping={false} />
          </Canvas>
        ) : (
          webgl === false && (
            <p className="p-4 text-xs text-ink-2" data-testid="webgl-fallback">
              WebGL 불가 — 조각 패치를 2D로 표시합니다.
            </p>
          )
        )}
        <div className="pointer-events-none absolute left-2 top-2">
          <DemoBadge label="DEMO-C 가상 비석 조각 — 실제 유물 아님" />
        </div>
      </div>
      <div className="panel m-2 space-y-2 p-3" aria-label="접합 시뮬레이션">
        <div className="flex items-center gap-3">
          <label htmlFor="join-slider" className="text-xs text-ink-2">
            접합 간격
          </label>
          <input
            id="join-slider"
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
            className="flex-1"
            data-testid="join-slider"
          />
          <span className="text-xs tabular-nums">{gap.toFixed(2)}m</span>
        </div>
        {join && (
          <dl
            className="grid grid-cols-3 gap-2 text-center text-xs"
            data-testid="join-result"
          >
            <div className="panel p-2">
              <dt className="text-ink-3">평균 간극</dt>
              <dd className="font-medium">{join.meanGap}</dd>
            </div>
            <div className="panel p-2">
              <dt className="text-ink-3">간섭 비율</dt>
              <dd className="font-medium">{join.interferenceRatio}</dd>
            </div>
            <div className="panel p-2">
              <dt className="text-ink-3">접합 신뢰도</dt>
              <dd
                className={`font-semibold ${join.joinConfidence > 0.8 ? "text-[var(--state-success)]" : "text-[var(--state-warning)]"}`}
                data-testid="join-confidence"
              >
                {join.joinConfidence}
              </dd>
            </div>
          </dl>
        )}
        <p className="text-[11px] text-ink-3">{join?.note}</p>
      </div>
      <div className="m-2 grid grid-cols-2 gap-2">
        {[...byFace.entries()].map(([faceId, faceCells]) => (
          <section key={faceId} className="panel p-2">
            <h4 className="mb-1 text-xs text-ink-2">{faceId}</h4>
            <div className="flex flex-wrap gap-1.5">
              {faceCells.map((c) => (
                <button key={c.id} onClick={() => onSelect(c.id)} aria-label={`문자 셀 ${c.id}`}>
                  <GlyphPatchSvg cell={c} size={44} selected={c.id === selectedId} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
