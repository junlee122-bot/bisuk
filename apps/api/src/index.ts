import { buildServer } from "./server";

const port = Number(process.env.PORT ?? 4100);
const app = buildServer();

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`[seokmun-api] listening on http://localhost:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
