# 연구실 서버 배포·운영

석문 Studio를 연구실 공용 서버(또는 연구실 PC 한 대)에 띄워 여러 구성원이 함께 쓰는 방법입니다.
기본값은 "그대로 띄워도 안전한" 쪽입니다 — 로그인 필수, 개발용 초기화 비활성, API는 loopback 바인딩.

## 1. 가장 쉬운 방법: Docker Compose

```bash
cp .env.example .env        # 접속 주소·인증 방식 등 채우기
docker compose up -d --build
# 브라우저로 http://<서버>:3100 → 첫 접속 시 /setup 화면에서 PI(책임연구자) 계정 생성
```

- 웹(3100)만 밖으로 열리고, API는 컨테이너 내부 네트워크에서만 받습니다 (`/api`는 웹이 프록시).
- 연구 데이터(SQLite DB, 원본·파생 파일)는 `seokmun-data` 볼륨의 `/data`에만 저장됩니다. 이미지에는 연구 자료가 들어가지 않습니다.
- 실행 시 추가 다운로드가 없습니다 (오프라인 연구실 서버에서도 동작). 이미지 빌드에만 인터넷이 필요합니다.
- `SEOKMUN_SEED_DEMO=0`이면 가상 데모 세트를 만들지 않습니다 (실사용 서버 권장).

### 주요 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SEOKMUN_PUBLIC_ORIGIN` (compose) → `SEOKMUN_ALLOWED_ORIGINS` | `http://localhost:3100` | 브라우저가 접속하는 주소. 변경 요청의 Origin이 여기 없으면 403 (CSRF 방어) |
| `SEOKMUN_AUTH_MODE` | `local` | `local` 연구실 계정 / `proxy-header` 학교 SSO / `dev` 개발 전용 |
| `SEOKMUN_COOKIE_SECURE` | 운영 시 `1` | HTTPS 뒤에서는 반드시 1. 연구실 내부 HTTP로만 쓸 때만 0 |
| `SEOKMUN_DATA_DIR` | `/data` (컨테이너) | DB·원본·백업 위치 |
| `SEOKMUN_MAX_UPLOAD_BYTES` | 8 GiB | 업로드 최대 크기 (스트리밍 저장, 메모리에 올리지 않음) |
| `SEOKMUN_FULL_PARSE_MAX_BYTES` | 300 MiB | 이보다 큰 메시는 업로드 시 헤더만 검사 |
| `SEOKMUN_SESSION_TTL_HOURS` | 168 | 로그인 세션 유효 시간 |
| `SEOKMUN_BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | — | 첫 기동 시 PI 계정 자동 생성 (없으면 `/setup` 화면) |
| `SEOKMUN_SEED_DEMO` | `1` | 첫 실행 시 가상 데모 세트 생성 여부 |

## 2. 인증 방식

### local (기본) — 연구실 계정
- 첫 계정이 PI가 되고, PI가 `연구실 관리` 화면에서 구성원 계정을 발급합니다 (임시 비밀번호는 발급 화면에서 한 번만 표시).
- 비밀번호는 scrypt로 저장, 세션은 HttpOnly·SameSite=Lax 쿠키. 로그인 5회 실패 시 15분 잠금.
- 역할: **PI**(권리 확정·판독 채택·계정·백업·보정) / **연구원**(자료 등록·판독 제안·편집) / **열람자**(읽기).
- 연구 세트별 구성원을 지정하면 그 세트는 구성원만 접근합니다. 지정하지 않으면 연구실 전체 공유.

### proxy-header — 학교 SSO 리버스 프록시
학교 SSO(Shibboleth·CAS·OAuth2 Proxy 등)가 앞단에서 인증하고 사용자 헤더를 붙여 넘기는 구성입니다.

```
브라우저 → [SSO 리버스 프록시] ─ /api/* → API(4100)
                               └ /*     → 웹(3100)
```

- 프록시가 `X-Forwarded-User`/`X-Forwarded-Email`/`X-Forwarded-Preferred-Username` 헤더를 넣습니다 (이름은 `SEOKMUN_PROXY_*_HEADER`로 변경 가능).
- **`SEOKMUN_TRUSTED_PROXY_IPS`** 에 프록시 IP만 넣고, **`SEOKMUN_PROXY_SHARED_SECRET`** 을 설정해 프록시가 `X-Seokmun-Proxy-Secret` 헤더를 붙이게 하십시오. 둘 다 없으면 SSO를 우회한 직접 접속으로 헤더를 위조할 수 있습니다.
- 처음 들어온 사용자의 역할은 `SEOKMUN_PROXY_DEFAULT_ROLE`(기본 GUEST). PI가 역할을 올려 줍니다.
- 이 구성에서는 `/api/*`를 프록시가 API로 직접 보내는 것을 권장합니다 (웹의 `/api` 프록시를 거치면 API가 보는 접속 IP가 웹 컨테이너가 됩니다).

### dev — 개발·E2E 전용
- `pnpm dev:api`(= `--dev`)가 켜는 모드. 로그인 없이 개발용 PI로 동작하므로 **loopback(127.0.0.1)에서만** 기동되고, `NODE_ENV=production`에서는 거부됩니다.
- `/api/dev/reset`(DB 초기화)은 dev 모드 + `SEOKMUN_ENABLE_DEV_RESET=1` + loopback 요청일 때만 열립니다.

## 3. 백업·복원

- **온라인 백업** (서버 가동 중 가능 — SQLite 온라인 백업 + 원본 파일 스냅샷):
  ```bash
  docker compose exec api node --import tsx src/cli/backup.ts --label 주간 --verify
  # 컨테이너 없이: pnpm --filter @seokmun/api backup -- --label 주간 --verify
  ```
  결과는 `/data/backups/<시각>/` (manifest·체크섬 포함). 연구실 관리 화면의 "지금 백업"도 같은 기능입니다.
- **정기 백업**: 호스트 cron 예시 — `0 3 * * * docker compose -f /srv/seokmun/docker-compose.yml exec -T api node --import tsx src/cli/backup.ts --label nightly`
  그리고 `/data/backups`를 다른 디스크·NAS로 복사하십시오 (같은 디스크 백업만으로는 디스크 고장에 대비할 수 없습니다).
- **복원** (서버를 멈춘 뒤):
  ```bash
  pnpm --filter @seokmun/api restore -- <백업 디렉터리> <새 데이터 디렉터리>
  # 체크섬을 검증한 뒤 복사합니다. 이후 SEOKMUN_DATA_DIR=<새 데이터 디렉터리>로 기동
  ```
- **세트 번들**: 연구 세트 하나를 다른 서버로 옮길 때는 `연구실 관리 → 세트 번들 내려받기`, 받는 쪽 PI가 `POST /api/research-sets/import`로 가져옵니다 (충돌 시 거부, 벤치마크 정답은 포함하지 않음).
- DB 스키마는 `PRAGMA user_version` 기반 마이그레이션으로 기동 시 자동 적용됩니다. 업그레이드 전에는 백업을 먼저 하십시오.

## 4. 감사·무결성

- 모든 변경은 행위자·요청 ID와 함께 감사 로그에 남고, 로그는 DB 수준에서 수정·삭제가 거부됩니다 (append-only 트리거).
- 각 이벤트는 이전 이벤트 해시를 포함한 sha256 체인으로 연결됩니다. `감사 로그 → 해시 체인 검증`으로 변조·삭제 여부를 확인할 수 있습니다.

## 5. Docker 없이 (Linux·macOS·Windows)

```bash
pnpm install
pnpm --filter @seokmun/web build
SEOKMUN_API_URL=http://127.0.0.1:4100 pnpm --filter @seokmun/web start &   # 웹 3100
NODE_ENV=production SEOKMUN_DATA_DIR=/srv/seokmun-data pnpm --filter @seokmun/api start   # API 4100 (loopback)
```

- Node.js 20 이상, pnpm 10. `better-sqlite3`는 대부분 플랫폼에 미리 빌드된 바이너리가 있습니다.
- **Windows**: Docker Desktop(WSL2 백엔드) 사용을 권장합니다. 직접 실행할 때는 PowerShell에서 환경 변수를 `$env:SEOKMUN_DATA_DIR="D:\seokmun-data"`처럼 지정하고, 데이터 디렉터리는 동기화 폴더(OneDrive 등)가 아닌 로컬 디스크에 두십시오 (SQLite WAL 파일 손상 위험).
- 웹과 API를 다른 주소로 노출한다면 `SEOKMUN_ALLOWED_ORIGINS`에 웹 주소를 넣으십시오.

## 6. 용량·성능 메모

- 업로드는 스트리밍으로 디스크에 바로 쓰고 sha256을 함께 계산합니다. 300 MiB 초과 메시는 헤더만 검사하고, 브라우저 3D 뷰어는 250 MiB 초과 원본을 직접 열지 않습니다 (파생 LOD 사용).
- 글자 트리는 행 단위로 나눠 그리며, 판독 비교표·검색은 서버에서 계산합니다. 수천 자 규모 비석까지를 목표로 하며, 그 이상은 PostgreSQL 이전(infra/ 스텁)을 검토하십시오.
