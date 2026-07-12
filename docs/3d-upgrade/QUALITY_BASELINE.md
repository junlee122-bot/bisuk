# 업그레이드 전 품질 기준선 (Before)

캡처: `docs/3d-upgrade/screenshots/before/` — 각 PNG에 카메라·조명·노출·모델 버전·브라우저·GPU를
담은 JSON sidecar 동봉. 재현: `node e2e/scripts/capture-3d-shots.cjs <출력경로>` (서버 기동 상태).

## 고정 카메라 정의

| 이름 | position | target | 모드 |
|---|---|---|---|
| front-full | [0, 0, 3.2] | [0,0,0] | 기본 조명 |
| front-medium | [0.4, 0.1, 1.8] | [0,0.2,0] | 기본 조명 |
| front-glyph-closeup | [0.05, 0.28, 0.75] | [0.05,0.28,0] | 기본 조명 |
| raking-light-left | front-medium | — | 사광(고정 방향) |
| raking-light-right | — | — | **캡처 불가** (업그레이드 전 기능 부재) |
| normal-view / curvature-view | front-medium | — | 분석 모드 |
| multi-tab-compare | 울진 탭 기본 | — | 탭 전환 후 |
| mobile-portrait | 390×844 | — | 기본 |

## 측정 수치 (localhost, SwiftShader 소프트웨어 렌더링)

| 지표 | Before |
|---|---|
| 캔버스 표시까지 (데스크톱) | 801 ms |
| 캔버스 표시까지 (모바일 뷰포트) | 378 ms |
| FPS 근사 (rAF 유도) | 데스크톱 ~58 / 모바일 ~59 |
| DEMO-A 삼각형 (MEDIUM/FULL) | ≈25,280 / ≈99,700 |
| 텍스처 | 0장 (정점 색만) |
| draw call 추정 | ≈19 (재질 1 + 셀 평면 18) |
| 글자 detail patch | 없음 |
| 환경광·그림자 | 없음 |

## 시각 판정 (사람 확인)

- `front-glyph-closeup.png`: 획 경계 계단 현상 + 정점색 보간 블러 — **판독용 클로즈업 품질 미달**
- `front-full.png`: 균일 매트 표면, 환경 반사·미세 거칠기 없음 — 점토/플라스틱 인상
- `raking-light-left.png`: 사광 자체는 유효하나 방향 고정, 노출 보정 없음, 배경 대비 과함

이 기준선과 동일 카메라·조명으로 업그레이드 후(After)를 비교한다 → `BEFORE_AFTER.md`.
