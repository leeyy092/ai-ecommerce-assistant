/**
 * 私有阿里云 OSS 适配（TASK-007 / M04；11_DEVELOPMENT_RULES:87 合同指定 ali-oss）。
 * - 仅在 STORAGE_DRIVER=oss 时启用；配置缺失在首次使用时明确报错（EnvValidationError）；
 * - 真实账号联调（上传/下载/签名 URL 打通）需云资源，当前未执行——如实记录为
 *   剩余范围（TASK-029 试点运维阶段核验），本适配的可测试性由注入 client 的
 *   单元测试保证（不伪造云端联调证据）。
 */
import { loadEnv } from "@/lib/env";

/** 与 ali-oss 实例形态兼容的最小接口（测试可注入假实现） */
export interface OssClientLike {
  put(key: string, buffer: Buffer): Promise<unknown>;
  get(key: string): Promise<{ content: Buffer }>;
  getStream(key: string): Promise<{ stream: NodeJS.ReadableStream }>;
  head(key: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  copy(toKey: string, fromKey: string): Promise<unknown>;
}

const g = globalThis as typeof globalThis & {
  __aieaOssClient?: OssClientLike;
};

/** 测试注入点：设置后 getOssClient 直接返回该实例 */
export function setOssClientForTests(client: OssClientLike | undefined): void {
  g.__aieaOssClient = client;
}

export function getOssClient(): OssClientLike {
  if (g.__aieaOssClient) return g.__aieaOssClient;
  // 惰性加载 ali-oss（local 驱动零开销；oss 驱动配置缺失时给出明确变量名）
  const Oss = require("ali-oss") as new (opts: {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
  }) => OssClientLike;
  const env = loadEnv(["auth"]); // storage driver=oss 时 oss 段被隐式启用
  if (!env.oss) {
    throw new Error("STORAGE_DRIVER=oss 需要配置 OSS_BUCKET/OSS_REGION/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET");
  }
  return new Oss({
    region: env.oss.region,
    bucket: env.oss.bucket,
    accessKeyId: env.oss.accessKeyId,
    accessKeySecret: env.oss.accessKeySecret,
  });
}

/** 签名下载 URL（合同：5 分钟有效）；key 为对象键，返回带签名的完整 URL */
export function ossSignedUrl(client: OssClientLike, key: string, ttlSeconds: number): string {
  // ali-oss signatureUrl(url, options)；这里以最小接口约定（假实现可断言参数）
  const signed = (client as OssClientLike & {
    signatureUrl?: (key: string, opts: { expires: number }) => string;
  }).signatureUrl;
  if (typeof signed !== "function") {
    throw new Error("OSS client 不支持 signatureUrl（签名下载不可用）");
  }
  return signed.call(client, key, { expires: ttlSeconds });
}
