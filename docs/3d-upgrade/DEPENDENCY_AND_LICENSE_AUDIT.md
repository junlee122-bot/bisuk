# 3D 의존성·라이선스 감사

## 번들되는 런타임 의존성 (재배포됨)

| 이름 | 버전 | 라이선스 | 용도 | 비고 |
|---|---|---|---|---|
| three | 0.180.0 | MIT | 렌더러·지오메트리 | RoomEnvironment(examples, MIT) 사용 — 외부 HDRI 불필요 |
| @react-three/fiber | 9.6.1 | MIT | React 통합 | |
| @react-three/drei | 10.7.7 | MIT | OrbitControls | Environment preset(외부 CDN HDR 다운로드)은 **사용 금지** — 오프라인·라이선스 명확성 위해 RoomEnvironment 사용 |
| @gltf-transform/core | ^4 | MIT | 서버측 GLB 생성 | 파생 자산 파이프라인 |
| @gltf-transform/functions | ^4 | MIT | quantize 등 | KHR_mesh_quantization (three GLTFLoader 기본 지원) |

## HDRI / 텍스처

- 외부 HDRI **미포함**. 중성 환경광은 three 내장 `RoomEnvironment`(절차 생성, MIT)로 생성 —
  라이선스·재배포 문제 없음. "실제 촬영 장소 재현" 주장 없음.
- 외부 텍스처 0장. 알베도·cavity는 자체 절차 생성.

## 선택적 외부 프로그램 (앱에 미포함 — 어댑터로만 연동)

| 이름 | 라이선스 | 상태 | 서버 노출 | 의무 |
|---|---|---|---|---|
| COLMAP | BSD-3 | UNAVAILABLE(미설치) | 별도 프로세스 | 저작자 표시 |
| OpenMVS | AGPL-3.0 | **기본 비활성** | 별도 프로세스 | AGPL — 서버 제공 시 소스 공개 의무. 정책 검토 전 활성화 금지 (자동 경고) |
| AliceVision/Meshroom | MPL-2.0 | UNAVAILABLE | 별도 프로세스 | 파일 단위 카피레프트 |
| Nerfstudio / gsplat | Apache-2.0 | UNAVAILABLE (GPU 필요) | 별도 컨테이너 | — |
| Blender | GPL-3.0 | UNAVAILABLE | **별도 프로세스 CLI** (링크 아님 → 앱 라이선스에 영향 없음) | 바이너리 재배포 시 GPL |
| splat-transform (PlayCanvas) | MIT | UNAVAILABLE | CLI | — |
| RealityScan | 상용 | DISABLED(기본) | CLI/Node | 라이선스 계약 필요, CI 실행 금지 |
| Metashape Pro | 상용 | DISABLED(기본) | Python API | 라이선스 확인 없이 CI 실행 금지 |
| Sketchfab Download API | API 약관 | DISABLED(기본) | REST | 모델별 CC 라이선스 확인·attribution 필수 |
| Open Heritage 3D | 데이터셋별 | 메타데이터 커넥터만 | REST | 데이터셋별 권리 확인 |

## 자동 경고 규칙 (구현됨)

어댑터 레지스트리는 licenseClass가 `RESTRICTED`(AGPL/상용/비상업)인 항목을 활성화하려 할 때
경고를 반환하고, env 플래그(`*_ENABLED`) 없이는 활성화하지 않는다.
