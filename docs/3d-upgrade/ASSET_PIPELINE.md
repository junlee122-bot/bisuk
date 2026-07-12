# 3D 자산 파이프라인 (P0 구현)

## 원본 불변 + 계보

- 원본: `SteleAsset` (업로드 파일은 `originals/`에 `wx` 쓰기 + sha256, 절차 데모는 파라미터).
- 파생: `AssetVariant` — `parentVariantIds`, `pipelineName/Version/Parameters`, `sha256`,
  `sourceState(MEASURED/DERIVED/PRESENTATION_ENHANCED/GENERATED_VISUAL_ONLY)`,
  `measurementAllowed`, `visualizationOnly`, `qualityLevel(Q0~Q4)` 기록.
- 원본 정점을 수정하는 경로는 없다. RAW variant는 DELETE 금지(403).
- `GENERATED_VISUAL_ONLY` 레이어는 현재 **존재하지 않음** (생성형 미사용 — 도입 시 기본 비활성 정책).

## 데모(절차 생성) 경로 — `POST /api/3d/assets/:id/upgrade`

```
VALIDATING → INSPECTING → GENERATING_LOD → BAKING → COMPRESSING → QUALITY_CHECK → READY
```

| Variant | 격자 | 삼각형 | 용도 |
|---|---|---|---|
| EVIDENCE_MESH_PREVIEW | 24×64 | ≈3.1k | 초기 표시 (Q1) |
| EVIDENCE_MESH_MEDIUM | 48×128 | ≈12.3k | 일반 (Q2) |
| EVIDENCE_MESH_HIGH | 144×384 | ≈110.6k | 근접 관찰 (Q3) — 측정 허용 |
| PBR_MESH_MEDIUM/HIGH | 동일 격자 | 동일 | cavity 강화 알베도 — PRESENTATION_ENHANCED, 측정 불가 |
| GLYPH_DETAIL_PATCH | 셀당 128×128 | 32.8k | 글자 클로즈업 스트리밍 (측정 허용) |
| SPLAT_SOURCE_PLY / SPLAT_DELIVERY | 60k 점 | — | 표시 전용 (visualization_only) |

- LOD별 **실측 격자 이산화 오차**(밀집 8k 샘플 대비 이중선형 보간, P95/max/mean)를
  variant.metrics에 기록. Q3 기준 P95 < 모델 최장변의 0.2%.
- GLB는 `@gltf-transform` + `KHR_mesh_quantization`(pos14/norm10/col8)으로 양자화.
  KTX2 텍스처 압축은 인코더 바이너리 미설치로 **미적용** (진단에 명시, P1).

## 업로드(실측) 경로 — ASCII PLY / STL

```
파싱(정점·면·색·법선) → 법선 없으면 재계산(경고 기록) → EVIDENCE_MESH_HIGH
→ 정점 클러스터링 간소화 (MEDIUM 6만△ / PREVIEW 8천△ 목표, 오차 상한=클러스터 셀 크기 기록)
→ GLB 양자화 → variants
```

- 바이너리 PLY·OBJ 파싱은 P1 (실패 시 job FAILED로 정직하게 보고).
- 비문면 보호 마스크(INSCRIPTION_FRONT) 기반 가중 간소화는 P1 —
  현재 간소화는 균일 클러스터링이며 그 오차 상한을 metrics에 기록한다.

## 좌표계

`stele-space`: +Y 위, +X 관찰자 오른쪽, +Z 비문면→관찰자, 원점 = 비석 중심.
데모 자산은 `unit: 가상 단위`, `scaleConfidence: ASSUMED` — UI에 "상대 크기·mm 환산 없음" 상시 표시.

## 벤치마크 격리 유지

숨김 벤치마크 셀의 마모 획은 파생 기하(GLB·패치·스플랫)에도 포함하지 않는다
(API 응답 sanitize 정책과 일관 — 파생물에서 정답 복원 불가).
