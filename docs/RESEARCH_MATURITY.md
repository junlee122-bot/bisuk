# 연구 성숙도와 Frontier Index

## 연구 성숙도 점수 (0~100)

PRD §4.2의 가중치를 그대로 구현한다 (`packages/engine/src/maturity.ts`).

```
0.15 source + 0.10 geometry + 0.10 image + 0.15 transcription + 0.15 bibliography
+ 0.10 independentTeam + 0.08 chronologyConsensus + 0.07 purposeConsensus
+ 0.05 openData + 0.05 rightsClarity
```

- 하위 점수 10종은 탭별로 UI(Source Card 패널)에 개별 표시한다.
- **이 점수는 진실성 점수가 아니라 "현재 공개 연구 기반의 성숙도"다.**
  UI와 API 응답에 이 고지를 함께 반환한다.
- P0의 하위 점수는 매니페스트 기반 시드 값(공개 자료에 대한 데모 추정치)이며,
  자동 산출(서지 수·독립 팀 수 집계)은 P1 범위다.

## Frontier Index (0~1)

PRD §4.3 가중치 그대로 (`computeFrontierIndex`):

```
0.25 unresolvedCharacterRatio + 0.20 historicalImportance + 0.15 discoveryRecency
+ 0.15 missingContextScore + 0.10 dataScarcity + 0.10 disagreementScore
+ 0.05 crossSteleConnectivity
```

- 점수가 높다고 자동 판독 우선순위가 높은 것이 아니다. UI는 권리 상태·자료 확보
  상태를 항상 함께 표시한다.
- Frontier Watch 상태 전이는 PRD §9.2의 9단계를 enum으로 구현했다.

## 안전 규칙 (구현 반영)

- 1차 판독은 어떤 화면에서도 확정 판독으로 표시되지 않는다
  (`1차 판독 — 확정 아님` 배지, 승격된 탭의 warnings).
- 승격은 METADATA_ONLY 탭을 생성할 뿐, 판독 코퍼스에 주장을 주입하지 않는다.
- 새 분석 실행은 기존 가설을 삭제하지 않고 runId 버전으로 누적한다.
