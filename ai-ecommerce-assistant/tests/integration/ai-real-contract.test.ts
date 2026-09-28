/**
 * TASK-017｜脱敏真实模型 contract（06 §8.1“开工时验证模型可调用”）。
 *
 * 合同：运行一次脱敏真实模型调用并分开记录结果；Key 只在服务端 env 读取，绝不打印。
 * 触发条件：DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / AI_MODEL_ID 三配置齐备且
 * AI_REAL_CONTRACT=1。配置缺失时本文件如实 skip（不计为通过），017 不得在
 * 真实 contract 未通过时标 DONE。
 */
import { describe, expect, it } from "vitest";
import { getModelTransport, callModelWithRetry } from "@/ai/providers/model-provider";
import { FIXED_MODEL_ID } from "@/ai/schemas/validators";

// 只核对非空状态（不打印任何值）；loadEnv(["ai"]) 对缺失是快速失败，探测阶段不适用
const aiConfigured = Boolean(process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_BASE_URL && process.env.AI_MODEL_ID);
const enabled = process.env.AI_REAL_CONTRACT === "1" && aiConfigured;
const aiEnv = enabled
  ? { apiKey: process.env.DASHSCOPE_API_KEY!, baseUrl: process.env.DASHSCOPE_BASE_URL!, modelId: process.env.AI_MODEL_ID! }
  : null;

describe.skipIf(!enabled)("TASK-017 真实模型 contract（脱敏）", () => {
  it("固定模型可调用且返回可解析 json_object（不打印任何密钥/响应全文）", async () => {
    expect(aiEnv?.modelId).toBe(FIXED_MODEL_ID);
    const transport = getModelTransport({ apiKey: aiEnv!.apiKey, baseUrl: aiEnv!.baseUrl, modelId: aiEnv!.modelId });
    const { response } = await callModelWithRetry(transport, {
      systemPrompt: "你是测试执行器，只输出一个JSON对象。",
      userPrompt: '请输出 {"ok": true} 这一个JSON对象，不要输出其他内容。',
      maxOutputTokens: 32,
    }, { timeoutMs: 30_000, backoffMs: [1_000] });
    expect(typeof response.content).toBe("string");
    const parsed = JSON.parse(response.content) as { ok?: boolean };
    expect(parsed.ok).toBe(true);
    expect(response.usage).not.toBeNull();
    // 只记录脱敏后的用量计数，不保存响应正文与密钥
  }, 60_000);
});

describe.skipIf(enabled)("TASK-017 真实模型 contract 未配置", () => {
  it("三配置为空/未开启时如实跳过（不视为通过）", () => {
    expect(enabled).toBe(false);
    // 记录状态：待Owner提供本地配置后受控执行（请求已提出一次，不重复催问）
  });
});
