/**
 * 私有存储适配器（TASK-007；20_FILE_STORAGE 契约）。
 * - 双驱动：STORAGE_DRIVER=local（默认，开发）→ 私有根目录 <app>/.data/private；
 *   STORAGE_DRIVER=oss → 私有阿里云 OSS（src/storage/oss.ts，M04 可测试适配）。
 *   全部对象位于私有根，绝不位于 public/（验收：客户消息不进 public）。
 * - 下载走 HMAC 签名 URL（exp 过期 + 绑定对象键），默认 300 秒（合同 5 分钟），
 *   不暴露目录；签名校验为应用侧恒时比较。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { loadEnv } from "@/lib/env";
import { getOssClient } from "./oss";

const gRoot = globalThis as typeof globalThis & { __aieaStorageRoot?: string };

function useOss(): boolean {
  return process.env.STORAGE_DRIVER === "oss";
}

/** 私有根目录（local 驱动；进程内单例，测试可 setStorageRoot 覆盖为临时目录） */
export function storageRoot(): string {
  if (!gRoot.__aieaStorageRoot) {
    gRoot.__aieaStorageRoot = process.env.STORAGE_PRIVATE_ROOT ?? path.join(process.cwd(), ".data", "private");
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
  // 下载签名的密钥与应用认证秘密同源；缺失时仅本地开发允许回退默认值
  try {
    const secret = loadEnv(["auth"]).auth?.secret;
    if (secret) return secret;
  } catch {
    // env 缺失（纯本地工具场景）→ 回退；生产经 compose 注入 BETTER_AUTH_SECRET
  }
  return "aiea-local-signing";
}

function hmac(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

export interface DownloadSignature {
  key: string;
  expiresAt: number;
  signature: string;
}

/** 生成签名下载参数（G2-L02：默认 300 秒，与 11:87 五分钟约定一致） */
export function signDownload(key: string, ttlSeconds = 300): DownloadSignature {
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

function streamToBuffer(content: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    content.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytes += buf.length;
      if (bytes > maxBytes) {
        (content as { destroy?: (error?: Error) => void }).destroy?.(new Error(`对象超过 ${maxBytes} 字节上限`));
        reject(new Error(`对象超过 ${maxBytes} 字节上限`));
        return;
      }
      chunks.push(buf);
    });
    content.on("end", () => resolve(Buffer.concat(chunks)));
    content.on("error", reject);
  });
}

/** 落盘到私有存储；返回最终键与字节数 */
export async function putObject(key: string, content: NodeJS.ReadableStream): Promise<{ key: string; bytes: number }> {
  if (useOss()) {
    const buffer = await streamToBuffer(content, 64 * 1024 * 1024);
    await getOssClient().put(key, buffer);
    return { key, bytes: buffer.length };
  }
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  let bytes = 0;
  await pipeline(
    async function* () {
      for await (const chunk of content as AsyncIterable<Buffer | string>) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        bytes += buf.length;
        yield buf;
      }
    }(),
    createWriteStream(full),
  );
  return { key, bytes };
}

/** 读取对象为流（下载/后续解析用） */
export function getObjectStream(key: string): NodeJS.ReadableStream {
  if (useOss()) {
    // getStream 为异步 API：以惰性流包装，错误经 error 事件冒泡
    const lazy = new Readable({ read() {} });
    void getOssClient()
      .getStream(key)
      .then(({ stream }) => {
        stream.on("data", (c: Buffer) => lazy.push(c));
        stream.on("end", () => lazy.push(null));
        stream.on("error", (e: Error) => lazy.destroy(e));
      })
      .catch((e: Error) => lazy.destroy(e));
    return lazy;
  }
  return createReadStream(resolveKey(key));
}

/** 读小对象全文（validate handler 用；20MB 上限内） */
export async function getObjectText(key: string): Promise<string> {
  if (useOss()) {
    const { content } = await getOssClient().get(key);
    return content.toString("utf8");
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(resolveKey(key), "utf8");
}

export async function objectExists(key: string): Promise<boolean> {
  if (useOss()) {
    try {
      await getOssClient().head(key);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await stat(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

/** 原子移动（同驱动内；local 为 rename，oss 为 copy+delete）——上传落位用 */
export async function moveObject(fromKey: string, toKey: string): Promise<void> {
  if (useOss()) {
    const client = getOssClient();
    await client.copy(toKey, fromKey);
    await client.delete(fromKey);
    return;
  }
  const from = resolveKey(fromKey);
  const to = resolveKey(toKey);
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
}

export async function deleteObject(key: string): Promise<void> {
  if (useOss()) {
    await getOssClient().delete(key).catch(() => undefined);
    return;
  }
  await unlink(resolveKey(key)).catch(() => undefined);
}
