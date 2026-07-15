# 석문(石文) Comparative Autonomous Studio

여러 비석·비석 조각·탁본·판독문을 **탭으로 동시에 열고**, 허구가 아닌 출처 계보와
인용 검증을 거친 근거만으로 문자별 복원 가설을 생성·반박·판정하는
근거 중심 비문 연구 플랫폼입니다.

> ⚠️ 데모 데이터 고지 — 저장소에 포함된 비석 3D·자형·문헌은 전부 **자체 제작한
> 가상(허구) 데이터**이며 실제 유물 데이터나 실제 판독 결과가 아닙니다.
> 실제 국가유산 3D 파일은 포함되어 있지 않고, 자동 수집도 하지 않습니다.
> (자세한 경계: `docs/DATA_PROVENANCE.md`)

## 실행

```bash
corepack pnpm install
corepack pnpm dev:api   # http://localhost:4100 (Fastify + SQLite, 최초 실행 시 자동 시드)
corepack pnpm dev:web   # http://localhost:3100 (Next.js, /api → 4100 프록시)
```

로그인 없이 바로 데모에 진입합니다. 첫 연구 세트
**`고구려·초기 신라 비문 비교`** 에 6개 기본 탭(충주·광개토·울진·월성·지안·창녕)이
시드되어 있습니다.

## 검증

```bash
corepack pnpm typecheck   # TS strict 전 워크스페이스
corepack pnpm test        # engine 단위 + API 통합 테스트
corepack pnpm e2e         # Playwright 데스크톱·모바일 시나리오
```

DEMO-A의 박물관용 가상 GLB는 Blender 생성 스크립트로 재현할 수 있습니다. 자세한
명령과 시각 자산/연구용 근거 메시의 구분은
[`docs/3d-upgrade/BLENDER_ASSET_PIPELINE.md`](docs/3d-upgrade/BLENDER_ASSET_PIPELINE.md)를
참조하세요.

## 구조

```
apps/web        Next.js 15 + React Three Fiber 워크스페이스 UI
apps/api        Fastify 5 + better-sqlite3 REST API (+ 시드 로더, 감사 로그)
packages/types  zod 스키마 (엔터티·enum·API DTO)
packages/engine 순수 도메인 로직 (후보 생성, BM25, 계보, 인용 검증, Decision Gate,
                성숙도/Frontier Index, 조각 접합, PLY/STL/ASC 검사기, 내보내기)
data/seed       매니페스트 기반 시드 (공식 Source Card 메타데이터 + 가상 데모 데이터)
assets/blender  Blender 원본 장면(.blend)
scripts/blender 결정적 가상 비석·웹 GLB 생성기
docs            구현 계획·출처·권리·성숙도·평가·온보딩 문서
e2e             Playwright 시나리오 (PRD §26 E2E 1~5)
infra           P1 인프라 스텁 (PostgreSQL/Redis/MinIO)
```

## 핵심 흐름 (P0 수직 흐름)

연구 세트 → 6개 탭 → 문자 셀 선택 → 독립 후보 생성 → Glyph Matrix 교차 비교 →
문헌 지지·반증 검색(BM25+이체자) → 출처 계보 병합 + 인용 위치 검증 →
Decision Gate (자동 채택 / 상충 / 미상 / 판독 불가) → Evidence Dossier →
JSON·CSV·EpiDoc XML·보고서 내보내기(권리 게이트 + manifest) → 감사 로그
