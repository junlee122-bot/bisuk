# 3D 장면 룩 개발 계획 (Scene Look Dev Plan)

목표: "밝은 현대 박물관 전시대 위의 석비". Evidence 좌표계·기하 불변,
모든 연출은 표시 계층(PRESENTATION_ENHANCED / PRESENTATION_STAGE_ONLY).

## 1. 무대 구성

```text
[CSS cyclorama]  캔버스 뒤 div — linear-gradient(--stage-top → --stage-bottom)
                 EXHIBITION: 웜 페이퍼 톤 / RESEARCH: 중립 라이트 그레이
[Canvas]         alpha:true, 배경 투명 — <color attach="background"> 제거
[PresentationFloor] 낮은 원형/사각 디스크, --stage-floor 톤, 접지 그림자 수신 전용
[Plinth(옵션)]   낮은 석재 받침 — EXHIBITION 전용
```

- 바닥·플린스는 비석과 **별도 노드**: `raycast = noop`, 측정·곡률·깊이 대상 제외,
  userData `PRESENTATION_STAGE_ONLY`.
- RESEARCH 모드는 바닥·플린스 미장착(범례·축·분석 모드 우선).

## 2. 조명 프리셋 재보정 (다크→라이트 전제)

| 프리셋 | 현재(다크 전제) | 계획 |
|---|---|---|
| MUSEUM_NEUTRAL | env 0.42 / key 1.55 / bg #1a1a1e | env ↑(0.55±) / key 1.3± / 배경 투명+웜 무대, 소프트 림 추가 |
| FIELD_DAYLIGHT | env 0.85 / key 1.15 / #26292c | 하늘빛 화이트 무대, key 약간 웜 |
| LABORATORY_NEUTRAL | env 1.0 / key 0.5 / #2b2b2e | 균일광 유지, 무대 중립 그레이 |
| RAKING | env 0.12 / key 3.2 / #101013 | **관찰 기능 보존** — 무대는 딥 그레이(검정 금지), 사광 대비 유지 |
| SWEEP | 동상 | 동상 |
| UNLIT_ALBEDO | #222226 | 중립 밝은 그레이 |

- 프리셋 전환: 180–320ms 강도·색 보간 (배경은 CSS transition).
- 접지 그림자: 맵 1024 유지, radius·bias 재조정으로 접촉부 밀도 ↑.
- 정확한 수치는 구현 중 실화면 기준으로 확정하고 본 문서에 기록한다.

## 3. 톤매핑 A/B (Phase 2에서 수행)

동일 카메라·조명(MUSEUM, ¾ 히어로)에서 3안 비교 스크린샷을 본 문서에 첨부한다.

| 후보 | 예상 특성 | 판정 기준 |
|---|---|---|
| ACESFilmic (현행) | 하이라이트 롤오프 좋음, 밝은 장면서 채도 감쇠 | 석재 웜톤 유지 여부 |
| AgX | 넓은 라티튜드, 차분한 채도 | 종이 배경과의 조화 |
| Neutral | 원색 충실 | 원본색 검토 모드 적합성 |

결정 원칙: EXHIBITION 기본은 A/B에서 선택, `SOURCE_COLOR_REVIEW` SceneLook은
Neutral/Unlit 계열 고정. **A/B 결과와 선택 근거·스크린샷은 이 섹션에 추가 기록.**

## 4. 프레이밍·카메라

- 모델 스크린 점유: 무대 높이의 62–78% (현재 68% — 유지하되 가로 무대감 보강).
- 기본 진입: `HERO_THREE_QUARTER` (¾ 구도, 약간 낮은 시점에서 올려봄).
- CameraBookmark 5종: HERO_THREE_QUARTER / FRONT_INSCRIPTION / SIDE_DEPTH /
  DETAIL_SELECTED_GLYPH / FULL_ARTIFACT — 500–900ms ease, 입력 시 즉시 중단,
  reduced-motion 시 점프.

## 5. SceneLook 프리셋 (Phase 5 데이터화)

MUSEUM_WARM · LAB_NEUTRAL · RAKING_EAST · RAKING_WEST · SOURCE_COLOR_REVIEW ·
PORTFOLIO_HERO — 조명 프리셋+톤매핑+노출+무대 옵션+카메라 북마크 조합을 zod
스키마로 저장·CRUD.

## 6. 하지 않는 것

배경 HDRI 수입(라이선스·용량) · bloom/글로우 · 자동 회전 · Evidence 정점 변형 ·
AI 생성 표면 디테일 · 상시 preserveDrawingBuffer.
