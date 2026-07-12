# 라이선스 요약

상세 감사표는 `DEPENDENCY_AND_LICENSE_AUDIT.md` 참조.

- 번들 런타임: three / @react-three/fiber / drei / @gltf-transform (전부 MIT) — 재배포 문제 없음.
- HDRI·외부 텍스처 **0건** — 환경광은 three 내장 RoomEnvironment(MIT) 절차 생성.
- 외부 프로그램은 번들하지 않고 별도 프로세스 어댑터로만 연동 (GPL Blender 비전염,
  AGPL OpenMVS 기본 비활성+경고, 상용 RealityScan/Metashape 기본 비활성).
- 데모 3D·자형·문헌·스플랫은 전부 자체 제작 허구 자산 (CC0 상당, `VIRTUAL_DEMO` 표기).
- 사용자 업로드 자산: 공공누리 항목별 확인 전 `VERIFY_REQUIRED` — 외부 공개 내보내기 차단
  (기존 권리 게이트 유지, 파생 GLB variant는 원본 rightsState 상속: `licenseState=INHERITED`).
