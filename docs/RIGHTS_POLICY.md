# 권리 정책 (P0 구현 기준)

## 원칙

1. **자동 수집 금지** — 앱은 어떤 외부 사이트에서도 원본 자산을 자동으로 내려받지 않는다.
   공식 Source Card는 URL과 이용 조건 확인 절차만 안내한다.
2. **항목별 확인** — 국가유산 디지털 서비스 자산은 공공누리 유형이 항목별로 다를 수 있어
   `VERIFY_PER_ASSET` 상태로 시드되며, 개별 자산 확인 전에는 재배포하지 않는다.
3. **원본 불변** — 등록된 원본은 `originals/` 아래에 쓰기 1회(`wx` 플래그)로 저장되고
   sha256 체크섬이 기록된다. 분석은 항상 별도 파생물로 저장된다.
4. **업로드 기본값은 미확인** — importer로 등록된 파일은 무조건 `VERIFY_REQUIRED`로
   시작한다. 내부 연구(분석·뷰어)는 가능하지만 외부 공개 내보내기는 차단된다.
5. **뉴스 사진 재배포 금지** — Frontier 항목의 사진은 권리 확인 전 썸네일 포함
   저장·재배포하지 않는다 (`NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED`).

## 상태 체계 (PRD §15.3 준수)

`UNKNOWN, VERIFY_REQUIRED, VERIFY_PER_ASSET, METADATA_ONLY, VIEW_ONLY, RESEARCH_ONLY,
NONCOMMERCIAL, ATTRIBUTION_REQUIRED, DERIVATIVES_PROHIBITED, OPEN_FOR_REUSE,
INTERNAL_RESTRICTED, NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED, KOGL_TYPE_4_OR_ITEM_SPECIFIC`

## 내보내기 게이트

- `audience=INTERNAL`: 항상 허용 (연구 목적 분석).
- `audience=PUBLIC`: 미확인 권리 자산이 하나라도 있으면 **403 + 차단 목록** 반환,
  `EXPORT_BLOCKED` 감사 이벤트 기록.
- 관리자 권리 확인(`POST /api/assets/:id/license`) 후 재시도 가능.
- 모든 내보내기에는 출처·권리·라이선스·모델 버전 manifest가 포함된다.
- 가상 데모 자산(VIRTUAL_DEMO)은 자체 제작물이므로 재배포 제한이 없다.

## 감사 추적

업로드·권리 확인·내보내기(차단 포함)·분석·승격은 모두 `audit_events`에 기록된다.
