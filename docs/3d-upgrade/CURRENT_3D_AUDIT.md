# 업그레이드 전 3D 구현 감사 (실측 기준)

> 감사 시점: 커밋 `4bf62ee` · 캡처: `docs/3d-upgrade/screenshots/before/` (+JSON sidecar)
> 환경: 컨테이너 headless Chromium 141 + **SwiftShader(소프트웨어 GPU)** — FPS·GPU 수치는 실제 하드웨어 GPU를 대표하지 않음.

## 1. 스택 (실측)

| 항목 | 값 |
|---|---|
| three | 0.180.0 |
| @react-three/fiber | 9.6.1 |
| @react-three/drei | 10.7.7 (OrbitControls만 사용) |
| 렌더러 | WebGLRenderer (R3F 기본). WebGPU 미사용 |
| 로더 | **없음** — 전량 절차 생성(BoxGeometry+정점 변위). GLTF/PLY/OBJ 로더 미사용 |
| Draco / Meshopt / KTX2 | 미지원 |
| 텍스처 | **0장** — 정점 색(COLOR attribute)만 사용 |

## 2. 렌더링 상태 (코드 기준)

- **컬러 매니지먼트**: 명시 설정 없음 → R3F 기본(outputColorSpace=sRGB, toneMapping=ACESFilmic, exposure=1). 명시적 프리셋·노출 제어 부재.
- **재질**: `MeshStandardMaterial{ vertexColors, roughness:0.92(상수), metalness:0.02 }` 단일 재질. roughness/normal/AO 맵 없음. metalness 0.02는 불필요(석재는 0이어야 함).
- **조명**: 하드코딩 2모드 — 기본(ambient 0.55 + dir×2), 사광(ambient 0.12 + dir[4,0.4,0.6] i=2.6). 환경광(IBL) 없음, **그림자 없음**, 사광 방위각·고도 조절 불가(왼쪽 고정), 배경 단색 `#111114`.
- **분석 모드**: NORMAL(meshNormalMaterial), CURVATURE(정점색 스왑+flatShading). 깊이 히트맵·legend·단위 표시 없음.
- **카메라**: PerspectiveCamera fov 40 고정, near/far 기본(0.1/1000 — depth 정밀도 낭비), 직교/정면/글자 포커스 모드 없음, 글자 선택 시 카메라 이동 없음.
- **픽셀 비율**: 미관리(R3F 기본 dpr). 품질 단계(ULTRA~BATTERY_SAVER) 없음.
- **렌더 루프**: `frameloop="demand"` ✓ (정적 시 렌더 정지).
- **GPU 해제**: 탭 비활성 시 Canvas 언마운트 + geometry.dispose ✓ (`window.__seokmunGl` 카운터로 E2E 검증됨).

## 3. 메시·부하 (실측/산출)

| 항목 | 값 |
|---|---|
| DEMO-A MEDIUM(48×128) | 약 25,280 삼각형 / 12,850 정점 |
| DEMO-A FULL(96×256) | 약 99,700 삼각형 |
| 재질/draw call | 재질 1 + 셀 오버레이 평면 18개 (≈19 draw call) |
| 텍스처 메모리 | 0 (정점 색만) |
| 캔버스 표시까지 | 데스크톱 801ms · 모바일 뷰포트 378ms (localhost) |
| FPS 근사 | 데스크톱 ~58 · 모바일 ~59 (rAF 유도 근사, SwiftShader) |
| JS heap | sidecar 참조 |

## 4. 병목 분류 (스크린샷 근거)

| # | 문제 | 분류 | 근거 |
|---|---|---|---|
| 1 | 클로즈업에서 획이 계단(직소) 형태로 뭉개짐 | SOURCE_QUALITY + LOD_STREAMING | `front-glyph-closeup.png` — 색·기하 해상도가 48×128 격자에 고정, 글자 detail patch 없음 |
| 2 | 표면이 플라스틱 점토처럼 균일 | MATERIAL_MODEL + TEXTURE_QUALITY | roughness 상수 0.92, 미세 요철·알베도 변화 없음 |
| 3 | 환경광 부재로 음영이 죽어 있고 배경과 붕 뜸 | LIGHTING | IBL·그림자·접지 없음 (`front-full.png`) |
| 4 | 사광이 한 방향 고정, 방위각·고도·스윕 불가 | LIGHTING + UI_PRESENTATION | `raking-light-left.png`만 존재, right/top/bottom 캡처 불가 |
| 5 | 노출·톤매핑 제어 없음 (프리셋 저장 불가) | COLOR_MANAGEMENT | 코드에 toneMapping/exposure 미설정 |
| 6 | near/far 미관리, 직교·정면·매크로 카메라 없음 | CAMERA | Viewer3D.tsx |
| 7 | dpr 미관리 — 고dpr 기기에서 과부하 가능 | GPU_MEMORY | Canvas prop 부재 |
| 8 | 원본/파생/표현 자산 계층 없음 (단일 절차 메시) | GEOMETRY_PROCESSING | SteleAsset에 variant 개념 부재 |
| 9 | 업로드된 실제 PLY/STL이 뷰어에 표시되지 않음 (품질 보고서만) | GEOMETRY_PROCESSING | server.ts 업로드 경로 |
| 10 | 깊이/곡률 모드에 legend·단위 없음 | UI_PRESENTATION | Viewer3D.tsx |

**주의**: #1·#2·#9는 원본 데이터·자산 파이프라인 문제로, 셰이더만으로는 해결되지 않는다 (파생 자산 파이프라인 필요).

## 5. 데모 모델의 정체 (명시)

현재 3D는 **실제 스캔이 아니라 절차 생성 가상 메시(DEMO-A/B/C)**다. 화면에 "가상 데모 · 실제 유물 3D 아님" 배지가 상시 표시되며, 업그레이드 후에도 이 표기는 유지한다.
