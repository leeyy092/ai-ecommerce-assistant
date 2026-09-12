/**
 * 环境变量校验（TASK-001）。
 * 按当前启用的组件分阶段校验；缺失时抛出 EnvValidationError，
 * 错误信息只包含变量名，绝不包含任何变量值（DATABASE_URL 等含密钥）。
 */
import { z } from "zod";

const baseSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .optional()
    .default("development"),
  DATABASE_URL: z.string().min(1, "必填"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
  STORAGE_DRIVER: z.enum(["local", "oss"]).optional().default("local"),
});

const authSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(1, "必填"),
  BETTER_AUTH_URL: z.string().min(1, "必填"),
});

const aiSchema = z.object({
  DASHSCOPE_API_KEY: z.string().min(1, "必填"),
  DASHSCOPE_BASE_URL: z.string().min(1, "必填"),
  AI_MODEL_ID: z.string().min(1, "必填"),
});

const ossSchema = z.object({
  OSS_BUCKET: z.string().min(1, "必填"),
  OSS_REGION: z.string().min(1, "必填"),
  OSS_ACCESS_KEY_ID: z.string().min(1, "必填"),
  OSS_ACCESS_KEY_SECRET: z.string().min(1, "必填"),
});

export type EnvComponent = "auth" | "ai";

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  storageDriver: "local" | "oss";
  auth?: { secret: string; url: string };
  ai?: { apiKey: string; baseUrl: string; modelId: string };
  oss?: {
    bucket: string;
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
  };
}

export class EnvValidationError extends Error {
  /** 缺失或非法的变量名列表（不含任何值） */
  readonly variables: string[];

  constructor(variables: string[]) {
    const unique = [...new Set(variables)];
    super(
      `缺少或非法的启动必需环境变量：${unique.join(", ")}。` +
        `请检查 .env（参考 .env.example）或进程环境；` +
        `出于安全考虑不输出变量值。`,
    );
    this.name = "EnvValidationError";
    this.variables = unique;
  }
}

type VarSource = Record<string, string | undefined>;

/** 把校验失败项的变量名（不含值）收集进列表 */
function pushVars(error: z.ZodError, into: string[]): void {
  for (const issue of error.issues) {
    into.push(issue.path.map(String).join(".") || "未知变量");
  }
}

/**
 * 校验并返回当前进程的环境配置。
 * @param components 额外启用的组件（auth / ai）；oss 由 STORAGE_DRIVER=oss 隐式启用。
 * @param source 变量来源，默认 process.env；测试可注入纯对象。
 */
export function loadEnv(components: EnvComponent[] = [], source: VarSource = process.env): AppEnv {
  const invalid: string[] = [];

  const base = baseSchema.safeParse(source);
  if (!base.success) {
    pushVars(base.error, invalid);
    throw new EnvValidationError(invalid);
  }

  const env: AppEnv = {
    nodeEnv: base.data.NODE_ENV,
    databaseUrl: base.data.DATABASE_URL,
    logLevel: base.data.LOG_LEVEL,
    storageDriver: base.data.STORAGE_DRIVER,
  };

  if (components.includes("auth")) {
    const auth = authSchema.safeParse(source);
    if (auth.success) {
      env.auth = { secret: auth.data.BETTER_AUTH_SECRET, url: auth.data.BETTER_AUTH_URL };
    } else {
      pushVars(auth.error, invalid);
    }
  }

  if (components.includes("ai")) {
    const ai = aiSchema.safeParse(source);
    if (ai.success) {
      env.ai = {
        apiKey: ai.data.DASHSCOPE_API_KEY,
        baseUrl: ai.data.DASHSCOPE_BASE_URL,
        modelId: ai.data.AI_MODEL_ID,
      };
    } else {
      pushVars(ai.error, invalid);
    }
  }

  if (env.storageDriver === "oss") {
    const oss = ossSchema.safeParse(source);
    if (oss.success) {
      env.oss = {
        bucket: oss.data.OSS_BUCKET,
        region: oss.data.OSS_REGION,
        accessKeyId: oss.data.OSS_ACCESS_KEY_ID,
        accessKeySecret: oss.data.OSS_ACCESS_KEY_SECRET,
      };
    } else {
      pushVars(oss.error, invalid);
    }
  }

  if (invalid.length > 0) throw new EnvValidationError(invalid);
  return env;
}
