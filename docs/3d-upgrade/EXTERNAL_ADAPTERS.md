# 외부 프로그램·API 어댑터

공통 레지스트리(`apps/api/src/threeD/adapters.ts`)가 각 어댑터의 활성화(env)·실행 파일
존재·라이선스 경고를 검증해 `GET /api/3d/adapters`로 보고한다.
**이 개발 컨테이너에는 어떤 외부 3D 바이너리도 설치되어 있지 않으며, 전부
`UNAVAILABLE`/`DISABLED`로 정직하게 표시된다. 앱 전체 흐름은 데모 파이프라인(순수 TS)으로 동작한다.**

| 어댑터 | 모드 | 라이선스 | 기본 상태 | 활성화 |
|---|---|---|---|---|
| COLMAP | CLI | BSD-3 (OPEN_SOURCE) | UNAVAILABLE (바이너리 없음) | `COLMAP_BIN` |
| OpenMVS | CLI | AGPL-3.0 (RESTRICTED) | **DISABLED** — AGPL 서버 의무 경고 | `OPENMVS_ENABLED=true` + 정책 검토 |
| Meshroom/AliceVision | CLI | MPL-2.0 | UNAVAILABLE | `MESHROOM_BIN` |
| Nerfstudio Splatfacto | CLI(Docker) | Apache-2.0 | DISABLED (GPU 필요) | `NERFSTUDIO_ENABLED=true` |
| Blender 배치 베이커 | CLI | GPL-3.0 (별도 프로세스 — 비전염) | UNAVAILABLE | `BLENDER_BIN` |
| splat-transform | CLI | MIT | UNAVAILABLE | `SPLAT_TRANSFORM_BIN` |
| RealityScan | CLI/Node | 상용 | DISABLED | `REALITYSCAN_ENABLED` + BIN/URL/TOKEN |
| Metashape Pro | Python | 상용 | DISABLED — CI 실행 금지 | `METASHAPE_ENABLED` |
| Sketchfab Download API | REST | 모델별 CC | DISABLED | `SKETCHFAB_ENABLED` + OAuth — attribution 자동 기록 요구 |
| Open Heritage 3D | REST | 데이터셋별 | 메타데이터 커넥터만 | — |

## 동작 규약

- 미가용 어댑터로 `POST /api/3d/reconstruction/jobs` → **409 + 사유** (앱은 실패하지 않음).
- `POST /api/3d/splat/train` → 501 + Nerfstudio 상태 안내, 데모 경로(`/api/3d/splat/demo`) 제시.
- `POST /api/3d/adapters/:id/validate` — 환경 재검증.
- 상용·AGPL 어댑터는 라이선스 경고(licenseWarning)를 항상 동반한다.
- 실제 제출 파이프라인(submit/status/collect)은 어댑터 실행 환경 구성 후 P1에서 구현 —
  현재는 인터페이스·검증·정직한 상태 보고까지.

## 수집 정책 (변경 없음)

무단 크롤링 금지 — 사용자 직접 업로드 · 공식 API · 공식 다운로드 · 공개 덤프 ·
명시적 허가 URL만. Sketchfab 모델은 비석과 무관하면 재질·조명 테스트 전용이며
이름이 같다는 이유로 연구 자산으로 자동 채택하지 않는다.
