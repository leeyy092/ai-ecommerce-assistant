/**
 * G2-R3-H06/H08｜spool 上传中断收尾回归（单元层，无 DB）。
 * 反例来自 REVIEW 3 stream-faults：输入流 error 必须与解析/写流错误走同一单次收尾——
 * 删除半截临时文件并恰好调用一次 onAbort（关闭请求源），不得留下无人拥有的 tmp。
 * INVALID_CSV 控制组保留已过行为，防止收尾重构回退。
 */
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStorageRoot } from "@/storage";
import { deleteObjectSafe, spoolUpload } from "@/services/imports";

let root: string;
const tmpFiles = (): string[] => (existsSync(join(root, "tmp")) ? readdirSync(join(root, "tmp")) : []);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aiea-spool-"));
  setStorageRoot(root);
});

afterEach(() => {
  // 换独立空目录，避免用例间文件计数串扰
  setStorageRoot(mkdtempSync(join(tmpdir(), "aiea-spool-after-")));
});

describe("G2-R3-H06/H08｜spool 中断收尾", () => {
  it("输入流 error：删除半截 spool（新 tmp=0）并恰好调用一次 onAbort", async () => {
    const before = tmpFiles();
    let abortCalls = 0;
    const stream = new PassThrough();
    const pending = spoolUpload(stream, () => {
      abortCalls += 1;
    });
    stream.write("a,b\n1,2\n");
    await vi.waitUntil(() => tmpFiles().length > before.length, { timeout: 5_000 });
    stream.destroy(new Error("review injected client disconnect"));
    await expect(pending).rejects.toMatchObject({ code: "UPLOAD_INTERRUPTED" });
    await new Promise((r) => setTimeout(r, 100));
    expect(tmpFiles().filter((f) => !before.includes(f))).toHaveLength(0);
    expect(abortCalls).toBe(1);
  });

  it("控制组：解析错误（INVALID_CSV）仍删除 spool 并调用 onAbort 一次", async () => {
    const before = tmpFiles();
    let abortCalls = 0;
    const stream = new PassThrough();
    const pending = spoolUpload(stream, () => {
      abortCalls += 1;
    });
    stream.write('a,b\n"bad"invalid,x\n');
    await expect(pending).rejects.toMatchObject({ code: "INVALID_CSV" });
    await new Promise((r) => setTimeout(r, 100));
    expect(tmpFiles().filter((f) => !before.includes(f))).toHaveLength(0);
    expect(abortCalls).toBe(1);
  });

  it("控制组：正常上传解析成功后 deleteObjectSafe 清理临时文件", async () => {
    const before = tmpFiles();
    const spooled = await spoolUpload(PassThrough.from([Buffer.from("a,b\n1,2\n")]));
    expect(spooled.dataRows).toBe(1);
    await deleteObjectSafe(spooled.tempKey);
    expect(tmpFiles().filter((f) => !before.includes(f))).toHaveLength(0);
  });
});
