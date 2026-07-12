# 구현 계획 — 포트폴리오 폴리시

기준선(불변 최소치): 엔진 단위 53 · API 통합 33 · E2E 26 · 콘솔 오류 0.
기존 테스트는 삭제·약화 금지, 스냅샷만 라이트 테마로 재생성.

## Phase 0 — 감사·기준 캡처 (본 문서 포함 5종 + BEFORE 7장) ✅

## Phase 1 — 라이트 토큰 + 앱 셸

1. `globals.css` 토큰 전면 교체(§3.1 팔레트) + 배지 라이트 반전 + 스크롤바.
2. 하드코딩 다크 173건 치환 (`text-neutral-*` → 잉크 토큰, `bg-[#...]` → 표면 토큰).
3. `next/font`로 Noto Serif KR/Noto Sans KR 서브셋 자체 호스팅(+라이선스 기록).
4. GlobalHeader: 석문 Studio + EXHIBITION/RESEARCH 전환(뷰 상태는 TabUiState에
   `viewMode`로 저장, 전환 시 카메라·선택·탭 불변).
5. GlyphPatchSvg 반전, 상태 라벨 인간화 맵, 대시보드/Frontier/Audit 토큰화.

## Phase 2 — 박물관 무대

1. 캔버스 투명화 + preset 배경 제거 → CSS cyclorama(모드별).
2. PresentationStage(바닥+플린스, 별도 노드·raycast 제외·EXHIBITION 전용).
3. 조명 프리셋 라이트 재보정 + 림 라이트 + 프리셋 보간 180–320ms.
4. 톤매핑 A/B(ACES/AgX/Neutral) 스크린샷 → SCENE_LOOK_DEV_PLAN에 기록·결정.
5. 프레이밍 62–78% 확인, 기본 카메라 ¾ 히어로.

## Phase 3 — 카메라·관찰 도구

1. CameraBookmark 5종 + 1–5 키 + 500–900ms 전환 + 입력 중단 + reduced-motion.
2. 매그니파이어(M, 2×/4×/8×, Evidence 기하 기반 렌더).
3. 스크린샷 컴포저: 무대만/투명 배경/메타데이터 sidecar — **원샷 캡처**
   (`preserveDrawingBuffer` 상시 옵션 제거).
4. 클레이 톤 선택 외곽선(`--accent-clay`).

## Phase 4 — Showcase/Story Mode

`/showcase/[setId]`: 히어로(실측 지표만) + 5챕터(유물/표면/자형/비교/근거 —
UNKNOWN 정직 표기) + 챕터 네비(점·화살표·키보드·URL) + 가이드 카메라(입력 시
일시정지, "가이드로 돌아가기") + 권리 게이트(가상·재배포 가능 자산만 공개 노출).
라벨은 "원본 시각화 / 전시 표현 보강" — "복원 전/후" 금지.

## Phase 5 — P1 기술 부채

1. 자동 LOD: 화면공간 오차 + 히스테리시스 — 엔진 순수 함수 + 단위 테스트
   (가까워질수록 LOD 저하 금지 / 진동 금지 / ortho 줌 / 선택 글자 우선).
2. binary_little_endian PLY 파서 + 테스트.
3. SceneLook·CameraBookmark zod + API CRUD + 프리셋 6종 시드 + 직렬화 테스트.
4. `NEXT_PUBLIC_3D_RENDERER=webgl|auto|webgpu` (기본 webgl, webgpu는 정직한
   UNAVAILABLE 보고).
5. REAL_DEVICE_TEST_PLAN.md + 결과 JSON 스키마 + PENDING_REAL_DEVICE 마커.
6. 보류(문서화만): BVH 피킹, ROI 가중 QEM, KTX2, Blender/Nerfstudio 실행 →
   KNOWN_LIMITATIONS.md.

## Phase 6 — 검증·문서·보고

1. 기존 전 테스트 그린 확인(53/33/26) + 신규 단위·API·E2E(스펙 §16 목록:
   라이트 배경 검증, 모드 전환 상태 유지, 북마크 전환, 매그니파이어, 쇼케이스
   챕터·감속 모션, 스크린샷 컴포저, 권리 게이트, GPU 해제, 모바일).
2. 시각 회귀 기준 전면 재생성 + 신규 샷(workspace-light-1440/1920, showcase-hero,
   glyph-matrix, surface-compare, evidence-dossier, mobile-*).
3. AFTER 캡처(BEFORE와 동일 카메라·뷰포트) + 포트폴리오 캡처 팩 12장 + sidecar.
4. 최종 문서 7종(FINAL_REPORT, BEFORE_AFTER, PERFORMANCE_RESULTS,
   REAL_DEVICE_TEST_PLAN, ACCESSIBILITY_RESULTS, DEPENDENCY_AND_ASSET_LICENSES,
   KNOWN_LIMITATIONS) + 커밋/푸시 + 수치 최종 보고.

## 위험 관리

| 위험 | 완화 |
|---|---|
| 라이트 전환으로 시각 회귀 5장 전부 실패 | 예상된 실패 — Phase 6에서 일괄 재생성, 그 전까지 visual.spec만 지연 실행 |
| 3D 재보정 중 raking 관찰력 손실 | RAKING 무대는 딥 그레이 유지, 대비 실화면 검증 |
| preserveDrawingBuffer 제거로 기존 캡처 스크립트 파손 | 컴포저 원샷 API로 대체 후 스크립트 갱신 |
| 모드 전환 시 상태 초기화 버그 | E2E로 카메라·선택·탭 보존 명시 검증 |
| 토큰 치환 누락(다크 잔존) | grep 게이트: 금지 hex·클래스 0건 검사를 E2E 전 단계에 추가 |
