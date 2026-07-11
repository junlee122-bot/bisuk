# 평가 프로토콜과 데이터 누출 방지

## 벤치마크 격리

- 가상 벤치마크 정답(`benchmarkCases`)은 전용 테이블 `benchmark_cases`에 저장되며,
  **읽기 경로는 `POST /api/evaluation/run` 하나뿐이다.**
  후보 생성·교차 매칭·문헌 근거 수집 코드는 이 테이블에 접근하지 않는다.
- 숨김 셀(`hidden: true`)의 `publishedReading`은 API 응답에서 `null`로 유지된다
  (통합 테스트로 검증).

## 누출 문서 차단

- 코퍼스 문서에 `benchmarkLeak: true` 플래그가 있으면(가상 정답표 `doc-leak-kappa`)
  파이프라인이 근거에서 제외하고, 제외 사실을 분석 응답과 감사 로그
  (`excludedLeakDocumentIds`)에 남긴다.
- Decision Gate의 `benchmark_leakage` 규칙이 true면 자동 채택이 금지된다.

## 평가 실행

`POST /api/evaluation/run` 은 벤치마크 셀 5건에 대해 파이프라인을 실행하고
숨김 정답과 비교해 다음을 보고한다.

- `correctAutoAccepts` / `wrongAutoAccepts` (오채택 — 0 유지 목표)
- `abstained` (미상·상충·판독불가로 유보한 수)
- `autoAcceptPrecision`

현재 시드 기준 결과: 자동 채택 1건(demoA-L2-C3=安, 정답), 오채택 0건, 유보 4건.

## 평가 모드 (P1 확장 예정)

PRD §16.2의 CLOSED_BOOK_VISUAL / INTRA_STELE / CROSS_STELE / LITERATURE_RAG /
FULL_AUTONOMOUS 모드 분리는 파이프라인 입력(`cellsByTab`, `documents`)을 비우는
방식으로 이미 코드 수준에서 가능하며(단위 테스트 "독립 분석" 참조),
모드별 지표 대시보드는 P1 범위다.

## 핵심 안전 지표 (PRD §16.4)

| 지표 | P0 상태 |
|---|---|
| 잘못된 자동 확정률 | 0 (평가 실행으로 확인) |
| 근거 없는 인용률 | 0 (Citation Verifier가 본문 미존재 인용을 거부) |
| 권리 미확인 자료 재배포 건수 | 0 (내보내기 게이트 + E2E4) |
| 평가 누출 건수 | 0 (누출 문서 제외 + 단위/통합 테스트) |
| 가짜 3D 측정값 표시 건수 | 0 (가상 메시에 측정값 미표시, 단위 미확인 자산은 "확인 필요" 표기) |
