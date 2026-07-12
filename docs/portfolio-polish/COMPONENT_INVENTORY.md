# 컴포넌트 인벤토리 — 현재 스타일 → 계획 변경

범례 — 위험도: 낮음(스타일만) / 중간(구조 변경) / 높음(상태·테스트 연동)

## 앱 셸

| 컴포넌트 | 현재 | 계획 | 위험 |
|---|---|---|---|
| `app/layout.tsx` | 폰트 없음, 글로벌 헤더 없음 | next/font(Noto Serif/Sans KR) + GlobalHeader 삽입 | 중간 |
| `app/globals.css` | 다크 토큰 5종 + 다크 배지 6종 | 라이트 토큰 체계 전면 교체(§3.1) + 배지 반전 | **높음** (전 화면 파급) |
| `app/page.tsx` (대시보드) | 다크 카드 + text-neutral-* | 표면 토큰 카드 + serif 제목 + 그림자 | 낮음 |
| `app/frontier/page.tsx` | 동일 다크 | 토큰 치환 | 낮음 |
| `app/sets/[setId]/audit/page.tsx` | 다크 표 | 토큰 치환 | 낮음 |
| (신규) `GlobalHeader` | 없음 | 석문 Studio 워드마크 + 전시/연구 전환 + 브레드크럼 | 중간 |
| (신규) `app/showcase/[setId]` | 없음 | Phase 4 스토리 모드 | 중간 |

## 워크스페이스

| 컴포넌트 | 현재 | 계획 | 위험 |
|---|---|---|---|
| `workspace/Workspace.tsx` | 3열 다크, 세트 헤더에 기능 버튼 집중 | 토큰화 + 요약 수치 중복 제거 + 모드 인지 | 중간 |
| `workspace/TabStrip.tsx` | 탭당 배지 4–7개 과밀 | 배지 ≤3 + "+n" 오버플로, 활성 탭 클레이 언더라인 | 중간 (E2E 탭 testid 유지) |
| `workspace/Workbench.tsx` | 다크 뷰 전환, enum 라벨 노출 | 토큰화 + 상태 라벨 인간화 | 낮음 |
| `workspace/GlyphTree.tsx` | 다크 셀 카드, 흰 SVG 패치가 과다 발광 | 라이트 카드 + 패치 반전(종이 위 먹) | 낮음 |
| `workspace/EvidencePanel.tsx` | `bg-[#26262e]` 카드 | `--surface-secondary` 카드 | 낮음 |
| `workspace/CompareTray.tsx` | `bg-[#1a1a20]` 바 | `--surface-elevated` + 그림자 | 낮음 |
| `workspace/DossierModal.tsx` | `bg-black/70` + 다크 카드 | 밝은 스크림(rgba 잉크 저투명) + 라이트 카드 | 낮음 |
| `workspace/ExportModal.tsx` | 동일 | 동일 | 낮음 |
| `workspace/SourceCardPanel.tsx` | 다크 폼 | 토큰화 | 낮음 |
| `GlyphPatchSvg.tsx` | 어두운 패치(#2b2b33) + 밝은 획 | **반전**: 종이 배경 + 먹 획, 미관측 획은 점선/저대비 유지 | 중간 (시각 회귀 기준 갱신) |
| `badges.tsx` | 다크 배지 톤 | 라이트 저채도 배지 + 아이콘 | 낮음 |

## 3D

| 컴포넌트 | 현재 | 계획 | 위험 |
|---|---|---|---|
| `high-fidelity-3d/presets.ts` | 배경 6종 전부 다크, key 강도 다크 전제 | 배경 → 무대 토큰/투명, 강도 재보정, `PORTFOLIO_HERO` 등 SceneLook 6종 연동 | **높음** (시각 회귀 전면 갱신) |
| `HybridSteleViewport.tsx` | `preserveDrawingBuffer:true` 상시, 툴바 25+ 컨트롤, 다크 오버레이 | 투명 캔버스 + CSS cyclorama, EXHIBITION 툴바 축소, 원샷 캡처로 전환, 북마크·매그니파이어 진입점 | **높음** |
| `SteleCameraRig.tsx` | 기본 정면 카메라, 글자 포커스만 애니메이션 | ¾ 히어로 기본 + CameraBookmark 5종 + 500–900ms 전환 + 중단 + reduced-motion | **높음** |
| `SteleLightingRig.tsx` | 프리셋 즉시 교체 | 180–320ms 보간 + 림 라이트 + 접지 그림자 강화 | 중간 |
| (신규) `PresentationStage.tsx` | 없음 | 바닥+플린스 — 별도 노드, raycastable=false, PRESENTATION_STAGE_ONLY, EXHIBITION 전용 | 중간 |
| (신규) `MagnifierLens.tsx` | 없음 | M 키 2×/4×/8× — Evidence 기하 기반 | 중간 |
| (신규) `ScreenshotComposer.tsx` | 없음 | 무대만/투명/메타 sidecar — 원샷 캡처 | 중간 |
| `GlyphDetailPatchLayer.tsx` / `SplatLayer.tsx` | 동작 유지 | 시각만 무대 정합(변경 최소) | 낮음 |
| `ThreeDQualityPanel.tsx` | 다크 패널 | 토큰화 + RESEARCH 전용 노출 | 낮음 |
| `compare/SurfaceCompare.tsx` | 캔버스 `#151518` | 중립 라이트 그레이 배경 + 토큰 UI | 중간 |
| `three/FragmentViewer.tsx` | 캔버스 `#111114` | 동일 계열 라이트 처리 | 낮음 |
| `compare/CompareScreen.tsx` | 다크 표 | 라이트 표 + 빈 상태 디자인 | 낮음 |

## 상태·데이터 (Phase 5)

| 항목 | 현재 | 계획 |
|---|---|---|
| `TabUiState` | representation·조명·카메라 저장 | +`viewMode(EXHIBITION/RESEARCH)` — 전환 시 카메라·선택 유지 |
| SceneLook | 없음 | zod 스키마 + CRUD + 프리셋 6종 시드 |
| CameraBookmark | 없음 | 스키마 + 기본 5종 + API |
| LOD 선택 | 수동 select | 화면공간 오차 자동 LOD + 히스테리시스 (엔진 순수 함수) |
| PLY 파서 | ASCII 전용 | +binary_little_endian |
| 렌더러 플래그 | 없음 | `NEXT_PUBLIC_3D_RENDERER=webgl\|auto\|webgpu` (기본 webgl) |

## 테스트 자산 (Phase 6 — 갱신 대상)

- `e2e/tests/visual.spec.ts-snapshots/` 5장: 라이트 테마로 **기준 재생성 필수**.
- consoleGuard·GPU 해제·모바일 E2E: 동작 유지 확인 (스타일 변경만으로 깨지지 않아야).
- 기존 26 E2E의 testid는 전부 보존한다 — 스타일 변경 시 testid 제거 금지.
