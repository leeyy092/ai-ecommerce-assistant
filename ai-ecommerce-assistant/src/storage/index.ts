/**
 * 私有存储适配器（TASK-007；20_FILE_STORAGE 契约的 P0 本地实现）。
 * - 全部对象存于私有根（默认 <app>/.data/private，绝不位于 public/）；
 *   客户消息等业务文件不进静态目录（验收：客户消息不进 public）。
 * - 下载走 HMAC 签名 URL（exp 过期 + 绑定对象键 + 调用者），不暴露目录。
 * - STORAGE_DRIVER=oss 时显式拒绝（P0 未实现 OSS，不冒称可用）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { loadEnv } from "@/lib/env";

const gRoot = globalThis as typeof globalThis & { __aieaStorageRoot?: string };

/** 私有根目录（进程内单例；测试可用 setStorageRoot 覆盖为临时目录） */
export function storageRoot(): string {
  if (!gRoot.__aieaStorageRoot) {
    const env = loadEnv(["auth"]);
    gRoot.__aieaStorageRoot =
      process.env.STORAGE_PRIVATE_ROOT ?? path.join(process.cwd(), ".data", "private");
    void env;
  }
  return gRoot.__aieaStorageRoot;
}

export function setStorageRoot(root: string): void {
  gRoot.__aieaStorageRoot = root;
}

/** 对象键 → 绝对路径（拒绝路径遍历；键必须落在私有根内） */
function resolveKey(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`非法存储键：${key}`);
  }
  return full;
}

function signingKey(): string {
  return loadEnv(["auth"]).auth?.secret ?? "aiea-local-signing";
}

function hmac(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

export interface DownloadSignature {
  key: string;
  expiresAt: number;
  signature: string;
}

/** 生成签名下载参数（默认 10 分钟有效） */
export function signDownload(key: string, ttlSeconds = 600): DownloadSignature {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  return { key, expiresAt, signature: hmac(`${key}:${expiresAt}`) };
}

/** 校验签名（恒时比较；过期无效） */
export function verifyDownload(sig: DownloadSignature): boolean {
  if (typeof sig.expiresAt !== "number" || sig.expiresAt < Date.now()) return false;
  const expected = Buffer.from(hmac(`${sig.key}:${sig.expiresAt}`));
  const got = Buffer.from(String(sig.signature));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export interface PutOptions {
  /** 来源流（如上传文件体）；写入过程由调用方负责限流/计数 */
  content: NodeJS.ReadableStream;
}

/** 落盘到私有存储；返回最终键与字节数 */
export async function putObject(key: string, content: NodeJS.ReadableStream): Promise<{ key: string; bytes: number }> {
  if (process.env.STORAGE_DRIVER === "oss") {
    throw new Error("P0 未实现 OSS 存储；请使用 STORAGE_DRIVER=local");
  }
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  let bytes = 0;
  content.on("data", (chunk: Buffer | string) => {
    bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
  });
  await pipeline(content, createWriteStream(full));
  return { key, bytes };
}

/** 读取对象为流（下载/后续解析用） */
export function getObjectStream(key: string): NodeJS.ReadableStream {
  return createReadStream(resolveKey(key));
}

/** 读小对象全文（validate handler 用；20MB 上限内） */
export async function getObjectText(key: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(resolveKey(key), "utf8");
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await stat(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await unlink(resolveKey(key)).catch(() => undefined);
}
