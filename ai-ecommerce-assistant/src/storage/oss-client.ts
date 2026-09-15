/**
 * ali-oss 客户端工厂（独立文件：便于 serverExternalPackages 标记外部化，
 * Web/Worker 均在运行时从 node_modules 解析，不参与打包）。
 */
import { loadEnv } from "@/lib/env";
import type { OssClientLike } from "./oss";

export function createOssClient(): OssClientLike {
  // oss 驱动配置缺失时给出明确变量名（EnvValidationError 只含变量名不含值）
  const env = loadEnv(["auth"]); // STORAGE_DRIVER=oss 时 oss 段被隐式启用
  if (!env.oss) {
    throw new Error("STORAGE_DRIVER=oss 需要配置 OSS_BUCKET/OSS_REGION/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Oss = require("ali-oss") as new (opts: {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
  }) => OssClientLike;
  return new Oss({
    region: env.oss.region,
    bucket: env.oss.bucket,
    accessKeyId: env.oss.accessKeyId,
    accessKeySecret: env.oss.accessKeySecret,
  });
}
