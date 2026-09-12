import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs loads its worker from its own package at runtime. Bundling it breaks
  // that resolution, so it stays external and is required from node_modules.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
