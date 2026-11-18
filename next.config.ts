import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Worksheet uploads (PDF/DOCX/images) go through a Server Action; Vercel caps
  // request bodies at 4.5 MB, so files are limited to 4 MB in the app.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
