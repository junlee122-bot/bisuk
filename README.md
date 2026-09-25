# 석문(石文) Comparative Autonomous Studio

여러 비석·비석 조각·탁본·판독문을 **탭으로 동시에 열고**, 허구가 아닌 출처 계보와
인용 검증을 거친 근거만으로 문자별 복원 가설을 생성·반박·판정하는
근거 중심 비문 연구 플랫폼입니다.

> ⚠️ 데모 데이터 고지 — 저장소에 포함된 비석 3D·자형·문헌은 전부 **자체 제작한
> 가상(허구) 데이터**이며 실제 유물 데이터나 실제 판독 결과가 아닙니다.
> 실제 국가유산 3D 파일은 포함되어 있지 않고, 자동 수집도 하지 않습니다.
> (자세한 경계: `docs/DATA_PROVENANCE.md`)

## 실행

### 개발 (혼자 써 보기)

```bash
pnpm install
pnpm dev:api   # http://localhost:4100 — 개발 모드(--dev): 로그인 없이 개발용 PI, loopback 전용
pnpm dev:web   # http://localhost:3100 (Next.js, /api → 4100 프록시)
```

첫 연구 세트 **`고구려·초기 신라 비문 비교`** 에 6개 기본 탭(충주·광개토·울진·월성·지안·창녕)이
가상 데이터로 시드됩니다. `/login` 화면에서 개발용 연구원·열람자 계정으로 바꿔 역할별 화면을 볼 수 있습니다.

### 연구실 서버 (여러 사람이 함께)

```bash
cp .env.example .env && docker compose up -d --build
```

로그인 필수(연구실 계정 또는 학교 SSO), 역할(PI·연구원·열람자), 세트별 구성원, 백업·복원 —
자세한 내용은 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## 연구 흐름 (실제 비석)

1. **비석 등록** — 탭 추가 → `비석 관리`에서 연대·소재·재질·출처 기록.
2. **자료 등록** — 사진·탁본(JPG·PNG·WebP·TIFF), 3D(PLY·STL·OBJ·GLB·E57·LAS), RTI, PDF를 대용량 스트리밍으로 원본 보존 등록 → 단위·축척 확정(축척 막대 두 점 지정 가능). 권리 확정은 PI.
3. **판독문 가져오기** — 출판 판독문을 Leiden 약식 표기로 붙여 넣으면 면·행·자 셀과 출판본 판독이 생성됩니다.
4. **셀 작업** — 사진·탁본 뷰어에서 글자 영역 지정·**원본에 보이는 획만** 추적, 3D 실측 뷰어에서 거리·단면 프로파일 측정.
5. **판독** — 연구원이 판독을 제안(확실도·복원·불확실·이체·근거·서지) → PI가 채택/기각 → 판독자별 비교표·토론·변경 이력.
6. **근거** — 자료실에서 서지(BibTeX·RIS·CSL-JSON)·문헌 등록, 문헌 속 주장(셀별 지지·반대)을 자동 제안받아 확인.
7. **자동 분석(참고)** — 후보·교차 비교·문헌 근거·계보·Decision Gate. 실제 셀은 보정 프로파일이 생기기 전까지 자동 확정하지 않으며, 결과는 판독안으로만 넘길 수 있습니다.
8. **내보내기** — 비석별 EpiDoc(TEI, 스키마 검증), 판독 비교표 CSV(Excel), 보고서(판독문·비교·참고문헌), 권리 게이트 적용.

## 검증

```bash
pnpm typecheck   # TS strict 전 패키지
pnpm test        # engine 단위 125건 + api 통합 82건
pnpm e2e         # Playwright 56건 (기능 39 + 시각 회귀 17, 데스크톱 + 모바일, 콘솔 오류 0 가드)
```

EpiDoc 내보내기는 EpiDoc 9.8 RELAX NG 스키마(`packages/engine/test/fixtures`)로 `xmllint` 검증 테스트를 거칩니다.

## 구조

```
apps/web        Next.js 15 + React Three Fiber 워크스페이스 UI
apps/api        Fastify 5 + better-sqlite3 REST API (+ 시드 로더, 감사 로그)
packages/types  zod 스키마 (엔터티·enum·API DTO)
packages/engine 순수 도메인 로직 (획 형상 유사도, BM25 어휘 검색+이체자 확장, 계보, 인용 검증,
                Decision Gate, 보정·평가 통계, 문맥 n-gram, 판독문 파서, 서지, EpiDoc·CSV·보고서,
                성숙도/Frontier Index, 조각 접합, PLY/STL/ASC 검사기)
data/seed       매니페스트 기반 시드 (공식 Source Card 메타데이터 + 가상 데모 데이터)
docs            구현 계획·출처·권리·성숙도·평가·온보딩 문서
e2e             Playwright 시나리오 (PRD §26 E2E 1~5)
infra           P1 인프라 스텁 (PostgreSQL/Redis/MinIO)
```

## 핵심 흐름 (P0 수직 흐름)

연구 세트 → 6개 탭 → 문자 셀 선택 → 독립 후보 생성 → Glyph Matrix 교차 비교 →
문헌 지지·반증 검색(BM25 어휘 검색 + 이체자 확장 — 의미 기반 검색은 아님) → 출처 계보 병합 + 인용 위치 검증 →
Decision Gate (자동 채택 / 상충 / 미상 / 판독 불가) → Evidence Dossier →
JSON·CSV·EpiDoc XML·보고서 내보내기(권리 게이트 + manifest) → 감사 로그
