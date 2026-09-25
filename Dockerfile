# 석문 Studio — 연구실 서버용 이미지 (API·웹 공용, 명령만 다르게 실행)
# 빌드:  docker compose build
# 데이터(SQLite·원본 파일)는 볼륨 /data 에만 쓴다 — 이미지에 연구 자료를 넣지 않는다.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
# better-sqlite3 네이티브 빌드 대비 (프리빌트가 없을 때만 사용)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/engine/package.json packages/engine/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Next.js의 /api 프록시 대상은 빌드 시점에 고정된다 (compose의 api 서비스)
ARG SEOKMUN_API_URL=http://api:4100
ENV SEOKMUN_API_URL=$SEOKMUN_API_URL
RUN pnpm --filter @seokmun/web build

FROM base AS runtime
ENV NODE_ENV=production \
    SEOKMUN_DATA_DIR=/data \
    SEOKMUN_HOST=0.0.0.0
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app/apps/web/.next
USER node
VOLUME ["/data"]
EXPOSE 3100 4100
# 실행 시에는 pnpm/corepack을 쓰지 않는다 (오프라인 연구실 서버에서 추가 다운로드 없음)
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/index.ts"]
