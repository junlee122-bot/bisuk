"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GlyphCell, SteleAsset, TabUiState } from "@seokmun/types";
import { makeSurfaceField } from "@seokmun/engine";
import { DemoBadge } from "@/components/badges";
import { GlyphPatchSvg } from "@/components/GlyphPatchSvg";
import { useStageMode } from "@/lib/store";
import {
  buildClientSlab,
  glCounter,
  webglSupported,
  type SlabParams,
} from "./geometryClient";
import { detectQualityTier, LIGHTING_PRESETS, QUALITY_TIERS, RESEARCH_STAGE } from "./presets";
import { PresentationStage } from "./PresentationStage";
import { SteleCameraRig, type FlyToRequest } from "./SteleCameraRig";
import { SteleLightingRig, type ToneMappingChoice } from "./SteleLightingRig";
import { LENS_SIZE, lensCenter, MagnifierLens, type MagnifierState } from "./MagnifierLens";
import { ScreenshotComposer } from "./ScreenshotComposer";
import { BOOKMARK_LABEL, BOOKMARK_ORDER, bookmarkPose, type BookmarkName } from "./cameraBookmarks";
import { GlyphDetailPatchLayer } from "./GlyphDetailPatchLayer";
import { SplatLayer } from "./SplatLayer";
import { ThreeDQualityPanel } from "./ThreeDQualityPanel";

type RenderMode = TabUiState["renderMode"];

/** 단발성 캡처 브리지 — 요청 시 1회 렌더 직후 픽셀 확보 (preserveDrawingBuffer 불필요) */
function CaptureBridge({ onReady }: { onReady: (fn: () => string) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    onReady(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    });
  }, [gl, scene, camera, onReady]);
  return null;
}

/** 렌더 통계 수집 — 품질 패널·E2E 검증용 */
function StatsBridge({ gpuBytesEstimate }: { gpuBytesEstimate: number }) {
  const { gl } = useThree();
  const framesRef = useRef(0);
  const lastInfo = useRef({ calls: 0, triangles: 0 });
  useFrame(() => {
    framesRef.current++;
    lastInfo.current = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    };
  });
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof window === "undefined") return;
      window.__seokmunStats = {
        fps: framesRef.current,
        drawCalls: lastInfo.current.calls,
        triangles: lastInfo.current.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        gpuBytesEstimate,
      };
      framesRef.current = 0;
    }, 1000);
    return () => clearInterval(timer);
  }, [gl, gpuBytesEstimate]);
  return null;
}

function SelectedOutline({ width, height }: { width: number; height: number }) {
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height)),
    [width, height]
  );
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <lineSegments geometry={edges}>
      <lineBasicMaterial color="#9f5b3f" />
    </lineSegments>
  );
}

/** 베이스 메시 + 셀 피킹 평면 (피킹은 항상 Evidence 좌표 기준) */
function SteleMeshLayer({
  params,
  cells,
  lod,
  renderMode,
  representation,
  aoStrength,
  visible,
  selectedId,
  onSelect,
  onBuilt,
}: {
  params: SlabParams;
  cells: GlyphCell[];
  lod: TabUiState["lodLevel"];
  renderMode: RenderMode;
  representation: TabUiState["representation"];
  aoStrength: number;
  visible: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBuilt: (info: { triangles: number; vertices: number; gpuBytes: number }) => void;
}) {
  const { invalidate } = useThree();
  const geometryKey = useMemo(
    () =>
      `${lod}::${JSON.stringify(params)}::${cells
        .map((c) => `${c.id}:${c.strokes?.erodedStrokeIndexes.join(".") ?? ""}`)
        .join("|")}`,
    [params, cells, lod]
  );
  const built = useMemo(
    () => buildClientSlab(params, cells, lod, 0.6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey]
  );
  // AO(cavity) 극단 두 세트 — 슬라이더는 두 배열의 보간 (재생성 없이 색만 갱신)
  const albedoExtremes = useMemo(() => {
    const field = makeSurfaceField(params, cells);
    const grids: Record<string, [number, number]> = {
      PREVIEW: [24, 64],
      MEDIUM: [48, 128],
      FULL: [144, 384],
    };
    const [gx, gy] = grids[lod]!;
    const frontVerts = (gx + 1) * (gy + 1);
    const total = built.geometry.getAttribute("position").count;
    const c0 = new Float32Array(total * 3);
    const c1 = new Float32Array(total * 3);
    let p = 0;
    for (let iy = 0; iy <= gy; iy++) {
      for (let ix = 0; ix <= gx; ix++) {
        const a0 = field.albedoAt(ix / gx, iy / gy, 0);
        const a1 = field.albedoAt(ix / gx, iy / gy, 1.2);
        for (let k = 0; k < 3; k++) {
          c0[p * 3 + k] = a0[k]!;
          c1[p * 3 + k] = a1[k]!;
        }
        p++;
      }
    }
    for (let i = frontVerts; i < total; i++) {
      for (let k = 0; k < 3; k++) {
        c0[i * 3 + k] = 0.52 - k * 0.03;
        c1[i * 3 + k] = 0.52 - k * 0.03;
      }
    }
    return { c0, c1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey]);

  useEffect(() => {
    const g = built.geometry;
    return () => g.dispose();
  }, [built]);

  useEffect(() => {
    onBuilt({
      triangles: built.triangleCount,
      vertices: built.vertexCount,
      gpuBytes: built.gpuBytesEstimate,
    });
  }, [built, onBuilt]);

  // 분석 모드별 색 attribute 선택 + AO 보간
  useEffect(() => {
    const g = built.geometry;
    if (renderMode === "CURVATURE") {
      g.setAttribute("color", built.curvature);
    } else if (renderMode === "DEPTH") {
      g.setAttribute("color", built.depth);
    } else {
      const t = Math.max(0, Math.min(1, aoStrength / 1.2));
      const arr = built.albedo.array as Float32Array;
      const { c0, c1 } = albedoExtremes;
      for (let i = 0; i < arr.length; i++) {
        arr[i] = c0[i]! + (c1[i]! - c0[i]!) * t;
      }
      g.setAttribute("color", built.albedo);
    }
    (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    invalidate();
  }, [renderMode, aoStrength, built, albedoExtremes, invalidate]);

  const zFace = params.depth / 2 + 0.004;
  const isResearch = representation === "RESEARCH_EVIDENCE";
  return (
    <group>
      <mesh geometry={built.geometry} visible={visible} castShadow receiveShadow userData={{ evidenceMesh: true }}>
        {renderMode === "NORMAL" ? (
          <meshNormalMaterial />
        ) : renderMode === "CURVATURE" || renderMode === "DEPTH" ? (
          <meshBasicMaterial vertexColors />
        ) : representation === "UNLIT_ORIGINAL" ? (
          <meshBasicMaterial vertexColors />
        ) : (
          <meshPhysicalMaterial
            vertexColors
            roughness={isResearch ? 0.95 : 0.8}
            metalness={0}
            envMapIntensity={isResearch ? 0.5 : 1}
            specularIntensity={isResearch ? 0.15 : 0.5}
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
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "";
              }}
            >
              <planeGeometry args={[bw * params.width, bh * params.height]} />
              <meshBasicMaterial
                transparent
                opacity={selected && visible ? 0.08 : 0.001}
                color={selected ? "#9f5b3f" : "#ffffff"}
                depthWrite={false}
              />
            </mesh>
            {selected && (
              <SelectedOutline width={bw * params.width} height={bh * params.height} />
            )}
          </group>
        );
      })}
    </group>
  );
}

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
      <p className="mb-2 text-xs text-ink-2">
        WebGL을 사용할 수 없어 2D 이미지 폴백으로 표시합니다. (측정 3D 아님)
      </p>
      <div className="flex flex-wrap gap-2">
        {cells.map((c) => (
          <button key={c.id} onClick={() => onSelect(c.id)} aria-label={`문자 셀 ${c.id}`}>
            <GlyphPatchSvg cell={c} size={56} selected={c.id === selectedId} />
          </button>
        ))}
      </div>
      {demoLabel && <p className="mt-2 text-xs text-[var(--state-warning)]">{demoLabel}</p>}
    </div>
  );
}

const REPRESENTATIONS = [
  ["RESEARCH_EVIDENCE", "연구형"],
  ["PBR_PRESENTATION", "실감형"],
  ["UNLIT_ORIGINAL", "원본색"],
  ["SPLAT", "Splat"],
  ["POINT_CLOUD", "점군"],
] as const;

const ANALYSIS_MODES: Array<[RenderMode, string]> = [
  ["ALBEDO", "기본"],
  ["NORMAL", "법선"],
  ["CURVATURE", "곡률"],
  ["DEPTH", "깊이"],
];

const CAMERA_MODES = [
  ["PERSPECTIVE_MUSEUM", "관람"],
  ["ORTHOGRAPHIC_RESEARCH", "정사영"],
  ["FRONT_ELEVATION", "정면"],
  ["GLYPH_FOCUS", "글자 포커스"],
] as const;

export function Viewer3D({
  asset,
  cells,
  uiState,
  selectedId,
  onSelect,
  onUiStateChange,
  externalFlyTo,
  onUserInteract,
}: {
  asset: SteleAsset;
  cells: GlyphCell[];
  uiState: TabUiState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUiStateChange: (patch: Partial<TabUiState>) => void;
  /** 외부(쇼케이스 가이드 등)에서 북마크 전환 요청 — seq 증가 시 적용 */
  externalFlyTo?: { name: BookmarkName; seq: number } | null;
  /** 사용자가 무대를 직접 조작하기 시작할 때 (가이드 일시정지용) */
  onUserInteract?: () => void;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const exhibition = useStageMode((s) => s.mode) === "EXHIBITION";
  // 톤매핑 — 기본 ACES, 룩 개발 A/B는 ?toneMapping=AGX|NEUTRAL 쿼리로 비교
  const [toneMappingChoice] = useState<ToneMappingChoice>(() => {
    if (typeof window === "undefined") return "ACES";
    const q = new URLSearchParams(window.location.search).get("toneMapping");
    return q === "AGX" || q === "NEUTRAL" || q === "ACES" ? q : "ACES";
  });
  const [meshInfo, setMeshInfo] = useState({ triangles: 0, vertices: 0, gpuBytes: 0 });
  const [patchStatus, setPatchStatus] = useState<{
    loading: boolean;
    loaded: string[];
    source: string | null;
  }>({ loading: false, loaded: [], source: null });
  const [splatStatus, setSplatStatus] = useState<{
    loading: boolean;
    count: number | null;
    error: string | null;
  }>({ loading: false, count: null, error: null });
  const canvasWrapRef = useRef<HTMLDivElement>(null);

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

  const params = asset.meshParams as unknown as SlabParams;

  // 하위 호환: 구버전 renderMode=RAKING_LIGHT → 사광 프리셋
  const legacyRaking = uiState.renderMode === "RAKING_LIGHT";
  const lightingPreset = legacyRaking ? "RAKING" : (uiState.lightingPreset ?? "MUSEUM_NEUTRAL");
  const representation = uiState.representation ?? "PBR_PRESENTATION";
  const renderMode: RenderMode = legacyRaking ? "ALBEDO" : (uiState.renderMode ?? "ALBEDO");
  const cameraMode = uiState.cameraMode ?? "PERSPECTIVE_MUSEUM";

  // 슬라이더 값: 드래그 중 즉시 반영(로컬) + 서버 저장은 스로틀
  const [numOverride, setNumOverride] = useState<
    Partial<Pick<TabUiState, "exposure" | "aoStrength" | "lightAzimuthDeg" | "lightElevationDeg">>
  >({});
  const pendingRef = useRef<Partial<TabUiState>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeNumber = useCallback(
    (patch: Partial<TabUiState>) => {
      setNumOverride((o) => ({ ...o, ...patch }));
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        onUiStateChange(pendingRef.current);
        pendingRef.current = {};
        timerRef.current = null;
      }, 300);
    },
    [onUiStateChange]
  );
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const aoStrength = numOverride.aoStrength ?? uiState.aoStrength ?? 0.6;
  const exposure = numOverride.exposure ?? uiState.exposure ?? 1;
  const azimuth = numOverride.lightAzimuthDeg ?? uiState.lightAzimuthDeg ?? 105;
  const elevation = numOverride.lightElevationDeg ?? uiState.lightElevationDeg ?? 12;

  const tier = useMemo(() => {
    const t = uiState.qualityTier ?? "AUTO";
    return t === "AUTO" ? detectQualityTier() : t;
  }, [uiState.qualityTier]);
  const tierConfig = QUALITY_TIERS[tier];

  const showSplat = representation === "SPLAT" || representation === "POINT_CLOUD";
  const meshVisible = !showSplat;

  // 단발성 캡처 경로 (CaptureBridge가 채움) — preserveDrawingBuffer 상시 활성 금지
  const captureFnRef = useRef<(() => string) | null>(null);
  const onCaptureReady = useCallback((fn: () => string) => {
    captureFnRef.current = fn;
  }, []);
  const [composerOpen, setComposerOpen] = useState(false);

  // 프레젠테이션 카메라 북마크 (1–5 키)
  const [flyTo, setFlyTo] = useState<FlyToRequest | null>(null);
  const flySeq = useRef(0);
  const goBookmark = useCallback(
    (name: BookmarkName) => {
      const pose = bookmarkPose(name, params, cells, selectedId);
      flySeq.current += 1;
      setFlyTo({ ...pose, duration: 0.7, seq: flySeq.current });
    },
    [params, cells, selectedId]
  );

  // 확대경 (M 키, 2×/4×/8×)
  const [magnifier, setMagnifier] = useState<MagnifierState>({
    active: false,
    zoom: 2,
    x: 200,
    y: 200,
  });
  const cycleZoom = useCallback(() => {
    setMagnifier((m) => ({ ...m, zoom: m.zoom === 2 ? 4 : m.zoom === 4 ? 8 : 2 }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (e.key >= "1" && e.key <= "5") {
        const name = BOOKMARK_ORDER[Number(e.key) - 1];
        if (name) goBookmark(name);
      } else if (e.key === "m" || e.key === "M") {
        setMagnifier((m) => ({ ...m, active: !m.active }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBookmark]);

  // 외부 가이드(쇼케이스) 북마크 요청
  useEffect(() => {
    if (externalFlyTo) goBookmark(externalFlyTo.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFlyTo?.seq]);

  const captureReference = useCallback(async () => {
    const dataUrl = captureFnRef.current?.();
    if (!dataUrl) return;
    await fetch("/api/3d/reference-renders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: asset.id,
        name: `ref-${new Date().toISOString().slice(0, 19)}`,
        imageDataUrl: dataUrl,
        camera: uiState.camera ?? {},
        lighting: { preset: lightingPreset, exposure, aoStrength },
      }),
    });
  }, [asset.id, uiState.camera, lightingPreset, exposure, aoStrength]);

  if (webgl === null) {
    return <div className="p-6 text-sm text-ink-2">3D 뷰어 준비 중…</div>;
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

  const rakingActive = lightingPreset === "RAKING" || lightingPreset === "SWEEP";
  const lightingConfig = LIGHTING_PRESETS[lightingPreset];
  // 무대 배경 — 전시: 프리셋 웜 무대 / 연구: 중립 라이트 그레이 (사광 계열은 딥 그레이 유지)
  const stageColors = exhibition
    ? lightingConfig.stage
    : (lightingConfig.stageResearch ?? RESEARCH_STAGE);

  return (
    <div className="relative flex h-full min-h-[320px] flex-col" data-testid="viewer-3d">
      {/* 툴바 — 전시 보기에서는 관람에 필요한 조명·카메라만 남긴다.
          모드 전환은 표시 계층만 바꾸며 카메라·선택·탭 상태를 건드리지 않는다. */}
      {exhibition ? (
        <div
          className="flex flex-wrap items-center gap-1 border-b border-[var(--panel-border)] bg-surface-muted px-2 py-1 text-[11px]"
          data-testid="exhibition-toolbar"
        >
          <span className="text-ink-3">조명</span>
          {(["MUSEUM_NEUTRAL", "FIELD_DAYLIGHT", "RAKING"] as const).map((key) => (
            <button
              key={key}
              data-testid={`light-${key}`}
              aria-pressed={lightingPreset === key}
              onClick={() => onUiStateChange({ lightingPreset: key, renderMode: renderMode })}
              className={`badge ${lightingPreset === key ? "badge-demo" : "badge-neutral"}`}
              title={LIGHTING_PRESETS[key].note}
            >
              {LIGHTING_PRESETS[key].label}
            </button>
          ))}
          <span className="ml-2 text-ink-3">카메라</span>
          {CAMERA_MODES.map(([key, label]) => (
            <button
              key={key}
              data-testid={`cam-${key}`}
              aria-pressed={cameraMode === key}
              onClick={() => onUiStateChange({ cameraMode: key })}
              className={`badge ${cameraMode === key ? "badge-demo" : "badge-neutral"}`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-ink-3">
            표시 설정 전용 — 측정·판독 기준은 연구 보기
          </span>
        </div>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--panel-border)] bg-surface-muted px-2 py-1 text-[11px]">
        <span className="text-ink-3">표현</span>
        {REPRESENTATIONS.map(([key, label]) => (
          <button
            key={key}
            data-testid={`rep-${key}`}
            aria-pressed={representation === key}
            onClick={() => onUiStateChange({ representation: key })}
            className={`badge ${representation === key ? "badge-demo" : "badge-neutral"}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-2 text-ink-3">조명</span>
        {(Object.keys(LIGHTING_PRESETS) as Array<keyof typeof LIGHTING_PRESETS>).map((key) => (
          <button
            key={key}
            data-testid={`light-${key}`}
            aria-pressed={lightingPreset === key}
            onClick={() => onUiStateChange({ lightingPreset: key, renderMode: renderMode })}
            className={`badge ${lightingPreset === key ? "badge-demo" : "badge-neutral"}`}
            title={LIGHTING_PRESETS[key].note}
          >
            {LIGHTING_PRESETS[key].label}
          </button>
        ))}
        <span className="ml-2 text-ink-3">분석</span>
        {ANALYSIS_MODES.map(([key, label]) => (
          <button
            key={key}
            data-testid={`mode-${key}`}
            aria-pressed={renderMode === key}
            onClick={() => onUiStateChange({ renderMode: key })}
            className={`badge ${renderMode === key ? "badge-demo" : "badge-neutral"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--panel-border)] bg-surface-muted px-2 py-1 text-[11px]">
        <span className="text-ink-3">카메라</span>
        {CAMERA_MODES.map(([key, label]) => (
          <button
            key={key}
            data-testid={`cam-${key}`}
            aria-pressed={cameraMode === key}
            onClick={() => onUiStateChange({ cameraMode: key })}
            className={`badge ${cameraMode === key ? "badge-demo" : "badge-neutral"}`}
          >
            {label}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1">
          <span className="text-ink-3">품질</span>
          <select
            value={uiState.qualityTier ?? "AUTO"}
            onChange={(e) => onUiStateChange({ qualityTier: e.target.value as TabUiState["qualityTier"] })}
            className="badge badge-neutral bg-[var(--panel-bg)]"
            aria-label="GPU 품질 단계"
            data-testid="quality-tier"
          >
            <option value="AUTO">Auto ({QUALITY_TIERS[tier].label})</option>
            {Object.entries(QUALITY_TIERS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-ink-3">LOD</span>
          <select
            value={uiState.lodLevel}
            onChange={(e) => onUiStateChange({ lodLevel: e.target.value as TabUiState["lodLevel"] })}
            className="badge badge-neutral bg-[var(--panel-bg)]"
            aria-label="LOD 선택"
          >
            <option value="PREVIEW">미리보기</option>
            <option value="MEDIUM">중간</option>
            <option value="FULL">최대</option>
          </select>
        </label>
        <label className="flex items-center gap-1" title="노출 (톤매핑 ACES)">
          <span className="text-ink-3">노출</span>
          <input
            type="range" min={0.4} max={2} step={0.05} value={exposure}
            onChange={(e) => changeNumber({ exposure: Number(e.target.value) })}
            className="w-16" aria-label="노출"
          />
          <span className="tabular-nums">{exposure.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-1" title="음영(cavity) 강도 — 과장 방지 위해 수치 표시">
          <span className="text-ink-3">AO</span>
          <input
            type="range" min={0} max={1.2} step={0.05} value={aoStrength}
            onChange={(e) => changeNumber({ aoStrength: Number(e.target.value) })}
            className="w-16" aria-label="AO 강도" data-testid="ao-slider"
          />
          <span className="tabular-nums" data-testid="ao-value">{aoStrength.toFixed(2)}</span>
        </label>
        {rakingActive && (
          <>
            <label className="flex items-center gap-1">
              <span className="text-ink-3">방위각</span>
              <input
                type="range" min={0} max={360} step={5} value={azimuth}
                onChange={(e) => changeNumber({ lightAzimuthDeg: Number(e.target.value) })}
                className="w-20" aria-label="사광 방위각" data-testid="raking-azimuth"
              />
              <span className="tabular-nums">{azimuth}°</span>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-ink-3">고도</span>
              <input
                type="range" min={2} max={60} step={2} value={elevation}
                onChange={(e) => changeNumber({ lightElevationDeg: Number(e.target.value) })}
                className="w-16" aria-label="사광 고도"
              />
              <span className="tabular-nums">{elevation}°</span>
            </label>
          </>
        )}
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={`badge ml-auto ${panelOpen ? "badge-demo" : "badge-neutral"}`}
          data-testid="quality-panel-toggle"
        >
          3D 품질
        </button>
        <button onClick={() => void captureReference()} className="badge badge-neutral" data-testid="save-reference">
          기준 렌더 저장
        </button>
      </div>
      </>
      )}

      {/* 관찰 도구 행 — 카메라 북마크(1–5) · 확대경(M) · 촬영 (양 모드 공통) */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--panel-border)] bg-surface px-2 py-1 text-[11px]">
        <span className="text-ink-3">북마크</span>
        {BOOKMARK_ORDER.map((name, i) => (
          <button
            key={name}
            data-testid={`bookmark-${name}`}
            onClick={() => goBookmark(name)}
            className="badge badge-neutral"
            title={`${BOOKMARK_LABEL[name]} (${i + 1} 키)`}
          >
            {i + 1} {BOOKMARK_LABEL[name]}
          </button>
        ))}
        <span className="ml-2 text-ink-3">확대경</span>
        <button
          data-testid="magnifier-toggle"
          aria-pressed={magnifier.active}
          onClick={() => setMagnifier((m) => ({ ...m, active: !m.active }))}
          className={`badge ${magnifier.active ? "badge-demo" : "badge-neutral"}`}
          title="확대경 켜기/끄기 (M 키) — Evidence Mesh 기준"
        >
          M
        </button>
        {magnifier.active && (
          <button
            data-testid="magnifier-zoom"
            onClick={cycleZoom}
            className="badge badge-neutral"
            title="배율 전환 2×/4×/8×"
          >
            {magnifier.zoom}×
          </button>
        )}
        <button
          data-testid="screenshot-composer-open"
          onClick={() => setComposerOpen((v) => !v)}
          className={`badge ml-auto ${composerOpen ? "badge-demo" : "badge-neutral"}`}
        >
          촬영
        </button>
      </div>

      <div
        ref={canvasWrapRef}
        className="relative min-h-0 flex-1 cursor-grab active:cursor-grabbing"
        data-testid="stele-stage"
        style={{
          // CSS cyclorama — 캔버스는 투명, 무대 배경은 표시 계층 (검은 배경 금지)
          background: `linear-gradient(180deg, ${stageColors.top} 0%, ${stageColors.bottom} 100%)`,
          transition: "background 240ms ease",
        }}
        onPointerMove={(e) => {
          if (!magnifier.active || !canvasWrapRef.current) return;
          const rect = canvasWrapRef.current.getBoundingClientRect();
          setMagnifier((m) => ({ ...m, x: e.clientX - rect.left, y: e.clientY - rect.top }));
        }}
        onPointerDown={() => onUserInteract?.()}
      >
        <Canvas
          frameloop="demand"
          shadows={tierConfig.shadowMapSize > 0}
          dpr={tierConfig.dpr}
          gl={{ powerPreference: "low-power", antialias: true, alpha: true }}
        >
          <SteleLightingRig
            preset={lightingPreset}
            azimuthDeg={azimuth}
            elevationDeg={elevation}
            exposure={exposure}
            shadowMapSize={tierConfig.shadowMapSize}
            sweep={lightingPreset === "SWEEP"}
            groundY={-params.height / 2 - 0.02}
            toneMapping={toneMappingChoice}
          />
          {exhibition && meshVisible && <PresentationStage params={params} />}
          <SteleCameraRig
            mode={cameraMode}
            params={params}
            cells={cells}
            selectedId={selectedId}
            uiState={uiState}
            onCameraChange={(camera) => onUiStateChange({ camera })}
            flyTo={flyTo}
          />
          <CaptureBridge onReady={onCaptureReady} />
          {magnifier.active && <MagnifierLens state={magnifier} />}
          <SteleMeshLayer
            params={params}
            cells={cells}
            lod={uiState.lodLevel}
            renderMode={renderMode}
            representation={representation}
            aoStrength={aoStrength}
            visible={meshVisible}
            selectedId={selectedId}
            onSelect={onSelect}
            onBuilt={setMeshInfo}
          />
          {meshVisible && renderMode === "ALBEDO" && tierConfig.maxDetailPatches > 0 && (
            <GlyphDetailPatchLayer
              assetId={asset.id}
              params={params}
              cells={cells}
              selectedId={selectedId}
              maxPatches={tierConfig.maxDetailPatches}
              roughness={representation === "RESEARCH_EVIDENCE" ? 0.95 : 0.8}
              onStatus={setPatchStatus}
            />
          )}
          {showSplat && (
            <SplatLayer
              assetId={asset.id}
              mode={representation === "SPLAT" ? "SPLAT" : "POINTS"}
              fraction={tierConfig.splatFraction}
              onStatus={setSplatStatus}
            />
          )}
          <StatsBridge gpuBytesEstimate={meshInfo.gpuBytes} />
        </Canvas>

        {/* 배지·상태 오버레이 */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
          <DemoBadge label={asset.demoLabel ?? "가상 데모 메시"} />
          <span className="badge badge-neutral">실제 유물 3D 아님 · 절차 생성 데모</span>
          {representation === "SPLAT" && (
            <span className="badge badge-warn" data-testid="splat-warning">
              Splat = 표시 전용 · 측정/판독 기준 아님 (선택은 Evidence 좌표 사용)
            </span>
          )}
          {representation === "RESEARCH_EVIDENCE" && (
            <span className="badge badge-ok">실측 기준 표현(가상 단위) · 측정 허용</span>
          )}
          {representation === "PBR_PRESENTATION" && (
            <span className="badge badge-neutral">표현 보강(PBR) — 판독 기준은 연구형</span>
          )}
        </div>
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1 text-[10px]">
          {patchStatus.loading && <span className="badge badge-warn">글자 패치 준비 중…</span>}
          {patchStatus.loaded.length > 0 && !patchStatus.loading && (
            <span className="badge badge-ok" data-testid="patch-loaded">
              고해상 패치 {patchStatus.loaded.length}개 (128×128{patchStatus.source === "LOCAL_FALLBACK" ? " · 로컬" : ""})
            </span>
          )}
          {splatStatus.loading && <span className="badge badge-warn">Gaussian-style splat 스트리밍…</span>}
          {splatStatus.count !== null && showSplat && (
            <span className="badge badge-neutral" data-testid="splat-loaded">
              splat {Math.floor(splatStatus.count * tierConfig.splatFraction).toLocaleString()}점
            </span>
          )}
          {splatStatus.error && <span className="badge badge-rights">{splatStatus.error}</span>}
        </div>
        {/* 범례 + 축척 */}
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1 text-[10px]">
          {(renderMode === "CURVATURE" || renderMode === "DEPTH") && (
            <div className="rounded bg-[var(--surface-elevated)] px-2 py-1 shadow-[var(--shadow-xs)]">
              <div
                className="h-2 w-28 rounded"
                style={{
                  background:
                    renderMode === "DEPTH"
                      ? "linear-gradient(90deg,#2633ff,#d9302a)"
                      : "linear-gradient(90deg,#40e5e5,#e58a40)",
                }}
              />
              <p className="mt-0.5 text-ink-2">
                {renderMode === "DEPTH" ? "얕음 → 깊음" : "평면 → 홈"} · 가상 단위 (실측 아님)
              </p>
            </div>
          )}
          <span className="badge badge-neutral">상대 크기 · 가상 단위 — mm 환산 없음</span>
        </div>
        {/* 확대경 링 오버레이 — 렌즈 렌더 영역 표시 + LOD·패치 상태 */}
        {magnifier.active && canvasWrapRef.current && (() => {
          const rect = canvasWrapRef.current.getBoundingClientRect();
          const { cx, cy } = lensCenter(magnifier, rect.width, rect.height);
          return (
            <div
              className="pointer-events-none absolute z-10"
              data-testid="magnifier-ring"
              style={{ left: cx - LENS_SIZE / 2, top: cy - LENS_SIZE / 2, width: LENS_SIZE, height: LENS_SIZE }}
            >
              <div className="h-full w-full rounded-lg border-2 border-clay shadow-[var(--shadow-sm)]" />
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] shadow-[var(--shadow-xs)]">
                {magnifier.zoom}× · Evidence 기준 · LOD{" "}
                {uiState.lodLevel === "FULL" ? "최대" : uiState.lodLevel === "MEDIUM" ? "중간" : "미리보기"}
                {patchStatus.loaded.length > 0 ? ` · 패치 ${patchStatus.loaded.length}` : ""}
              </span>
            </div>
          );
        })()}
        {composerOpen && (
          <ScreenshotComposer
            onClose={() => setComposerOpen(false)}
            captureRaw={() => captureFnRef.current?.() ?? ""}
            stage={stageColors}
            meta={{
              steleName: asset.demoLabel ?? asset.id,
              assetId: asset.id,
              lod: uiState.lodLevel,
              representation,
              lightingPreset,
              renderMode,
              toneMapping: toneMappingChoice,
              measurementAllowed: representation === "RESEARCH_EVIDENCE",
              source: "VIRTUAL_DEMO — 실제 유물 3D 아님",
              camera: uiState.camera ?? null,
            }}
          />
        )}
        {panelOpen && (
          <ThreeDQualityPanel
            asset={asset}
            representation={representation}
            lod={uiState.lodLevel}
            tier={tier}
            meshInfo={meshInfo}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
