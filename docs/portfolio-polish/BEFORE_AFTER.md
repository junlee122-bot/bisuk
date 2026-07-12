# Before / After — 포트폴리오 폴리시

동일 카메라·뷰포트·데이터로 캡처. Before: `screenshots/before/` ·
After: `screenshots/after/` (+JSON sidecar) · 합성 비교:
`screenshots/portfolio-pack/11_before_after_split_1920x1080.png`
재현: `node e2e/scripts/capture-polish-before.cjs` / `capture-polish-after.cjs`

| 화면 | Before | After |
|---|---|---|
| 워크스페이스 기본 | `#16161a` 전면 다크, 앱 정체성 없음, 배지 과밀 | 웜 페이퍼 무대(#f3f0e9), 석문 Studio 글로벌 헤더 + 전시/연구 전환, serif 위계 |
| 3D 무대 | 프리셋별 검정 계열 clear color(#1a1a1e~#101013), 부유하는 비석 | 투명 캔버스 + CSS cyclorama, 전시 보기 플린스·바닥(PRESENTATION_STAGE_ONLY), 림 라이트, ¾ 히어로 프레이밍(≈76%) |
| 자형 패치 | 어두운 패치(#2b2b33) + 밝은 획 | 종이 위 먹 반전 — 관측 실선·마모 점선 유지 |
| Glyph Matrix / Surface Compare / Dossier | 다크 표·캔버스(#151518) | 라이트 표·중립 라이트 그레이 분석 무대 |
| 관찰 도구 | 글자 포커스만 | 카메라 북마크 5종(1–5 키·중단 가능·감속) + 확대경 2×/4×/8×(M, Evidence 기준) + 촬영 컴포저(투명/프레임/메타데이터) |
| 포트폴리오 동선 | 없음 | `/showcase/[setId]` — 실측 지표 히어로 + 5챕터 스토리 + 가이드 카메라 + 권리 게이트 |
| LOD | 수동 3단 | +AUTO (화면 공간 오차 + 히스테리시스, 글자 포커스 FULL 우선) |
| 캡처 경로 | `preserveDrawingBuffer` 상시 켜짐 | 단발성 렌더 직후 캡처 (상시 옵션 제거) |

## 수치 (localhost · headless Chromium 141 · SwiftShader 소프트웨어 GPU)

| 지표 | Before(3D 업그레이드 후) | After(폴리시 후) |
|---|---|---|
| 캔버스 표시 (데스크톱 웜) | 369 ms | 371 ms |
| 쇼케이스 표시 (웜) | — (기능 없음) | 471 ms |
| 캔버스 표시 (모바일 뷰포트, 콜드 라우트 포함) | 310–378 ms(웜) | 2146 ms(콜드) / 첫 진입 후 웜 동등 |
| 드래그 실렌더 FPS (MEDIUM·그림자 1024) | 7 | 12 (무대 추가에도 렌더 수 개선 — SwiftShader 기준, 절대치 아님) |
| draw calls / 삼각형 | 16 / 12,328 | 20 / 12,336 (플린스+바닥+림 추가분) |
| 테스트 | 엔진 53 · API 33 · E2E 26 | **엔진 65 · API 38 · E2E 51** (기존 전부 유지) |
| 시각 회귀 기준 | 다크 5장 | **라이트 17장** (검은 배경 재발 시 실패) |

> FPS·시간은 소프트웨어 렌더러 기준 — 실기기 수치는 `REAL_DEVICE_TEST_PLAN.md`
> 절차로 확보 전까지 `PENDING_REAL_DEVICE`.
