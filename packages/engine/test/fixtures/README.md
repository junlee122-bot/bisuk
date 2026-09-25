# 테스트 fixture 출처

## tei-epidoc.rng

- 용도: EpiDoc 내보내기 결과를 `xmllint --relaxng`로 검증하는 **테스트 전용** 스키마.
  앱 번들·배포물에는 포함되지 않는다.
- 출처: https://epidoc.stoa.org/schema/latest/tei-epidoc.rng
  (2026-09-25 내려받음, 같은 날 원격 파일과 바이트 단위 동일 확인)
- 버전: EpiDoc 스키마 9.8 (색인 페이지 https://epidoc.stoa.org/schema/ 의 최신 항목).
  파일 헤더 기준 "Schema generated from ODD source 2026-03-18T17:42:37Z",
  TEI P5 4.10.2 기반.
- 라이선스: TEI P5는 CC BY 3.0 / BSD-2-Clause 이중 라이선스이고, EpiDoc 스키마·가이드라인도
  CC BY 계열로 공개 배포된다고 알려져 있다. 다만 이번에는 공식 라이선스 문구를 내려받아
  확인하지 못했으므로 **재확인 필요**. 재배포 목적이 아니라 로컬 검증 전용으로 둔다.
- 갱신: `curl -o tei-epidoc.rng https://epidoc.stoa.org/schema/latest/tei-epidoc.rng`
