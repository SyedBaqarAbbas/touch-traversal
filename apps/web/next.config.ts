import type { NextConfig } from "next";

import { normalizePublicBasePath } from "./lib/public-url";

const basePath = normalizePublicBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

const nextConfig: NextConfig = {
  basePath,
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  typedRoutes: true,
};

export default nextConfig;
