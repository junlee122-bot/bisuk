import type { NextConfig } from "next";

const API_URL = process.env.SEOKMUN_API_URL ?? "http://localhost:4100";

const nextConfig: NextConfig = {
  transpilePackages: ["@seokmun/types", "@seokmun/engine"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
