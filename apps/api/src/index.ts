import { buildServer } from "./server";

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST?.trim() || "127.0.0.1";
const app = buildServer();

app
  .listen({ port, host })
  .then(() => {
    console.log(`[seokmun-api] listening on http://${host}:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
