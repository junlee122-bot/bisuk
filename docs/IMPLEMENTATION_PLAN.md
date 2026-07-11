# 석문(石文) Comparative Autonomous Studio — 구현 계획

> 이 문서는 `seokmun_multi_stele_fable_master_prompt_ko.md`(최상위 PRD)와
> `seokmun_seed_workspace_manifest.yaml`(시드 매니페스트)을 기준으로 한 P0 구현 계획이다.

## 1. 저장소 현황

- 저장소는 신규(커밋 0개)이며 이전의 "사분면 이미지 4장 중심" 또는 "단일 비석 중심" 코드는 존재하지 않는다.
- 따라서 마이그레이션 대상 코드는 없고, 처음부터 일반화된
  `ResearchSet → SteleTab → SteleAsset` 구조로 구축한다.

## 2. 기술 스택 (P0 실배포 대비 로컬 실행 우선)

PRD 17장의 권장안(Next.js + FastAPI + PostgreSQL + Redis + Celery)을 장기 목표로 유지하되,
P0는 **로컬에서 외부 인프라 없이 전체 수직 흐름이 실제로 동작**해야 하므로 다음을 채택한다.

| 레이어 | P0 선택 | PRD 권장안과의 관계 |
|---|---|---|
| 웹 | Next.js App Router, TypeScript strict, React 19, React Three Fiber, Zustand(persist), TanStack Query, Tailwind CSS | PRD 권장안 그대로 |
| API | Fastify 5 + TypeScript + zod 검증 (typed REST) | FastAPI 대신 typed REST — PRD는 "REST 또는 typed RPC + 타입 안정성"을 요구하며 이를 충족 |
| DB | SQLite(better-sqlite3), JSON 컬럼 활용 | PostgreSQL 마이그레이션을 전제로 저장소 계층을 repository 함수로 격리 |
| 검색 | 자체 BM25 + 문자 n-gram (packages/engine) | PostgreSQL FTS/pgvector 이전 단계 |
| 3D | 절차 생성 가상 메시 + PLY/STL/ASC 헤더 파서(품질 보고서) | Open3D 변환 파이프라인은 P1 |
| 저장 | 로컬 `.data/originals`(불변) / `.data/derived` | S3 호환 스토리지는 P1 |
| 테스트 | Vitest(단위·API 통합), Playwright 1.56(E2E, 데스크톱+모바일) | PRD 그대로 |

## 3. 모노레포 구조

```
/apps
  /web        Next.js UI (대시보드, 워크스페이스, Glyph Matrix, Frontier, Dossier, Export)
  /api        Fastify REST API + SQLite + 시드 로더 + 감사 로그 + 업로드/내보내기
/packages
  /types      zod 스키마 + 공유 타입 (엔터티, enum, API DTO)
  /engine     도메인 로직: 성숙도/Frontier 점수, BM25, 출처 계보, 인용 검증,
              교차 비석 점수, Decision Gate, EpiDoc/CSV/보고서 내보내기,
              PLY/STL/ASC 파서, 가상 비석 절차 생성
/data
  /seed       매니페스트 기반 시드 JSON (연구 세트, 6개 탭, Source Card, 가상 비석,
              가상 글리프, 가상 문헌 코퍼스, Frontier Watch)
/docs         IMPLEMENTATION_PLAN, DATA_PROVENANCE, RIGHTS_POLICY,
              RESEARCH_MATURITY, EVALUATION_PROTOCOL, FIRST_STELE_ONBOARDING
/e2e          Playwright 시나리오 (PRD 26장 E2E 1~5 + 모바일 + 콘솔 오류)
/infra        docker-compose.yml (P1: PostgreSQL/Redis/MinIO 전환용 스텁)
```

## 4. 데이터 모델 (P0 테이블)

`research_sets`, `stele_tabs`, `source_records`, `stele_assets`, `asset_licenses`,
`documents`(허구 코퍼스, 출처 계보 포함), `glyph_cells`, `glyph_candidates`,
`restoration_hypotheses`, `hypothesis_evidence`, `cross_stele_matches`,
`frontier_watch_items`, `decision_records`, `audit_events`, `export_bundles`,
`benchmark_cases`(정답 격리 저장 — 후보 생성 경로에서 접근 금지).

## 5. 핵심 수직 흐름 (P0 완료 정의)

```
연구 세트(고구려·초기 신라 비문 비교) 열기
→ 6개 기본 탭 (충주=PRIMARY/BENCHMARK, 광개토=COMPARATIVE, 울진=BENCHMARK/COMPARATIVE,
   월성=FRONTIER/FRAGMENT_SET, 지안=FRONTIER/REFERENCE_ONLY, 창녕=WATCHLIST/FRONTIER)
→ 충주 탭: 공식 Source Card + 수동 업로드 슬롯 + 가상 데모 메시(가상 표시)
→ 손상 글자 셀 선택
→ 독립 후보 생성 (해당 비석 시각 특징만)
→ 교차 비석 유사 글자 조회 (Glyph Matrix)
→ 허구 문헌 코퍼스에서 지지·반대 근거 검색 (BM25 + 이체자 확장)
→ 출처 계보(재인용 병합) + 인용 위치 검증
→ Decision Gate → MULTI_SOURCE_AUTOMATIC / CONFLICTING / UNKNOWN
→ Evidence Dossier + 감사 로그
→ JSON·CSV·EpiDoc XML·보고서 내보내기 (출처·권리·모델 버전 manifest 포함)
```

## 6. 데이터 권리 원칙 (구현 반영)

- 실제 국가유산 3D 파일을 저장소에 포함하지 않는다. 시드는 **메타데이터와 공식 URL**만 담는다.
- 충주·울진 탭에는 관리자 importer(사용자가 직접 내려받은 PLY/STL/ASC 등록)를 제공하며,
  등록 자산은 공공누리 유형 확인 전 `VERIFY_REQUIRED` 상태로 두고 외부 공개 내보내기를 차단한다.
- 가상 비석(DEMO-A/B/C/D)은 UI 전면에 `가상 데이터` 배지를 표시하고 실제 유물 데이터로 표기하지 않는다.
- 허구 문헌 코퍼스는 제목·본문에 허구임을 명시한다.

## 7. 검증 계획

1. `pnpm typecheck` — 전 패키지 TS strict 통과
2. `pnpm test` — engine 단위 테스트 + api 통합 테스트(fastify.inject)
3. `pnpm e2e` — Playwright: 멀티 탭 상태 복원, Glyph Matrix, Frontier, 권리 게이트,
   UNKNOWN 결정, 모바일 레이아웃(390×844), 콘솔 오류 0 확인
4. 브라우저 스크린샷 기반 시각 검증 (데스크톱/모바일)
5. 3D 메모리: 탭 비활성 시 Canvas 언마운트 + WebGL 컨텍스트 해제 카운터 검증

## 8. P0 이후 (P1/P2 요약)

- 실제 PLY/STL/ASC → GLB 변환 워커(Open3D/Trimesh), RTI 뷰어, 곡률·법선 레이어
- Claim Matrix, Source Snapshot 자동 아카이브, benchmark suite 확장
- PostgreSQL/pgvector, S3, 기관 API 어댑터, 자동 신규 발견 모니터링
