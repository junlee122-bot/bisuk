# 시각 방향 — CONTEMPORARY MUSEUM ARCHIVE

## 현재 문제 (CURRENT_VISUAL_AUDIT 요약)

- 전면 다크 개발자 도구 룩: 검정 배경 + 1px 테두리 + 11px 회색 텍스트 + 배지 과밀.
- 3D가 무대 없이 부유하고, 재질이 중경에서 점토처럼 읽힘.
- 앱 정체성(석문 Studio) 부재, 연구 전용 용어가 관람자에게 그대로 노출.
- 빈/로딩/오류 상태가 디자인되지 않음.

## 목표 인상

**밝고 따뜻한 현대 박물관 아카이브.** 종이·석재·먹의 물성. 관람자는 "잘 큐레이션된
전시 도록"을, 연구자는 "정돈된 실측 작업대"를 느낀다. 근거 없는 화려함 금지 —
모든 시각 요소는 유물(비석)을 주인공으로 만드는 데 봉사한다.

## 색상 팔레트 (토큰 — Phase 1에서 `globals.css`로 구현)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--canvas-page` / `--canvas-page-deep` | `#f3f0e9` / `#ebe6dc` | 페이지 기본/심화 배경 (따뜻한 종이) |
| `--surface-primary` / `--surface-secondary` | `#fbfaf7` / `#f6f3ed` | 카드·패널 표면 |
| `--surface-elevated` | `rgba(255,254,250,.92)` | 부상 패널(모달·툴바) |
| `--surface-muted` | `#ece8df` | 비활성·보조 영역 |
| `--ink-primary` / `--ink-secondary` / `--ink-tertiary` | `#1d1c19` / `#5f5b53` / `#817b70` | 먹색 텍스트 3단 위계 |
| `--ink-inverse` | `#fbfaf7` | 어두운 표면 위 텍스트 |
| `--line-soft` / `--line-strong` / `--line-focus` | `#ddd7cc` / `#c8c0b4` / `#8f593f` | 경계선/포커스 |
| `--accent-clay` / `--accent-clay-strong` | `#9f5b3f` / `#7d432f` | 주 강조 (점토·철분) — 선택·CTA |
| `--accent-jade` / `--accent-jade-soft` | `#2f6a62` / `#dbe8e4` | 보조 강조 (옥색) — 검증·링크 |
| `--accent-ochre` | `#a96f27` | 가상 데모·주의 표기 |
| `--state-success/warning/danger/info` | `#31695a` / `#94641f` / `#9a463f` / `#42677b` | 상태색 (저채도) |
| `--stage-top/bottom/floor/grid` | `#f7f4ee` / `#e5ded2` / `#ded6c8` / `rgba(70,65,58,.12)` | 3D 무대 cyclorama·바닥 |
| `--shadow-xs/sm/md/stage` | 스펙 §3.1 값 | 4단 그림자 |

원칙: 페이지는 따뜻한 종이색, 카드는 순백보다 약간 따뜻하게, 본문은 순검정 대신
부드러운 먹색, 주 강조는 저채도 점토 갈색, 보조는 옥색. 경고·불확실성은 색+아이콘
+문구 병행(색맹 대응). **색을 코드 전역에 직접 흩뿌리지 않는다 — 토큰만 사용.**

## 타이포그래피

- 디스플레이(제목·수치): **Noto Serif KR** — 세트 제목, 챕터 제목, 히어로.
- 본문/UI: **Noto Sans KR** — 시스템 폴백 체인 유지.
- 공급: `next/font`(자체 호스팅 서브셋) — 런타임 CDN 불안정성 금지, OFL 라이선스
  기록을 `DEPENDENCY_AND_ASSET_LICENSES.md`에 남김.
- 위계: 페이지 제목 20–24px serif / 섹션 14–16px semibold / 본문 13–14px /
  캡션·메타 11–12px `--ink-tertiary`. 본문 대비 AA(4.5:1) 이상.
- 금지: 붓글씨·캘리그래피 본문 폰트, 장식 서체 남용.

## 레이아웃 원칙

- 글로벌 헤더 1개(석문 Studio 워드마크 + EXHIBITION/RESEARCH 전환 + 세트 브레드크럼).
- 3열 구조 유지하되 여백 8px 그리드, 패널은 테두리 대신 표면색 차 + `--shadow-xs`.
- 정보 중복 제거: 세트 요약 수치는 헤더 1곳, 탭 배지는 최대 3개 + 오버플로 "+n".
- 모바일: 뷰 전환 칩 1행 고정, 툴바는 시트로 접기, 터치 타깃 44pt.

## 3D 무대 원칙

- 캔버스는 투명, 무대는 CSS cyclorama(`--stage-top→bottom` 수직 그라데이션).
- EXHIBITION: 프레젠테이션 바닥 + 선택적 플린스 — **비석과 별도 노드,
  raycast 제외, `PRESENTATION_STAGE_ONLY` 표기**. RESEARCH: 중립 라이트 그레이
  배경 + 범례, 무대 소품 없음.
- Evidence Mesh 정점은 시각 연출로 절대 수정하지 않는다. 원본에 없는 획·균열·
  파손·요철 생성 금지. 표시 보강은 `PRESENTATION_ENHANCED`로 구분 표기.
- 모델은 무대 높이의 62–78%, 기본 카메라는 ¾ 히어로 구도.
- 조명 프리셋 전환은 180–320ms 러프 보간, 모드 전환은 카메라·선택·탭 상태 유지.

## 카드·패널 원칙

- 표면 `--surface-primary`, 모서리 10–12px, `--shadow-xs` 기본 / hover `--shadow-sm`.
- 배지는 저채도 배경 + 진한 잉크 텍스트(다크 배지 반전). 상태 라벨은 인간화된
  한국어(예: `PRESENTATION_ENHANCED` → "전시 표현 보강") + 원문은 툴팁/상세.
- 빈 상태·로딩·오류는 카드 안에서 아이콘+제목+행동 버튼으로 디자인.

## 모션 원칙

- 마이크로 전환 150–220ms, 조명 보간 180–320ms, 카메라 북마크 500–900ms ease.
- 사용자 입력은 언제나 애니메이션을 즉시 중단시킨다.
- `prefers-reduced-motion`: 카메라 애니메이션·자동 전환 전부 즉시 점프로 대체.
- 금지: 자동 회전(auto-rotate), 무한 루프 모션, 시차 스크롤 남용.

## 접근성 원칙

- 본문 대비 AA 이상, 포커스 링(`--line-focus` 2px) 전 인터랙티브 요소.
- 색만으로 상태 구분 금지 — 아이콘·문구 병행.
- 키보드: 탭 순서 논리적, 북마크 1–5 키, 매그니파이어 M 키는 문서화 + 버튼 대응.
- 스크린리더: 3D 캔버스에 role/aria-label, 수치 패널은 표로 노출.

## 금지 스타일

검은 전체 배경 · 네온·글로우 · bloom/lens flare · 자동 회전 · 붓글씨 본문 폰트 ·
가짜 성능/정확도 수치 · 근거 없는 "복원 완료" 연출 · 클레이 이외의 원색 강조 ·
런타임 외부 CDN 폰트 · 항상 켜진 `preserveDrawingBuffer`.

## Before / Target

- Before: `screenshots/before/BEFORE_WORKSPACE_DEFAULT.png` — 검정 개발 도구.
- Target: 위 토큰으로 구성한 밝은 박물관 작업대 — AFTER 캡처는 완료 후 동일 카메라
  조건으로 `screenshots/after/`에 생성해 `BEFORE_AFTER.md`에서 대조한다.
