import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  transpilePackages: ["firebase-admin"],
};

export default nextConfig;