# 성능 측정 결과 — 포트폴리오 폴리시 이후

**측정 환경**: 컨테이너(4 vCPU, GPU 없음) · headless Chromium 141 ·
**SwiftShader(소프트웨어 래스터라이저)** · localhost.
→ 절대 성능을 대표하지 않으며 상대 비교·회귀 감지 용도. 실기기 수치는
`REAL_DEVICE_TEST_PLAN.md` 절차로 확보한다.

## 로딩 (웜, 2026-07-12 실측)

| 지표 | 값 | 목표 |
|---|---|---|
| 워크스페이스 캔버스 표시 (1440×900) | 371 ms | ≤2500 ms ✓ |
| 쇼케이스 캔버스 표시 | 471 ms | ≤2500 ms ✓ |
| 모바일 뷰포트 (콜드 라우트 포함) | 2146 ms | 경계 — Next 라우트 웜업 포함, 웜 시 데스크톱 동등 |
| 기본 조작 가능 | 캔버스 표시 직후 (동기 지오메트리 ≈120ms/MEDIUM) | ≤4000 ms ✓ |

## 렌더 (드래그 3초, MEDIUM·그림자 1024·무대 포함)

| 지표 | 폴리시 전 | 폴리시 후 |
|---|---|---|
| 실렌더 FPS | 7 | 12 |
| draw calls | 16 | 20 (플린스·바닥·림 라이트 추가) |
| 삼각형 | 12,328 | 12,336 |
| GPU 기하 추정 | 0.45 MB | 0.45 MB |
| 텍스처 | 2 (PMREM·그림자맵) | 2 |
| 정적 상태 | on-demand 렌더 0회 | 동일 (frameloop="demand" 유지) |

무대(3 메시)는 draw call +4에 그치고, 투명 캔버스 전환으로 배경 클리어 비용은
CSS로 이동 — SwiftShader에서도 FPS 저하 없음(오히려 개선).

## 확대경·캡처 경로

- 확대경 활성 시 렌더 2회/프레임(본 화면 + 렌즈 scissor) — 데모 장면(1.2만△)에서
  SwiftShader 기준 뚜렷한 지연 없음. `PENDING_REAL_DEVICE` (S6 시나리오).
- `preserveDrawingBuffer` 상시 옵션 제거 — 캡처는 요청 시 1회 렌더 직후
  `toDataURL` (성능 상시 비용 0).

## 자동 LOD

- 히어로 거리(≈4.8)에서 MEDIUM, 글자 포커스 시 FULL 승급 — E2E로 검증.
- 히스테리시스 밴드(FULL enter 1250px / exit 980px)로 경계 진동 없음 — 엔진
  단위 테스트 6종.

## 메모리·해제 (E2E 검증 유지)

- 탭 전환 시 WebGL 컨텍스트 1→0 + geometry.dispose (`workspace.spec.ts`)
- 무대·림 라이트·렌즈 카메라 등 신규 객체는 R3F 트리 unmount 시 해제
- 시각 회귀 17장 + polish E2E 13종에 콘솔 오류 0 가드

## PENDING_REAL_DEVICE

아래 값은 실기기 측정 전까지 미기재 상태를 유지한다 (계획: REAL_DEVICE_TEST_PLAN):

- 데스크톱 dGPU/iGPU·모바일 실 FPS (S1–S6)
- 실기기 로딩·인터랙티브 시간, JS heap/GPU 메모리
- 확대경 이중 렌더의 실기기 비용
