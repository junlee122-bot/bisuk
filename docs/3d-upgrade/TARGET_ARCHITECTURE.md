# 목표 아키텍처 — 하이브리드 3D 구조

## 1. 세 가지 표현 (명세 §0.3)

```
Evidence Mesh        연구·측정 기준. 좌표 선택·깊이·곡률·거리의 유일한 기준.
PBR Presentation     Evidence 기하를 보존한 실감형 표현 (재질·조명·AO 강화). PRESENTATION_ENHANCED.
Photoreal Splat      point-splat 실감 레이어 (데모: 합성 표면 점). visualization_only=true,
                     picking·측정은 항상 Evidence Mesh 사용.
```

## 2. 자산 계보

```
SteleAsset (원본, 불변)
 └─ AssetVariant[]  (파생 — parent_variant_ids 로 계보 기록)
     ├─ EVIDENCE_MESH_{PREVIEW,MEDIUM,HIGH}   measurement_allowed=true,  source_state=DERIVED
     ├─ PBR_MESH_{PREVIEW,MEDIUM,HIGH}        measurement_allowed=false, source_state=PRESENTATION_ENHANCED
     ├─ GLYPH_DETAIL_PATCH (셀별)             measurement_allowed=true,  source_state=DERIVED
     ├─ SPLAT_SOURCE_PLY / SPLAT_DELIVERY_SOG visualization_only=true
     └─ REFERENCE_RENDER / THUMBNAIL
```

- 원본(`originals/`)은 쓰기 1회(`wx`) + sha256. 파생은 `derived/`에 GLB/PLY/JSON으로 저장.
- 모든 variant는 `pipeline_name/version/parameters`, `sha256`, `measurement_allowed`,
  `visualization_only`, `quality_level(Q0~Q4)` 를 기록한다.
- `GENERATED_VISUAL_ONLY` 레이어는 P0에 존재하지 않으며(생성형 미사용), 도입 시 기본 비활성 +
  워터마크 정책을 따른다.

## 3. 웹 뷰어 (apps/web/src/features/high-fidelity-3d)

```
HybridSteleViewport
 ├─ SteleCameraRig        PERSPECTIVE_MUSEUM(fov30) / ORTHOGRAPHIC_RESEARCH / FRONT_ELEVATION /
 │                        GLYPH_FOCUS(부드러운 포커스+즉시 중단) · bbox 기반 near/far
 ├─ SteleLightingRig      Museum/Field/Lab/Raking(방위·고도 슬라이더)/Sweep/Unlit + RoomEnvironment IBL
 │                        + 소프트 그림자 + 접지 평면
 ├─ EvidenceMeshLayer     GLB variant 로딩(GLTFLoader) 또는 절차 생성 폴백 · picking 전용
 ├─ PresentationLayer     PBR 재질(MeshPhysicalMaterial, metalness 0) · AO/cavity 강도 슬라이더
 ├─ SplatLayer            point-splat 데모 렌더러 (표시 전용)
 ├─ GlyphDetailPatchLayer 선택/확대 시 고해상도 패치 스트리밍 (feather + depth bias)
 ├─ AnalysisOverlay       Normal/Curvature/Depth false-color + legend
 └─ ThreeDQualityPanel    실측 수치 + 고지문 + 진단 경고 + before/after 비교
```

- 표현 전환(연구형/실감형/원본색/Splat/점군) 시 카메라 유지 (공유 카메라 상태).
- 품질 단계 AUTO/ULTRA/HIGH/BALANCED/MOBILE/BATTERY_SAVER → dpr·그림자 해상도·패치 수 조절.
- 비활성 탭: Canvas 언마운트 + dispose (기존 정책 유지, 카운터 검증).

## 4. API (apps/api, /api/3d/*)

- variants CRUD/activate, upgrade(데모 파이프라인 job), quality-report(고지문 포함),
  detail-patches, reference-renders, render-presets, adapters(가용성 검증), splat demo 생성.
- Job은 실제 단계(INSPECTING→GENERATING_LOD→COMPRESSING→QUALITY_CHECK→READY)와
  재현 정보(파이프라인 버전·파라미터·입력 해시)를 기록. 가짜 진행률 없음.

## 5. 외부 도구 어댑터

공통 인터페이스(ReconstructionAdapter)로 등록: COLMAP·Meshroom·Blender·Nerfstudio·
splat-transform·RealityScan·Metashape·Sketchfab·OpenHeritage3D.
이 컨테이너에는 어떤 바이너리도 설치되어 있지 않으므로 전부 `UNAVAILABLE`로 정직하게 표시되고,
앱은 데모 경로(순수 TS 파이프라인)로 전체 흐름이 동작한다.
