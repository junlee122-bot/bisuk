import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ApiApp = ReturnType<(typeof import("@seokmun/api/server"))["buildServer"]>;
type RoutedMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

const globalApi = globalThis as typeof globalThis & {
  seokmunApiPromise?: Promise<ApiApp>;
};

function apiApp(): Promise<ApiApp> {
  const existing = globalApi.seokmunApiPromise;
  if (existing) return existing;

  const pending: Promise<ApiApp> = import("@seokmun/api/server").then(async ({ buildServer }) => {
    const app = buildServer();
    await app.ready();
    return app;
  });
  globalApi.seokmunApiPromise = pending;
  void pending.catch(() => {
    if (globalApi.seokmunApiPromise === pending) delete globalApi.seokmunApiPromise;
  });
  return pending;
}

const BODYLESS_METHODS = new Set<RoutedMethod>(["GET", "HEAD", "OPTIONS"]);
const BODYLESS_STATUSES = new Set([204, 205, 304]);

async function handle(request: NextRequest): Promise<Response> {
  const app = await apiApp();
  const url = new URL(request.url);
  const method = request.method as RoutedMethod;
  const payload = BODYLESS_METHODS.has(method)
    ? undefined
    : Buffer.from(await request.arrayBuffer());

  const response = await app.inject({
    method,
    url: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(request.headers.entries()),
    ...(payload === undefined ? {} : { payload }),
  });

  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || name === "content-length" || name === "transfer-encoding") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, String(item));
    } else {
      headers.set(name, String(value));
    }
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-seokmun-runtime-storage", process.env.VERCEL ? "ephemeral" : "local");

  const body = BODYLESS_STATUSES.has(response.statusCode)
    ? null
    : new Uint8Array(response.rawPayload);
  return new Response(body, { status: response.statusCode, headers });
}

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as OPTIONS,
  handle as PATCH,
  handle as POST,
  handle as PUT,
};
