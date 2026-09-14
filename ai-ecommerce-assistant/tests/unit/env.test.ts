import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "@/lib/env";
import { resolveDbUrl } from "@/lib/dbUrl";

/** 模拟含密钥的真实连接串，用于断言错误信息不泄露值 */
const SECRET_URL = "postgres://user:supersecret-value@127.0.0.1:5433/aiea_dev";

describe("resolveDbUrl（M05 数据库口令统一与 URL 编码）", () => {
  it("显式 DATABASE_URL 优先；不读磁盘 .env（注入场景）", () => {
    const url = resolveDbUrl(
      {
        DATABASE_URL: SECRET_URL,
        PGHOST: "db",
        PGUSER: "u",
        PGPASSWORD: "p",
        PGDATABASE: "d",
      },
      false,
    );
    expect(url).toBe(SECRET_URL);
  });

  it("PG* 分量组装：口令含 URL 保留字符时正确 percent-encode", () => {
    const url = resolveDbUrl(
      {
        PGHOST: "postgres",
        PGPORT: "5432",
        PGUSER: "aiea",
        PGPASSWORD: "p@ss w0rd:!/#?",
        PGDATABASE: "aiea_dev",
      },
      false,
    );
    expect(url).toBe(
      `postgresql://aiea:${encodeURIComponent("p@ss w0rd:!/#?")}@postgres:5432/aiea_dev`,
    );
    // 组装结果可被 URL 构造器解析且口令还原一致
    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.password)).toBe("p@ss w0rd:!/#?");
    expect(parsed.hostname).toBe("postgres");
    expect(parsed.pathname).toBe("/aiea_dev");
  });

  it("全部来源缺失（禁读 .env）返回空串，不猜测目标", () => {
    expect(resolveDbUrl({}, false)).toBe("");
  });
});

describe("loadEnv（TASK-001 环境变量校验）", () => {
  it("M05：无 DATABASE_URL 时由 PG* 分量组装连接串（注入场景不读磁盘 .env）", () => {
    const env = loadEnv([], {
      PGHOST: "db",
      PGUSER: "aiea",
      PGPASSWORD: "x:y@z",
      PGDATABASE: "aiea_dev",
    });
    expect(env.databaseUrl).toBe(
      `postgresql://aiea:${encodeURIComponent("x:y@z")}@db:5432/aiea_dev`,
    );
  });

  it("最小合法配置通过，并提供既定默认值", () => {
    const env = loadEnv([], { DATABASE_URL: SECRET_URL });
    expect(env.databaseUrl).toBe(SECRET_URL);
    expect(env.storageDriver).toBe("local");
    expect(env.logLevel).toBe("info");
    expect(env.nodeEnv).toBe("development");
    expect(env.oss).toBeUndefined();
  });

  it("缺少 DATABASE_URL 时抛 EnvValidationError：点名变量且不泄露任何值", () => {
    let caught: unknown;
    try {
      loadEnv([], { LOG_LEVEL: "info", DATABASE_URL: SECRET_URL.slice(0, 0) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const err = caught as EnvValidationError;
    expect(err.variables).toContain("DATABASE_URL");
    expect(err.message).toContain("DATABASE_URL");
    expect(err.message).not.toContain("supersecret-value");
    expect(err.variables.every((name) => /^[A-Z][A-Z0-9_]*$/.test(name))).toBe(true);
  });

  it("非法 LOG_LEVEL / STORAGE_DRIVER 枚举值被拒绝并点名", () => {
    let caught: unknown;
    try {
      loadEnv([], { DATABASE_URL: SECRET_URL, LOG_LEVEL: "verbose" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).variables).toContain("LOG_LEVEL");

    caught = undefined;
    try {
      loadEnv([], { DATABASE_URL: SECRET_URL, STORAGE_DRIVER: "s3" });
    } catch (error) {
      caught = error;
    }
    expect((caught as EnvValidationError).variables).toContain("STORAGE_DRIVER");
  });

  it("STORAGE_DRIVER=oss 时要求完整 OSS 变量，缺失一次性点名", () => {
    let caught: unknown;
    try {
      loadEnv([], { DATABASE_URL: SECRET_URL, STORAGE_DRIVER: "oss" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const vars = (caught as EnvValidationError).variables;
    for (const name of [
      "OSS_BUCKET",
      "OSS_REGION",
      "OSS_ACCESS_KEY_ID",
      "OSS_ACCESS_KEY_SECRET",
    ]) {
      expect(vars).toContain(name);
    }
  });

  it("STORAGE_DRIVER=oss 且 OSS 变量齐全时通过", () => {
    const env = loadEnv([], {
      DATABASE_URL: SECRET_URL,
      STORAGE_DRIVER: "oss",
      OSS_BUCKET: "demo-bucket",
      OSS_REGION: "oss-cn-beijing",
      OSS_ACCESS_KEY_ID: "ak",
      OSS_ACCESS_KEY_SECRET: "sk",
    });
    expect(env.storageDriver).toBe("oss");
    expect(env.oss?.bucket).toBe("demo-bucket");
  });

  it("components 含 auth 时校验 BETTER_AUTH_*；未启用时不强制", () => {
    expect(() =>
      loadEnv(["auth"], { DATABASE_URL: SECRET_URL, BETTER_AUTH_URL: "http://x" }),
    ).toThrowError(EnvValidationError);

    const env = loadEnv(["auth"], {
      DATABASE_URL: SECRET_URL,
      BETTER_AUTH_SECRET: "s",
      BETTER_AUTH_URL: "http://x",
    });
    expect(env.auth?.url).toBe("http://x");

    // TASK-001 未启用认证组件：仅 DATABASE_URL 即可启动
    expect(() => loadEnv([], { DATABASE_URL: SECRET_URL })).not.toThrow();
  });

  it("components 含 ai 时校验 DASHSCOPE_* 与 AI_MODEL_ID", () => {
    let caught: unknown;
    try {
      loadEnv(["ai"], { DATABASE_URL: SECRET_URL });
    } catch (error) {
      caught = error;
    }
    const vars = (caught as EnvValidationError).variables;
    for (const name of ["DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "AI_MODEL_ID"]) {
      expect(vars).toContain(name);
    }
  });
});
