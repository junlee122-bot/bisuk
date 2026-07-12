# 실기기 측정 계획 (Real Device Test Plan)

이 저장소의 성능 수치는 **SwiftShader(소프트웨어 GPU) 컨테이너**에서 측정되어
절대 성능을 대표하지 않는다. 아래 계획으로 실기기 수치를 확보해
`PERFORMANCE_RESULTS.md`의 `PENDING_REAL_DEVICE` 항목을 교체한다.

## 대상 기기 매트릭스

| 클래스 | 예시 | 기본 품질 단계 예상 |
|---|---|---|
| 데스크톱 dGPU | RTX 3060↑ / Apple M 시리즈 | HIGH–ULTRA |
| 데스크톱/노트북 iGPU | Intel Iris Xe, AMD 780M | BALANCED–HIGH |
| 상위 모바일 | iPhone 14↑, Galaxy S23↑ | MOBILE |
| 보급 모바일 | 4GB RAM Android | BATTERY_SAVER |

## 측정 시나리오 (각 기기 공통 — 재현 절차)

1. `pnpm --filter @seokmun/api start` + `pnpm --filter @seokmun/web start`
2. `POST /api/dev/reset` 후 워크스페이스 `?tab=chungju-goguryeobi` 진입
3. 각 시나리오에서 `window.__seokmunStats`(1초 창 실렌더 FPS·drawCalls·triangles) 기록:
   - S1 기본 히어로(전시 보기, MUSEUM, MEDIUM)
   - S2 드래그 회전 10초 (S1 상태)
   - S3 FULL LOD + 글자 포커스 + 디테일 패치 로드 후 드래그
   - S4 Splat 표시(60k) 드래그
   - S5 사광 스윕 30초 (연속 렌더)
   - S6 확대경 8× 이동 (이중 렌더 경로)
4. 로딩: 콜드/웜 각각 `performance.now()` 기준 캔버스 표시·기본 조작 가능 시각
5. 메모리: `performance.memory.usedJSHeapSize` + `__seokmunStats.gpuBytesEstimate`
6. 결과를 아래 스키마의 JSON으로 `docs/portfolio-polish/real-device-results/`에 저장

## 결과 JSON 스키마

`e2e/scripts/real-device-result.schema.json` (JSON Schema draft-07) — 필수 필드:

```json
{
  "device": "MacBook Pro M3",
  "gpu": "Apple M3",
  "os": "macOS 15",
  "browser": "Chrome 141",
  "viewport": [1440, 900],
  "qualityTier": "HIGH",
  "scenarios": {
    "S1": { "fps": 0, "drawCalls": 0, "triangles": 0 },
    "S2": { "fps": 0 }, "S3": { "fps": 0 }, "S4": { "fps": 0 },
    "S5": { "fps": 0 }, "S6": { "fps": 0 }
  },
  "loading": { "coldCanvasMs": 0, "warmCanvasMs": 0, "interactiveMs": 0 },
  "memory": { "jsHeapMB": 0, "gpuGeometryMB": 0 },
  "measuredAt": "ISO-8601",
  "notes": ""
}
```

## 합격 기준 (스펙 §18.2 준용)

- 데스크톱: S1–S3 ≥ 60fps 근접, S4 ≥ 30fps / 모바일: S1 ≥ 30fps
- 캔버스 표시 ≤ 2.5s (웜), 기본 조작 ≤ 4s
- 시나리오 간 컨텍스트 손실·크래시 0회

## 현재 상태

**PENDING_REAL_DEVICE** — 이 컨테이너에는 실 GPU가 없어 계획만 확정.
CI/컨테이너 수치는 상대 비교·회귀 감지 용도로만 사용한다.
