# 성능 측정 결과

**측정 환경**: 컨테이너(4 vCPU, GPU 없음) · headless Chromium 141 ·
**SwiftShader(소프트웨어 래스터라이저)** · localhost 네트워크.
→ 절대 FPS는 실제 GPU 성능을 대표하지 않으며, 상대 비교·회귀 감지 용도다.
실기기(데스크톱 dGPU/iGPU·모바일) 측정은 P1 과제.

## 로딩 (After)

| 지표 | 값 | 목표(§18.2) |
|---|---|---|
| 캔버스 표시 (데스크톱, 웜) | 369 ms | ≤2500 ms ✓ |
| 캔버스 표시 (데스크톱, 서버 콜드) | 2451 ms | 경계 — Next 라우트 웜업 포함 |
| 캔버스 표시 (모바일 뷰포트) | 310 ms | ✓ |
| 기본 조작 가능 | 캔버스 표시 직후 (동기 지오메트리 ≈120ms/MEDIUM) | ≤4000 ms ✓ |
| detail patch 서버 생성+전송+파싱 | 첫 요청 ≈1.5–3 s (이후 캐시 즉시) | — |
| splat 데모 생성+스트리밍 (60k) | 첫 요청 ≈2–4 s (파생 캐시 후 <1 s) | — |

## 렌더 (After, SwiftShader)

| 지표 | 값 |
|---|---|
| 드래그 중 실렌더 FPS (MEDIUM+그림자 1024, Balanced) | 7 |
| draw calls | 16 |
| 삼각형 (MEDIUM) | 12,328 |
| GPU 기하 추정 | 0.45 MB (MEDIUM) / ≈4.2 MB (FULL+패치) |
| 정적 상태 | on-demand — 렌더 0회 (fps 표시 "대기") |

소프트웨어 렌더에서 7fps는 그림자 맵이 지배적이다. BATTERY_SAVER(그림자 off)로는
동일 장면에서 상호작용이 뚜렷이 가벼워지며, 실제 GPU에서는 이 장면 규모(1.2만△)가
60fps 목표에 여유가 크다 — 실기기 수치는 확보 후 본 문서를 갱신할 것.

## 메모리·해제 (E2E 검증)

- 탭 전환 시 WebGL 컨텍스트 카운터 1→0, geometry.dispose 호출 (`threeD.spec.ts`,
  `workspace.spec.ts` GPU 테스트)
- Splat/패치 버퍼·PMREM 환경맵·EdgesGeometry 모두 unmount 시 dispose
- LRU 패치 캐시 — 품질 단계별 상한 (Balanced 2개)

## 회귀 가드

- 시각 회귀 5장 (diff 3% 초과 시 실패)
- E2E 26건 전체에 콘솔 오류·페이지 예외 0건 가드
