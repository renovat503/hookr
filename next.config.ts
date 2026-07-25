import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js 16 truncates large multipart bodies by default (~1MB), which breaks
    // demo/motion/hook uploads and surfaces as "Failed to parse body as FormData."
    proxyClientMaxBodySize: "100mb",
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
