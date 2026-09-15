import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ali-oss 为 CJS SDK（内部动态 require），不参与打包，运行时从 node_modules 解析
  serverExternalPackages: ["ali-oss"],
};

export default nextConfig;
