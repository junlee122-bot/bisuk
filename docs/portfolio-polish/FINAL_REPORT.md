# 최종 보고 — 석문 Studio 포트폴리오 폴리시 (CONTEMPORARY MUSEUM ARCHIVE)

기준 커밋(Before): `c46a170` · 완료일: 2026-07-12

## 무엇이 바뀌었나

1. **다크 연구 도구 → 밝은 박물관 아카이브.** 웜 페이퍼 토큰 체계(스펙 §3.1
   전 팔레트)로 전면 교체 — 다크 하드코딩 173건 제거, `text-neutral-*` 0건,
   검은 캔버스 clear color 0건 (E2E 밝기 게이트로 재발 차단).
2. **앱 셸.** 석문 Studio 글로벌 헤더(워드마크·브레드크럼·저장 상태) +
   EXHIBITION/RESEARCH 모드 — 전환은 표시 계층만 바꾸고 카메라·선택·탭을
   보존한다(E2E 검증). Noto Serif/Sans KR 자체 호스팅(OFL 기록).
3. **박물관 무대.** 투명 캔버스 + CSS cyclorama(프리셋별, 240ms 전환), 전시
   보기 전용 플린스·바닥(`PRESENTATION_STAGE_ONLY`, raycast 제외), 림 라이트,
   조명 강도 보간(180–320ms), ¾ 히어로 기본 카메라(모델 높이 ≈76%).
   톤매핑 A/B(ACES/AgX/Neutral) 수행 → 기본 ACES 유지,
   SOURCE_COLOR_REVIEW 룩은 Neutral (`SCENE_LOOK_DEV_PLAN.md`에 스크린샷·근거).
4. **관찰 도구.** 카메라 북마크 5종(1–5 키, 0.7s 감속, 입력 즉시 중단,
   reduced-motion 즉시 점프) · 확대경 2×/4×/8×(M 키, 항상 Evidence Mesh 기준,
   splat 숨김 강제) · 스크린샷 컴포저(무대만/투명 배경/16:9·4:3·1:1/메타데이터
   sidecar, **preserveDrawingBuffer 상시 옵션 제거** — 단발성 캡처 경로).
5. **쇼케이스.** `/showcase/[setId]` — 실측 지표만의 히어로(비교 6기·문자 57칸·
   출처 8건·미확정 비율), 5챕터(유물/표면/자형/비교/근거 — UNKNOWN 정직 노출),
   챕터 점·화살표·키보드·URL, 가이드 카메라 일시정지 + "가이드로 돌아가기",
   권리 게이트(가상·재배포 가능 자산만 — VERIFY_REQUIRED 자산은 사유와 함께 차단).
6. **P1 부채.** 자동 LOD(화면 공간 오차+히스테리시스, 엔진 순수 함수+테스트 6종) ·
   binary_little_endian PLY 파서(+테스트 6종) · SceneLook/CameraBookmark zod +
   CRUD + 내장 룩 6종 시드(+API 테스트 5종) · `NEXT_PUBLIC_3D_RENDERER` 플래그
   (webgpu는 정직한 UNAVAILABLE) · 실기기 측정 계획+JSON 스키마.
   건너뛴 항목은 전부 `KNOWN_LIMITATIONS.md`에 기록 (BVH·ROI QEM·KTX2·어댑터 실행).

## 지키는 것 (불변 원칙)

- Evidence Mesh 정점은 어떤 시각 연출로도 수정되지 않았다 — 무대·조명·외곽선은
  전부 별도 노드/표시 계층. 측정·피킹 기준은 항상 Evidence 좌표.
- 원본에 없는 획·균열·요철을 생성하지 않았다. 표시 보강은 "전시 표현 보강"으로
  구분 표기하며 "복원 전/후"라는 표현을 쓰지 않는다.
- 가상 데모는 모든 화면에서 가상임을 표기, 벤치마크 격리·권리 게이트 유지.
- 쇼케이스는 저장된 결과의 읽기 전용 재구성 — 새 분석을 만들지 않는다.

## 검증 수치

| 항목 | 기준선(최소) | 최종 |
|---|---|---|
| 엔진 단위 테스트 | 53 | **65/65** (자동 LOD 6 + 바이너리 PLY 6 추가) |
| API 통합 테스트 | 33 | **38/38** (SceneLook/CameraBookmark 5 추가) |
| E2E | 26 | **51/51** — desktop 42 + mobile 9 (polish 13 + 시각 17 포함, 기존 삭제·skip 0) |
| 시각 회귀 기준 | 5장(다크) | **17장(라이트)** — 재실행 안정성 확인 |
| 콘솔 오류·페이지 예외 | 0 | 0 (consoleGuard 전 테스트) |
| 타입체크 | 전 패키지 | 통과 |

성능(SwiftShader, 상대 비교용): 웜 로드 371ms(워크스페이스)/471ms(쇼케이스),
드래그 실렌더 12fps(폴리시 전 7fps), draw calls 20, 삼각형 12.3k —
상세·실기기 계획: `PERFORMANCE_RESULTS.md`, `REAL_DEVICE_TEST_PLAN.md`.

## 산출물

- 문서: CURRENT_VISUAL_AUDIT / VISUAL_DIRECTION / COMPONENT_INVENTORY /
  SCENE_LOOK_DEV_PLAN(톤매핑 A/B 결과 포함) / IMPLEMENTATION_PLAN /
  FINAL_REPORT / BEFORE_AFTER / PERFORMANCE_RESULTS / REAL_DEVICE_TEST_PLAN /
  ACCESSIBILITY_RESULTS / DEPENDENCY_AND_ASSET_LICENSES / KNOWN_LIMITATIONS
- 캡처: BEFORE 7장 · AFTER 7장 · 룩 개발 4장 · **포트폴리오 팩 12장**(Appendix B,
  전부 sidecar JSON 동반) — `screenshots/`
- 재현 스크립트: `e2e/scripts/capture-polish-{before,after}.cjs`, `capture-lookdev.cjs`

## Appendix C 자기 점검

첫 화면 검은 배경 제거 ✓ · 유물다운 무대(무대·접지·림) ✓ · 원본 기하 불변 ✓ ·
3D가 주인공 ✓ · 석재다운 조명·재질 ✓ · 과도한 효과 없음(네온·bloom·자동 회전 0) ✓ ·
심사자 동선(쇼케이스→작업대) ✓ · Story Mode 실데이터만 ✓ · UNKNOWN/CONFLICTING
정직 표시 ✓ · 모바일 동작 ✓ · 키보드·reduced motion ✓ · 기존 기능 전부 유지 ✓ ·
기존 테스트 전부 통과 ✓ · 새 시각 회귀 통과 ✓ · 탭 전환 GPU 해제 유지 ✓ ·
폰트·의존성 라이선스 기록 ✓ · 실기기 미측정 수치는 PENDING 표기 ✓
