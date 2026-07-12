# 접근성 점검 결과

## 색 대비 (라이트 토큰 계산치)

| 조합 | 대비 | 판정 (WCAG AA) |
|---|---|---|
| `--ink-primary #1d1c19` / `--canvas-page #f3f0e9` | ≈15.2:1 | ✓ 본문 |
| `--ink-secondary #5f5b53` / `--surface-primary #fbfaf7` | ≈6.6:1 | ✓ 본문 |
| `--ink-tertiary #817b70` / `--surface-primary #fbfaf7` | ≈4.0:1 | ✓ 큰 글씨·보조 (본문 주 정보에는 미사용) |
| `--ink-inverse #fbfaf7` / `--accent-clay #9f5b3f` | ≈4.9:1 | ✓ (모드 토글 활성) |
| `--state-danger #9a463f` / `--surface-primary` | ≈5.6:1 | ✓ |
| 배지 6종 (진한 잉크/저채도 배경) | ≥4.6:1 | ✓ |

- 경고·불확실성은 색+아이콘(⚠/✓/◈)+문구 병행 — 색맹 대응.
- 분석 컬러맵(법선/곡률/깊이)은 UI 강조색과 분리, 범례 동반.

## 키보드

- 전 인터랙티브 요소 포커스 링(`--line-focus` 2px, :focus-visible) — globals.css 전역.
- 카메라 북마크 1–5 키 / 확대경 M / 쇼케이스 ←→ — 입력 필드 포커스 시 무시
  (INPUT/SELECT/TEXTAREA 가드). E2E로 동작 검증.
- 탭·버튼은 시맨틱 `<button role="tab">`/`aria-pressed`/`aria-current` 사용.

## reduced motion

- `prefers-reduced-motion: reduce`에서: 카메라 북마크·글자 포커스 즉시 점프
  (E2E `폴리시 4–5`), 조명 프리셋 보간 생략, CSS transition 전역 0.01ms
  (globals.css media query). 쇼케이스 가이드 전환도 즉시 적용 (E2E `폴리시 8–9`).

## 스크린리더·시맨틱

- 3D 캔버스 래퍼는 `data-testid=stele-stage` + 뷰어에 배지 텍스트로 상태 병기
  (가상 데모·표시 전용 경고가 텍스트로 존재).
- GlyphPatchSvg `role="img"` + aria-label(셀 ID·가상 표기).
- 모드 토글 `role="group"` + `aria-pressed`, 동기화 상태 `aria-live="polite"`.
- 쇼케이스 챕터 점 `aria-label`/`aria-current`, 수치 표는 `<table>`.

## 한계 (KNOWN_LIMITATIONS 참조)

- 자동화 도구(axe 등) 전체 스캔 미실행 — 수동 점검 + 계산 대비 기반.
- 3D 장면 자체의 대체 텍스트는 요약 배지 수준 (셀 단위 내레이션 없음).
- 확대경은 포인터 중심 — 키보드 전용 렌즈 이동 미지원.
