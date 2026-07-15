# Blender 가상 비석 자산 파이프라인

## 결과물

DEMO-A의 박물관 프레젠테이션 모델은 외부 3D 모델, 이미지 텍스처, 글꼴, HDRI를 사용하지 않는 원본 가상 자산이다.

- 웹 전달본: `apps/web/public/models/demo-a-museum-stele.glb`
- 편집 가능한 원본: `assets/blender/demo-a-museum-stele.blend`
- 결정론적 생성기: `scripts/blender/generate_museum_stele.py`
- 시드 연결: `data/seed/demo-glyphs.json`의 `asset-demo-a.meshParams.presentationAssetUrl`

이 모델은 역사 유물의 계측 복원물이 아니다. 형상, 풍화, 새김 무늬는 모두 BISUK 프레젠테이션을 위해 만든 허구의 시각화이며 `GENERATED_VISUAL_ONLY`, `measurementAllowed: false`로 표시한다.

## 재생성

Blender 2.93.18에서 다음 명령을 저장소 루트에서 실행한다.

```powershell
$blender = if ($env:BLENDER_BIN) { $env:BLENDER_BIN } else { 'blender' }
& $blender `
  --background --factory-startup `
  --python scripts/blender/generate_museum_stele.py -- `
  --output-glb apps/web/public/models/demo-a-museum-stele.glb `
  --output-blend assets/blender/demo-a-museum-stele.blend
```

생성기는 고정 시드 `410219`를 사용한다. 실행할 때마다 동일한 장면 구성, 메시 형상, 오브젝트 이름, 재질 파라미터를 만든다. 생성기가 마지막에 GLB 헤더의 `glTF` 매직, glTF 버전 2, 선언 길이와 실제 파일 크기를 검사하고 SHA-256을 출력한다.

## 모델 구성

- 고밀도 메시를 실제로 변형한 풍화 표면과 완만한 상단 아치
- 베벨 처리한 석비 외곽, 결정론적으로 잘라낸 가장자리 손실 9개
- 표면 안쪽으로 불리언 가공한 허구 자형 18개와 별도 cavity-shadow 메시
- 3단 석재 받침과 바닥 기준 `z=0`
- Principled BSDF 기반 석재, 받침, 새김 내부 PBR 재질
- `.blend`에 포함된 절차적 색 변화·미세 범프, 박물관 바닥, 58 mm 카메라, 3점 area-light 리그

웹 GLB에는 메시와 재질만 선택 내보내기 한다. 카메라, 조명, 스튜디오 바닥을 제외하고 텍스처 좌표, 애니메이션, 탄젠트를 생략해 전달 크기를 줄였다. Draco는 런타임 디코더 의존성을 만들지 않도록 사용하지 않는다.

## 좌표와 사용 범위

- 단위: 미터
- 바닥: `z=0`
- 대략적인 전체 범위: `x=1.38 m`, `y=0.72 m`, `z=2.85 m`
- 비문 면: 로컬 `-Y`
- 원점: 받침 중앙 바닥

기존 DEMO-A의 절차 메시 파라미터는 연구 UI와 비교 흐름을 위해 유지한다. `presentationAssetUrl`은 시각 품질용 Blender 모델을 가리키며, 치수 산출이나 증거 메시 대체에 사용하면 안 된다.

## 저작권과 의존성

모든 지오메트리, 허구 자형, 재질 노드, 조명은 스크립트가 생성한다. 외부 자산의 복제·다운로드·번들링이 없으므로 별도 모델/텍스처 라이선스 고지는 필요하지 않다. Blender 자체는 결과물에 포함되지 않으며, Blender 실행 파일 경로는 개발 환경 전용이다.
