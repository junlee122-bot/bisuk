# 알려진 한계 (Known Limitations)

정직성 원칙: 아래 항목은 구현하지 않았거나 부분 구현이며, 완료된 것처럼
표기하지 않는다.

## P1 잔여 기술 부채 (스펙이 '건너뛰면 문서화' 허용한 항목)

| 항목 | 상태 | 비고 |
|---|---|---|
| BVH 가속 피킹 | 미구현 | 현재 셀 평면 피킹은 O(셀 수)로 충분(57칸). 대규모 실측 메시 도입 시 three-mesh-bvh 검토 |
| ROI 가중 QEM 간소화 | 미구현 | 현행은 정점 클러스터링(오차 상한=셀 크기). 명문 영역 보존 가중치는 QEM 도입과 함께 |
| KTX2/Basis 텍스처 | 미구현 | 현재 텍스처는 PMREM·그림자맵뿐(외부 텍스처 0) — 압축 대상 부재. 베이크 텍스처 도입 시 필요 |
| Blender 배치 베이크 실행 | 어댑터 인터페이스만 | 컨테이너에 바이너리 없음 — `UNAVAILABLE` 정직 보고 유지 |
| Nerfstudio/COLMAP 실행 | 어댑터 인터페이스만 | `POST /api/3d/splat/train` → 501 유지 (E2E 검증) |
| WebGPU 렌더 경로 | 미구현 | `NEXT_PUBLIC_3D_RENDERER=webgpu` 요청 시 `UNAVAILABLE_*` 배지 + WebGL 동작 (조용한 대체 아님 — 상태 노출) |

## 실기기 측정

- 모든 성능 수치는 SwiftShader 컨테이너 기준 — 절대 성능 아님.
  `PENDING_REAL_DEVICE` 마커와 `REAL_DEVICE_TEST_PLAN.md` 절차·JSON 스키마로 대체.

## 쇼케이스·UI

- `/showcase/[setId]/[steleId]` 개별 비석 딥링크 미구현 — 세트 쇼케이스에서
  주 대상(3D 보유 탭)을 자동 선택. 챕터 URL(`?chapter=n`)은 구현.
- 첫 진입 인트로(포스터→미세 dolly-in)는 생략 — 자동 연출 최소화 원칙을 우선.
- Command Palette·전체 검색·사용자 메뉴(스펙 §4.2 선택 요소) 미구현.
- 탭 썸네일은 실루엣 아이콘 수준, 데이터 품질 Q0–Q4 배지는 탭 단위 품질
  집계 플럼빙이 없어 미표시 (품질 정보는 3D 품질 패널에 존재).
- 모바일 Inspector bottom sheet 미구현 — 기존 패널 칩 전환 유지 (E2E 검증 범위).
  확대경 모바일 제스처(길게 누르기) 미지원 — 데스크톱 M 키·버튼만.
- 매그니파이어는 원근 카메라 전용 (정사영에서는 비활성 동작 없음 — 렌더 생략).
- Surface Compare 동기화는 카메라 동기화만 — 조명/줌/분석 모드 개별 동기화
  토글은 미구현 (전역 모드 버튼이 양쪽에 일괄 적용되는 기존 구조 유지).

## 데이터·표현

- 자동 LOD 임계값은 데모 슬래브(높이 2.0) 기준으로 튜닝 — 실측 자산별 보정 필요.
- 전시 무대 플린스·바닥 톤은 고정 토큰 — SceneLook의 stage 필드는 저장되나
  뷰포트에는 전시/연구 규칙이 우선 적용된다.
- 쇼케이스 지표의 "미확정 비율"은 UNKNOWN·CONFLICTING readingStatus 기준 —
  세트 헤더의 "미해결"(판독 확정 전 전체) 집계와 정의가 다르며 라벨로 구분.
- 접근성: 자동화 스캐너 미실행, 3D 장면 셀 단위 스크린리더 내레이션 없음.

## 스펙 §16 테스트 목록 중 미구현 항목

- 단위: preset migration(마이그레이션 대상 스키마 변경 없음), ROI weight
  normalization(ROI QEM 미구현), environment license manifest(외부 HDRI 0건).
- API: HDRI license metadata(대상 없음), KTX2 lineage(미구현), Blender worker
  fixture(어댑터 실행 미구현 — unavailable 409/501 검증은 기존 테스트에 존재),
  Showcase chapter 저장 API(챕터는 URL 상태 — 서버 저장 불필요 설계).
- E2E: detail patch blend 세부(로딩 배지 검증으로 대체), 모바일 bottom sheet
  (기능 자체 미구현).
