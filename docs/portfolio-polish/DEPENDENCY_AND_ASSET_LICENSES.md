# 의존성·자산 라이선스 기록 (포트폴리오 폴리시 추가분)

기존 감사표: `docs/3d-upgrade/DEPENDENCY_AND_LICENSE_AUDIT.md` — 아래는 이번
업그레이드에서 추가·변경된 항목만.

## 폰트 (신규)

| 폰트 | 용도 | 공급 방식 | 라이선스 |
|---|---|---|---|
| Noto Serif KR (400/600/700) | 디스플레이·제목·히어로 | `next/font/google` — **빌드 시 다운로드·자체 호스팅** (런타임 CDN 요청 0) | SIL OFL 1.1 |
| Noto Sans KR (400/500/700) | 본문·UI | 동일 | SIL OFL 1.1 |

- 출처: Google Fonts (fonts.google.com/noto). OFL 1.1은 자체 호스팅·재배포 허용,
  폰트 자체 판매만 금지 — 본 용도 적합.
- 폴백 체인: Apple SD Gothic Neo / Malgun Gothic / system-ui (시스템 폰트 —
  번들하지 않음).

## 런타임 의존성 (변경 없음 — 확인만)

- three / @react-three/fiber / drei / @gltf-transform / zustand / TanStack Query:
  전부 MIT. 신규 패키지 추가 없음 (무대·확대경·컴포저·쇼케이스는 기존 의존성으로 구현).

## 환경맵·HDRI

- 외부 HDRI **0건 유지** — 환경광은 three 내장 `RoomEnvironment`(MIT) 절차 생성.
  따라서 별도 HDRI 라이선스 메타데이터 대상 없음 (외부 HDRI 도입 시
  라이선스·출처 필드를 SceneLook에 추가하는 것이 전제 조건).

## 시각 자산

- 무대(플린스·바닥·cyclorama)·선택 외곽선·확대경 링: 코드 절차 생성 — 자체 제작.
- 모든 3D 데모·자형·스크린샷: 자체 제작 허구 자산 (`VIRTUAL_DEMO` 표기, CC0 상당).
- 사용자 업로드 자산: 공공누리 항목별 확인 전 `VERIFY_REQUIRED` — 공개 내보내기
  및 **공개 쇼케이스 차단** (엔진 허용목록과 동일 기준, E2E 검증).
