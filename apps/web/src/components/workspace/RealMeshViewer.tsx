"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SteleAsset } from "@seokmun/types";
import { labApi } from "@/lib/api";
import { useCan } from "@/lib/session";

/** 브라우저에서 원본을 직접 여는 최대 크기 — 넘으면 파생 LOD가 필요하다 */
const MAX_BROWSER_BYTES = 250 * 1024 * 1024;

interface Loaded {
  object: THREE.Object3D;
  center: THREE.Vector3;
  /** 표시 배율 (모델 단위 → 화면 단위) */
  fit: number;
  size: THREE.Vector3;
  kind: "mesh" | "points";
}

async function loadModel(asset: SteleAsset): Promise<Loaded> {
  const res = await fetch(labApi.assetFileUrl(asset.id), { credentials: "same-origin" });
  if (!res.ok) throw new Error(res.status === 403 ? "권한이 없어 원본을 열 수 없습니다" : `원본을 불러오지 못했습니다 (${res.status})`);
  const buf = await res.arrayBuffer();
  const name = (asset.originalFilename ?? "").toLowerCase();
  const fmt = (asset.format ?? "").toUpperCase();
  let object: THREE.Object3D;
  let kind: Loaded["kind"] = "mesh";
  const material = new THREE.MeshStandardMaterial({ color: 0xc9bca8, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  if (fmt.startsWith("PLY") || name.endsWith(".ply")) {
    const g = new PLYLoader().parse(buf);
    const hasFaces = Boolean(g.index && g.index.count > 0);
    if (!hasFaces) {
      kind = "points";
      object = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.004, vertexColors: Boolean(g.getAttribute("color")), color: 0xd8ccb8, sizeAttenuation: true }));
    } else {
      if (!g.getAttribute("normal")) g.computeVertexNormals();
      if (g.getAttribute("color")) material.vertexColors = true;
      object = new THREE.Mesh(g, material);
    }
  } else if (fmt.startsWith("STL") || name.endsWith(".stl")) {
    const g = new STLLoader().parse(buf);
    g.computeVertexNormals();
    object = new THREE.Mesh(g, material);
  } else if (fmt === "OBJ" || name.endsWith(".obj")) {
    object = new OBJLoader().parse(new TextDecoder().decode(buf));
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material;
    });
  } else if (fmt === "GLB" || fmt === "GLTF" || name.endsWith(".glb")) {
    const gltf = await new GLTFLoader().parseAsync(buf, "");
    object = gltf.scene;
  } else {
    throw new Error(`${asset.format ?? "알 수 없는"} 형식은 브라우저 뷰어가 지원하지 않습니다 (PLY·STL·OBJ·GLB)`);
  }
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  return { object, center, fit: 2 / maxDim, size, kind };
}

function Model({
  loaded,
  rotationDeg,
  onPick,
  markers,
  groupRef,
}: {
  loaded: Loaded;
  rotationDeg: [number, number, number];
  onPick: (modelPoint: THREE.Vector3, modelNormal: THREE.Vector3 | null) => void;
  markers: THREE.Vector3[];
  groupRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const rot = rotationDeg.map((d) => (d * Math.PI) / 180) as [number, number, number];
  const markerR = 0.012 / loaded.fit;
  return (
    <group rotation={rot}>
      <group ref={groupRef} scale={loaded.fit} position={loaded.center.clone().multiplyScalar(-loaded.fit)}>
        <primitive
          object={loaded.object}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            const g = groupRef.current;
            if (!g) return;
            const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
            const p = e.point.clone().applyMatrix4(inv);
            let n: THREE.Vector3 | null = null;
            if (e.face) n = e.face.normal.clone().normalize();
            onPick(p, n);
          }}
        />
        {markers.map((m, i) => (
          <mesh key={i} position={m}>
            <sphereGeometry args={[markerR, 12, 12]} />
            <meshBasicMaterial color={i === 0 ? "#ff8a65" : "#7df0c0"} />
          </mesh>
        ))}
        {markers.length === 2 && (
          <line>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[new Float32Array([...markers[0]!.toArray(), ...markers[1]!.toArray()]), 3]} />
            </bufferGeometry>
            <lineBasicMaterial color="#ffd27a" />
          </line>
        )}
      </group>
    </group>
  );
}

/**
 * 두 점 사이 단면 프로파일 — 표면 법선 방향 광선으로 표면 높이를 표본화 (획 깊이 확인용).
 * a·b·normal은 모델 좌표, mw는 모델→월드 행렬.
 */
function computeProfile(
  object: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  normal: THREE.Vector3,
  mw: THREE.Matrix4,
  samples = 48
) {
  const ray = new THREE.Raycaster();
  const inv = mw.clone().invert();
  const nmat = new THREE.Matrix3().getNormalMatrix(mw);
  const dirW = normal.clone().negate().applyMatrix3(nmat).normalize();
  const span = a.distanceTo(b);
  const L = span * 0.5 + 1e-6;
  const out: Array<{ t: number; h: number | null }> = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const q = a.clone().lerp(b, t);
    const originW = q.clone().addScaledVector(normal, L).applyMatrix4(mw);
    ray.set(originW, dirW);
    const hit = ray.intersectObject(object, true)[0];
    out.push({ t: t * span, h: hit ? hit.point.clone().applyMatrix4(inv).sub(q).dot(normal) : null });
  }
  return out;
}

export function RealMeshViewer({ asset, tabId }: { asset: SteleAsset; tabId: string }) {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<THREE.Vector3[]>([]);
  const [normals, setNormals] = useState<Array<THREE.Vector3 | null>>([]);
  const [rotation, setRotation] = useState<[number, number, number]>(asset.alignment?.rotationDeg ?? [0, 0, 0]);
  const [profile, setProfile] = useState<Array<{ t: number; h: number | null }> | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const cal = asset.scaleCalibration;
  const tooBig = (asset.byteSize ?? 0) > MAX_BROWSER_BYTES;

  useEffect(() => {
    if (tooBig) return;
    let cancelled = false;
    setLoaded(null);
    setError(null);
    loadModel(asset)
      .then((l) => !cancelled && setLoaded(l))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAlign = useMutation({
    mutationFn: () => labApi.setAlignment(asset.id, rotation),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tab", tabId] }),
  });

  const fmt = (modelUnits: number) =>
    cal ? `${(modelUnits * cal.metersPerUnit * 1000).toFixed(2)} mm` : `${modelUnits.toPrecision(4)} (모델 단위 — 단위 미확정)`;

  const distance = points.length === 2 ? points[0]!.distanceTo(points[1]!) : null;

  const profileSvg = useMemo(() => {
    if (!profile) return null;
    const valid = profile.filter((p) => p.h !== null) as Array<{ t: number; h: number }>;
    if (valid.length < 2) return null;
    const maxT = valid[valid.length - 1]!.t || 1;
    const hs = valid.map((p) => p.h);
    const lo = Math.min(...hs);
    const hi = Math.max(...hs);
    const range = hi - lo || 1;
    const path = valid.map((p, i) => `${i ? "L" : "M"} ${(p.t / maxT) * 300} ${70 - ((p.h - lo) / range) * 60}`).join(" ");
    return { path, depth: range };
  }, [profile]);

  if (tooBig) {
    return (
      <p className="p-4 text-sm text-ink-2">
        원본({((asset.byteSize ?? 0) / 1024 / 1024).toFixed(0)}MB)이 커서 브라우저에서 직접 열지 않습니다. ‘3D 품질’ 패널에서 증거용 파생본(LOD)을 만든 뒤
        보세요. 원본은 그대로 보존됩니다.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="real-mesh-viewer">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--panel-border)] px-2 py-1 text-[11px]">
        <span className="badge badge-ok">실측 자료 원본 · 표시 전용 보정 없음</span>
        <span className={`badge ${cal ? "badge-ok" : "badge-warn"}`}>{cal ? `단위: 1 ${cal.unit} = ${(cal.metersPerUnit * 1000).toPrecision(4)}mm` : "단위 미확정"}</span>
        {asset.qualityReport?.unitGuess && !cal && <span className="text-ink-3">추정: {asset.qualityReport.unitGuess}</span>}
        <span className="ml-auto">정렬(°)</span>
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <label key={axis} className="flex items-center gap-0.5">
            {axis}
            <input
              type="number"
              step={1}
              value={rotation[i]}
              onChange={(e) => {
                const next = [...rotation] as [number, number, number];
                next[i] = Number(e.target.value);
                setRotation(next);
              }}
              className="w-14 rounded border border-[var(--panel-border)] bg-transparent px-1"
              disabled={!canEdit}
            />
          </label>
        ))}
        {canEdit && (
          <button className="badge badge-neutral" onClick={() => saveAlign.mutate()} disabled={saveAlign.isPending}>
            정렬 저장
          </button>
        )}
      </div>
      <p className="px-2 py-0.5 text-[11px] text-ink-3">
        표면을 두 번 클릭하면 거리와 두 점 사이 단면 프로파일(획 깊이)을 봅니다. 드래그로 회전, 휠로 확대.
      </p>
      <div className="relative min-h-[320px] flex-1 bg-[#1c1a17]">
        {error && <p className="absolute left-2 top-2 z-10 rounded bg-black/60 px-2 py-1 text-xs text-white">{error}</p>}
        {!loaded && !error && <p className="absolute left-2 top-2 z-10 text-xs text-white/70">원본 불러오는 중…</p>}
        {loaded && (
          <Canvas camera={{ position: [0, 0, 3], fov: 40, near: 0.001, far: 100 }} dpr={[1, 2]}>
            <ambientLight intensity={0.35} />
            <directionalLight position={[2, 3, 4]} intensity={1.2} />
            <directionalLight position={[-3, -1, 2]} intensity={0.4} />
            <Model
              loaded={loaded}
              rotationDeg={rotation}
              groupRef={groupRef}
              markers={points}
              onPick={(p, n) => {
                const nextPts = points.length >= 2 ? [p] : [...points, p];
                const nextNs = points.length >= 2 ? [n] : [...normals, n];
                setPoints(nextPts);
                setNormals(nextNs);
                setProfile(null);
                if (nextPts.length === 2 && loaded.kind === "mesh") {
                  const avg = new THREE.Vector3();
                  for (const x of nextNs) if (x) avg.add(x);
                  const g = groupRef.current;
                  if (avg.lengthSq() > 0 && g) {
                    g.updateMatrixWorld(true);
                    setProfile(computeProfile(loaded.object, nextPts[0]!, nextPts[1]!, avg.normalize(), g.matrixWorld));
                  }
                }
              }}
            />
            <OrbitControls makeDefault enableDamping />
          </Canvas>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-2 py-1 text-xs">
        {loaded && (
          <span className="text-ink-3">
            크기 {fmt(loaded.size.x)} × {fmt(loaded.size.y)} × {fmt(loaded.size.z)}
          </span>
        )}
        {distance !== null && (
          <span data-testid="mesh-distance">
            거리: <strong>{fmt(distance)}</strong>
          </span>
        )}
        {profileSvg && (
          <span className="flex items-center gap-2" data-testid="mesh-profile">
            단면 기복 {fmt(profileSvg.depth)}
            <svg width={300} height={72} className="rounded bg-surface-2">
              <path d={profileSvg.path} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}
