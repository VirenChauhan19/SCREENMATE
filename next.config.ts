import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/extension": ["./extension/manifest.json", "./extension/background.js", "./extension/content/*.js", "./extension/popup/*", "./extension/icons/*.png"],
  },
  outputFileTracingExcludes: {
    "/api/extension": ["./extension/config.json"],
  },
};

export default nextConfig;
