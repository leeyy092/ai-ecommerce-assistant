/**
 * M04｜OSS 存储适配单元测试（注入 client，不触真实云）。
 * STORAGE_DRIVER=oss 时 put/get/text/move/exists/signatureUrl 走 OSS 分支；
 * 真实账号联调（云端上传/下载打通）未执行——如实记录为剩余范围，不在此冒充。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { deleteObject, getObjectStream, getObjectText, moveObject, objectExists, putObject, setStorageRoot, signDownload } from "@/storage";
import { getOssClient, ossSignedUrl, setOssClientForTests, type OssClientLike } from "@/storage/oss";

class FakeOss implements OssClientLike {
  objects = new Map<string, Buffer>();
  signed: { key: string; expires: number }[] = [];
  async put(key: string, buffer: Buffer) {
    this.objects.set(key, buffer);
    return {};
  }
  async get(key: string) {
    const content = this.objects.get(key);
    if (!content) throw Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" });
    return { content };
  }
  async getStream(key: string) {
    const { content } = await this.get(key);
    const { PassThrough } = await import("node:stream");
    const pt = new PassThrough();
    pt.end(content);
    return { stream: pt };
  }
  async head(key: string) {
    if (!this.objects.has(key)) throw new Error("NoSuchKey");
    return {};
  }
  async delete(key: string) {
    this.objects.delete(key);
    return {};
  }
  async copy(toKey: string, fromKey: string) {
    const content = this.objects.get(fromKey);
    if (!content) throw new Error("NoSuchKey");
    this.objects.set(toKey, content);
    return {};
  }
  signatureUrl(key: string, opts: { expires: number }) {
    this.signed.push({ key, expires: opts.expires });
    return `https://fake.oss/priv/${key}?expires=${opts.expires}`;
  }
}

let fake: FakeOss;
const savedDriver = process.env.STORAGE_DRIVER;

beforeEach(() => {
  process.env.STORAGE_DRIVER = "oss";
  fake = new FakeOss();
  setOssClientForTests(fake);
  setStorageRoot(mkdtempSync(join(tmpdir(), "aiea-oss-")));
});

afterEach(() => {
  setOssClientForTests(undefined);
  process.env.STORAGE_DRIVER = savedDriver;
});

describe("M04｜OSS 适配（可测试；真实云端联调未执行）", () => {
  it("put/get/text/exists/delete 走注入的 OSS client", async () => {
    const { key, bytes } = await putObject("raw/t1/source.csv", Readable.from([Buffer.from("a,b\n1,2\n")]));
    expect(key).toBe("raw/t1/source.csv");
    expect(bytes).toBe(8);
    expect(fake.objects.has(key)).toBe(true);
    expect(await objectExists(key)).toBe(true);
    expect(await getObjectText(key)).toBe("a,b\n1,2\n");
    const chunks: Buffer[] = [];
    for await (const c of getObjectStream(key) as AsyncIterable<Buffer>) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe("a,b\n1,2\n");
    await deleteObject(key);
    expect(await objectExists(key)).toBe(false);
  });

  it("moveObject 为 copy+delete（上传落位路径）", async () => {
    await putObject("tmp/u1.csv", Readable.from([Buffer.from("x")]));
    await moveObject("tmp/u1.csv", "raw/t2/source.csv");
    expect(fake.objects.has("raw/t2/source.csv")).toBe(true);
    expect(fake.objects.has("tmp/u1.csv")).toBe(false);
  });

  it("签名 URL 使用合同 5 分钟有效期", () => {
    const client = getOssClient();
    const url = ossSignedUrl(client, "raw/t3/source.csv", 300);
    expect(url).toContain("raw/t3/source.csv");
    expect(fake.signed[0]).toEqual({ key: "raw/t3/source.csv", expires: 300 });
  });

  it("本地 HMAC 签名默认 300 秒（G2-L02），过期无效", async () => {
    const sig = signDownload("raw/t4.csv");
    expect(Math.abs((sig.expiresAt - Date.now()) / 1000 - 300)).toBeLessThan(5);
    const expired = signDownload("raw/t4.csv", -1);
    const { verifyDownload } = await import("@/storage");
    expect(verifyDownload(sig)).toBe(true);
    expect(verifyDownload({ ...expired, expiresAt: Date.now() - 1000 })).toBe(false);
  });
});
