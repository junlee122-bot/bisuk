"use client";

import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GlyphCell } from "@seokmun/types";
import { buildDetailPatchMesh, type SlabParams } from "@seokmun/engine";
import { meshArraysToGeometry } from "./geometryClient";

interface PatchEntry {
  geometry: THREE.BufferGeometry;
  source: "SERVER_GLB" | "LOCAL_FALLBACK";
}

/**
 * 글자 detail patch 스트리밍 — 선택 셀의 고해상(96×96) 국소 격자를
 * 서버 variant(GLB)로 프리페치해 전역 메시 위에 정렬한다.
 * 동일 높이장 수식이므로 표면 위치가 일치하며, seam은 polygonOffset으로 처리.
 */
export function GlyphDetailPatchLayer({
  assetId,
  params,
  cells,
  selectedId,
  maxPatches,
  roughness,
  onStatus,
}: {
  assetId: string;
  params: SlabParams;
  cells: GlyphCell[];
  selectedId: string | null;
  maxPatches: number;
  roughness: number;
  onStatus: (s: { loading: boolean; loaded: string[]; source: string | null }) => void;
}) {
  const { invalidate } = useThree();
  const cacheRef = useRef(new Map<string, PatchEntry>());
  const [, force] = useState(0);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const entry of cache.values()) entry.geometry.dispose();
      cache.clear();
    };
  }, []);

  useEffect(() => {
    if (!selectedId || maxPatches <= 0) return;
    const cache = cacheRef.current;
    if (cache.has(selectedId)) return;
    let cancelled = false;
    onStatus({ loading: true, loaded: [...cache.keys()], source: null });
    (async () => {
      let entry: PatchEntry | null = null;
      try {
        const gen = await fetch("/api/3d/mesh/generate-detail-patches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetId, glyphCellIds: [selectedId], resolution: 128 }),
        });
        if (gen.ok) {
          const { variants } = (await gen.json()) as { variants: Array<{ id: string }> };
          const variantId = variants[0]?.id;
          if (variantId) {
            const file = await fetch(`/api/3d/variants/${variantId}/file`);
            if (file.ok) {
              const buf = await file.arrayBuffer();
              const gltf = await new GLTFLoader().parseAsync(buf, "");
              let geometry: THREE.BufferGeometry | null = null;
              gltf.scene.traverse((obj) => {
                if (!geometry && (obj as THREE.Mesh).isMesh) {
                  geometry = (obj as THREE.Mesh).geometry;
                }
              });
              if (geometry) entry = { geometry, source: "SERVER_GLB" };
            }
          }
        }
      } catch {
        // 네트워크 실패 → 로컬 생성 폴백
      }
      if (!entry) {
        const cell = cells.find((c) => c.id === selectedId);
        if (cell) {
          const arrays = buildDetailPatchMesh(params, cells, cell, 128, { cavityStrength: 0.5 });
          entry = { geometry: meshArraysToGeometry(arrays), source: "LOCAL_FALLBACK" };
        }
      }
      if (cancelled || !entry) return;
      // LRU: 초과분 해제
      cache.set(selectedId, entry);
      while (cache.size > maxPatches) {
        const oldest = cache.keys().next().value as string;
        cache.get(oldest)?.geometry.dispose();
        cache.delete(oldest);
      }
      onStatus({ loading: false, loaded: [...cache.keys()], source: entry.source });
      force((n) => n + 1);
      invalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, assetId, cells, params, maxPatches, onStatus, invalidate]);

  return (
    <group>
      {[...cacheRef.current.entries()].map(([cellId, entry]) => (
        <mesh key={cellId} geometry={entry.geometry} castShadow receiveShadow>
          <meshPhysicalMaterial
            vertexColors
            roughness={roughness}
            metalness={0}
            polygonOffset
            polygonOffsetFactor={-1.5}
            polygonOffsetUnits={-2}
          />
        </mesh>
      ))}
    </group>
  );
}
