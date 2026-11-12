import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production Webpack compilation in the main process. This avoids the
  // separate build worker used by Next 16's default Webpack configuration.
  experimental: {
    webpackBuildWorker: false,
  },
};

export default nextConfig;
