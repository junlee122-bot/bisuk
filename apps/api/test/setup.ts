// API 통합 테스트 공통 환경 — dev 인증(요청마다 개발 PI), 초기화 허용, 로그 끔
process.env.SEOKMUN_AUTH_MODE ??= "dev";
process.env.SEOKMUN_ENABLE_DEV_RESET ??= "1";
process.env.SEOKMUN_LOG_LEVEL ??= "silent";
