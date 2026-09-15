// vitest 全局 setup：暴露 auth 单例重置钩子供 pgMigrate 调用
import { resetAuthForTests } from "../../src/lib/auth";

(globalThis as { __require_auth_reset__?: () => void }).__require_auth_reset__ =
  resetAuthForTests;
