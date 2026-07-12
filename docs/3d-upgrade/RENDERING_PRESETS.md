# 렌더링 프리셋 (구현 값)

## 컬러 매니지먼트

- `outputColorSpace = sRGB`, `toneMapping = ACESFilmic`, 노출 슬라이더 0.4~2.0 (기본 1.0, 프리셋 배율 곱)
- 정점 색(albedo)은 선형 공간에서 계산·저장 → 톤매핑 후 sRGB 출력
- 텍스처 없음(정점 색) → 색공간 오적용 여지 없음. 업로드 GLB의 COLOR_0도 선형

## 조명 프리셋 (`SteleLightingRig`)

| 프리셋 | IBL 강도 | key | fill | 그림자 | 비고 |
|---|---|---|---|---|---|
| Museum Neutral | 0.42 (RoomEnvironment PMREM) | 1.55 #fff2df | 0.3 | ✓ soft | 기본값 |
| Field Daylight | 0.85 | 1.15 중성백 | 0.35 | ✓ | 흐린 낮 근사 — 촬영지 재현 주장 없음 |
| Laboratory Neutral | 1.0 | 0.5 | 0.5 | ✗ | 판독 비교 기본, 과장 없음 |
| Raking L/R/T/B | 0.12 | 3.2 | — | ✓ | 방위각 0–360°·고도 2–60° 슬라이더, 현재 각도 수치 표시 |
| Cross-light Sweep | 0.12 | 3.2 회전(40°/s) | — | ✓ | 같은 카메라에서 음영 변화 관찰 |
| Unlit Albedo | 0 | — | — | ✗ | 조명 없는 원본 색 |

- 환경광은 three 내장 `RoomEnvironment`(절차 생성, MIT) — 외부 HDRI 번들 없음.
- 그림자: PCFSoft, bias −0.0004 / normalBias 0.02, 접지 `shadowMaterial`(불투명도 0.35).
- 후처리 없음 (bloom/DoF/vignette 금지 정책 준수). AA는 MSAA(기본 antialias).

## 분석 모드

- Normal: `meshNormalMaterial`
- Curvature/Depth: 정점 false-color + 범례("평면→홈"/"얕음→깊음") + **가상 단위 명시**
- AO(cavity) 슬라이더 0~1.2 — 수치 상시 표시, cavity 0/1.2 두 극단 색의 보간(기하 재생성 없음)

## 재질

- `MeshPhysicalMaterial`, `metalness=0`(석재), roughness: 연구형 0.95 / 실감형 0.8
- 연구형은 envMapIntensity 0.5·specular 0.15로 반사 과장 억제

## 카메라

- 관람: 원근 fov 32 (광각 왜곡 방지) · 정사영 연구 · 정면 입면(회전 잠금) ·
  글자 포커스(0.6s ease-out, 사용자 조작 즉시 중단, 최소 거리 0.45)
- near 0.01 / far ≈ 25×최장변 — depth 정밀도 낭비 방지

## 품질 단계 (GPU)

| 단계 | dpr | 그림자 | 패치 수 | splat 비율 |
|---|---|---|---|---|
| ULTRA | 1–2 | 2048 | 6 | 100% |
| HIGH | 1–1.75 | 1024 | 4 | 100% |
| BALANCED | 1–1.25 | 1024 | 2 | 60% |
| MOBILE | 0.8–1 | 512 | 1 | 35% |
| BATTERY_SAVER | 0.6–0.8 | 없음 | 0 | 20% |

AUTO는 deviceMemory·코어 수·UA로 감지 후 사용자가 변경 가능. 렌더 루프는 on-demand
(`frameloop="demand"`) — 정적 장면에서 렌더 정지, Sweep/포커스 애니메이션만 invalidate.

## 서버 저장 프리셋

`GET/POST /api/3d/render-presets` — 이름·조명·노출·AO·normalStrength 저장 (toneMapping ACES 고정 기록).
