"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetVariant, GlyphCell, TabUiState } from "@seokmun/types";
import type { SlabParams } from "./geometryClient";

type RenderMode = TabUiState["renderMode"];

export interface VariantMeshSource {
  key: string;
  url: string;
  kind: "STATIC_BLENDER" | "SERVER_VARIANT";
  label: string;
  variant: AssetVariant | null;
  bounds: AssetVariant["bounds"];
}

export interface VariantMeshStatus {
  state: "IDLE" | "LOADING" | "READY" | "ERROR";
  source: VariantMeshSource | null;
  error: string | null;
}

function disposeMaterial(material: THREE.Material, textures: Set<THREE.Texture>) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) textures.add(value);
  }
  material.dispose();
}

function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) disposeMaterial(material, textures);
  const imageBitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    const sourceData: unknown = texture.source.data;
    if (typeof ImageBitmap !== "undefined" && sourceData instanceof ImageBitmap) {
      imageBitmaps.add(sourceData);
    }
    texture.dispose();
  }
  for (const bitmap of imageBitmaps) bitmap.close();
}

function countScene(scene: THREE.Object3D) {
  let triangles = 0;
  let vertices = 0;
  let gpuBytes = 0;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    vertices += position?.count ?? 0;
    triangles += geometry.index
      ? geometry.index.count / 3
      : (position?.count ?? 0) / 3;
    if (geometry.index) gpuBytes += geometry.index.array.byteLength;
    for (const attribute of Object.values(geometry.attributes)) {
      gpuBytes += attribute.array.byteLength;
    }
  });
  return {
    triangles: Math.round(triangles),
    vertices,
    gpuBytes,
  };
}

function cloneMaterial(material: THREE.Material): THREE.Material {
  return material.clone();
}

function makeDisplayMaterial(
  original: THREE.Material,
  geometry: THREE.BufferGeometry,
  renderMode: RenderMode,
  representation: TabUiState["representation"]
): THREE.Material {
  if (renderMode === "NORMAL") return new THREE.MeshNormalMaterial();

  const source = original as THREE.MeshStandardMaterial;
  const vertexColors = Boolean(geometry.getAttribute("color"));
  if (representation === "UNLIT_ORIGINAL") {
    return new THREE.MeshBasicMaterial({
      color: source.color?.clone() ?? new THREE.Color(0xffffff),
      map: source.map ?? null,
      vertexColors,
      transparent: source.transparent,
      opacity: source.opacity,
      side: source.side,
    });
  }

  const next = cloneMaterial(original);
  if (next instanceof THREE.MeshStandardMaterial) {
    next.vertexColors = vertexColors;
    next.needsUpdate = true;
  }
  return next;
}

function selectionCenter(cell: GlyphCell, params: SlabParams) {
  const [bx, by, bw, bh] = cell.bbox2d;
  return {
    x: (bx + bw / 2 - 0.5) * params.width,
    y: (0.5 - (by + bh / 2)) * params.height,
    width: bw * params.width,
    height: bh * params.height,
  };
}

/** 서버 파생 GLB 또는 Blender 프레젠테이션 GLB를 취소·해제 가능한 방식으로 로드한다. */
export function VariantMeshLayer({
  source,
  params,
  cells,
  renderMode,
  representation,
  visible,
  selectedId,
  onSelect,
  onStatus,
  onBuilt,
}: {
  source: VariantMeshSource | null;
  params: SlabParams;
  cells: GlyphCell[];
  renderMode: RenderMode;
  representation: TabUiState["representation"];
  roughness: number;
  visible: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStatus: (status: VariantMeshStatus) => void;
  onBuilt: (info: { triangles: number; vertices: number; gpuBytes: number }) => void;
}) {
  const { invalidate } = useThree();
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [loadedOffset, setLoadedOffset] = useState<[number, number, number]>([0, 0, 0]);
  const originalsRef = useRef(new Map<THREE.Mesh, THREE.Material | THREE.Material[]>());
  const displayMaterialsRef = useRef<THREE.Material[]>([]);

  useEffect(() => {
    if (!source) {
      setScene(null);
      onStatus({ state: "IDLE", source: null, error: null });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let loadedScene: THREE.Group | null = null;
    onStatus({ state: "LOADING", source, error: null });

    void (async () => {
      try {
        const response = await fetch(source.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`GLB 요청 실패 (${response.status})`);
        const buffer = await response.arrayBuffer();
        const gltf = await new GLTFLoader().parseAsync(buffer, "");
        loadedScene = gltf.scene;
        if (cancelled) {
          disposeScene(loadedScene);
          return;
        }
        originalsRef.current.clear();
        loadedScene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          originalsRef.current.set(mesh, mesh.material);
        });
        const box = new THREE.Box3().setFromObject(loadedScene);
        const center = box.getCenter(new THREE.Vector3());
        setLoadedOffset([-center.x, -center.y, -center.z]);
        setScene(loadedScene);
        onBuilt(countScene(loadedScene));
        onStatus({ state: "READY", source, error: null });
        invalidate();
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        onStatus({
          state: "ERROR",
          source,
          error: error instanceof Error ? error.message : "GLB 로딩 실패",
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      setScene(null);
      for (const [mesh, original] of originalsRef.current) mesh.material = original;
      for (const material of displayMaterialsRef.current) material.dispose();
      displayMaterialsRef.current = [];
      originalsRef.current.clear();
      if (loadedScene) disposeScene(loadedScene);
    };
  }, [source, invalidate, onBuilt, onStatus]);

  useEffect(() => {
    if (!scene) return;
    for (const material of displayMaterialsRef.current) material.dispose();
    displayMaterialsRef.current = [];
    for (const [mesh, original] of originalsRef.current) {
      const originals = Array.isArray(original) ? original : [original];
      const materials = originals.map((material) => {
        const next = makeDisplayMaterial(
          material,
          mesh.geometry,
          renderMode,
          representation
        );
        displayMaterialsRef.current.push(next);
        return next;
      });
      mesh.material = Array.isArray(original) ? materials : materials[0]!;
    }
    invalidate();
    return () => {
      for (const [mesh, original] of originalsRef.current) mesh.material = original;
    };
  }, [scene, renderMode, representation, invalidate]);

  const variantOffset = useMemo(() => {
    const bounds = source?.bounds;
    if (!bounds) return null;
    return [
      -(bounds.min[0] + bounds.max[0]) / 2,
      -(bounds.min[1] + bounds.max[1]) / 2,
      -(bounds.min[2] + bounds.max[2]) / 2,
    ] as [number, number, number];
  }, [source]);

  if (!scene || !source) return null;
  const evidence = source.variant?.measurementAllowed === true;
  const zFace = params.depth / 2 + 0.006;
  // 박물관용 Blender 모델은 받침대를 포함한 시각 자산이라 연구 셀 좌표와 동일한
  // 표면 변환을 보장하지 않는다. 정확한 근거 좌표가 있는 서버 variant에서만 피킹한다.
  const interactiveCells = source.kind === "SERVER_VARIANT" ? cells : [];

  return (
    <group
      visible={visible}
      userData={evidence ? { evidenceMesh: true } : { presentationMesh: true }}
    >
      <primitive object={scene} position={variantOffset ?? loadedOffset} />
      {interactiveCells.map((cell) => {
        const box = selectionCenter(cell, params);
        const selected = cell.id === selectedId;
        return (
          <mesh
            key={cell.id}
            position={[box.x, box.y, zFace]}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(cell.id);
            }}
          >
            <planeGeometry args={[box.width, box.height]} />
            <meshBasicMaterial
              transparent
              opacity={selected ? 0.08 : 0.001}
              color={selected ? "#9f5b3f" : "#ffffff"}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
