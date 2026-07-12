# Before / After 비교

동일 고정 카메라 3종(front-full / front-medium / front-glyph-closeup)과 동일 뷰포트로
캡처. Before: `screenshots/before/` · After: `screenshots/after/` (+JSON sidecar).
재현: `node e2e/scripts/capture-3d-shots.cjs` (before 시점 코드) /
`node e2e/scripts/capture-3d-after.cjs`.

| 화면 | Before | After | 변화 |
|---|---|---|---|
| front-full | 균일 매트 회색, 환경광·그림자 없음, 배경과 분리 | 석재 입자·풍화 얼룩, IBL+소프트 그림자·접지, ACES 톤매핑 | 재질·조명·색관리 |
| front-glyph-closeup | 48×128 격자 계단 현상 + 정점색 블러 — 판독 불가 수준 | FULL LOD(144×384) + 128×128 detail patch — 획 벽·바닥 명확 | LOD+패치 스트리밍 |
| raking-light-left | 사광 1방향 고정, 노출 보정 없음 | 방위각·고도 슬라이더, 105°/12° | 프리셋화 |
| raking-light-right | **캡처 불가 (기능 없음)** | 255° 사광 — 반대측 음영 관찰 가능 | 신규 |
| normal / curvature | 법선·flat 정점색 | 동일+범례·가상단위 표기, DEPTH 모드 추가 | 분석 모드 |
| research-lab | 없음 (연구/실감 분리 없음) | 연구형 표현 + Lab 균일광 | 신규 |
| splat-view | 없음 | 60k point-splat (표시 전용 경고 동반) | 신규 |
| multi-tab / mobile | 동일 정책 (GPU 해제 유지) | 동일 + 품질 단계별 dpr | 유지+개선 |

## 수치 (localhost · headless Chromium 141 · SwiftShader 소프트웨어 GPU)

| 지표 | Before | After |
|---|---|---|
| 캔버스 표시 (데스크톱) | 801 ms | 369 ms (웜) / 2451 ms (서버 콜드 직후) |
| 캔버스 표시 (모바일 뷰포트) | 378 ms | 310–327 ms |
| 베이스 메시 (MEDIUM) | ≈25,280△ | ≈12,328△ (전면만 고밀도, 측면 단순화) |
| 근접 관찰 기하 | 25k△ 고정 | FULL 110.6k△ + 셀당 패치 32.8k△ 스트리밍 |
| 드래그 중 실렌더 FPS | 미계측 (rAF 근사 ~58, 실렌더 아님) | 7 fps (SwiftShader+그림자 — 실제 GPU 아님·범위 참조용) |
| draw calls | ≈19 | 16 (통계 패널 실측) |
| GPU 기하 추정 | 미계측 | 0.45 MB (MEDIUM) |
| 텍스처 | 0 | 2 (PMREM 환경맵·그림자맵) |
| 파생 자산 | 없음 | GLB 5종+패치+스플랫, LOD오차 P95 기록 |

> **주의**: FPS·시간은 소프트웨어 렌더러(SwiftShader) 기준으로 실제 GPU 성능을 대표하지
> 않는다. 실기기 검증은 P1 (성능 목표 §18.2는 실기기 재측정 필요).

## 시각 회귀

`e2e/tests/visual.spec.ts` — 고정 카메라·조명 5장(pbr-museum / research-lab / raking /
normal / curvature)을 커밋된 기준(`tests/visual.spec.ts-snapshots/`)과 비교,
maxDiffPixelRatio 0.03. 기준 갱신: `--update-snapshots`.
