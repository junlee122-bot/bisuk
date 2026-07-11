# 데이터 출처와 실제/가상 경계

이 저장소와 앱에 들어 있는 모든 데이터의 출처와 성격을 명시한다.

## 1. 저장소에 포함된 것 (커밋됨)

| 데이터 | 위치 | 성격 |
|---|---|---|
| 공식 출처 메타데이터 (URL·기관명·형식 목록·권리 상태) | `data/seed/workspace.json` | **실제** 공개 메타데이터. 파일 원본은 포함하지 않음 |
| 창녕 발견 보도 메타데이터 (URL·1차 판독 요지) | `data/seed/workspace.json`, `data/seed/frontier.json` | **실제** 보도 메타데이터. 사진·본문 재배포 없음 |
| 가상 비석 DEMO-A/B, 가상 조각 DEMO-C, 가상 발견 DEMO-D | `data/seed/demo-glyphs.json`, `data/seed/frontier.json` | **허구** — 절차 생성 파라미터와 허구 자형 |
| 허구 문헌 코퍼스 12건 | `data/seed/corpus.json` | **허구** — 제목에 `[가상 문헌]` 명시, 본문에 데모용 고지 포함 |
| 가상 벤치마크 정답표 | `data/seed/demo-glyphs.json` `benchmarkCases` | **허구** — 평가 전용, 분석 파이프라인에서 접근 금지 |

## 2. 저장소에 포함되지 않은 것

- 국가유산 디지털 서비스의 PLY/STL/ASC/ICF 원본 파일 — **무단 수집·재배포 금지**.
  관리자가 이용 조건 확인 후 직접 내려받아 importer로 등록한다.
- 보도 사진, 박물관 전시 이미지 — 권리 확인 전 재배포 금지 원칙에 따라 메타데이터만 시드.

## 3. 실행 중 생성되는 것 (gitignore)

- `apps/api/.data/originals/**` — 사용자가 등록한 원본 파일 (불변 저장, sha256 체크섬)
- `apps/api/.data/seokmun.db` — SQLite 데이터베이스

## 4. UI에서의 경계 표시

- `provenance=VIRTUAL_DEMO` 자산은 항상 `◈ 가상 데이터` 배지와
  "실제 유물 3D 아님 · 절차 생성 데모" 문구를 표시한다.
- 허구 문헌은 검색 결과·근거 목록에서 `허구 문헌` 배지를 표시한다.
- 자동 분석 결과(Dossier)에는 "가상 데모 분석 — 실제 판독 아님" 배지를 표시한다.
- 내보내기 manifest의 `disclaimer` 필드에 동일 고지를 포함한다.

## 5. Source Snapshot (P1 예정)

P0는 SourceRecord(출처·권리·계층)를 저장한다. 웹 페이지 시점 고정(content_hash,
retrieved_at, archive_status)은 P1 범위다.
