import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_URL =
  process.env.SEOKMUN_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:4100" : undefined);
const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ["@seokmun/types", "@seokmun/engine", "@seokmun/api"],
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: path.resolve(WEB_DIR, "../.."),
  async rewrites() {
    if (!API_URL) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
