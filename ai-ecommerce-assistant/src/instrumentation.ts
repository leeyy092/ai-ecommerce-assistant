/**
 * Next.js 服务端启动钩子（Edge/Node 共用入口）。
 * 仅在 Node runtime 动态加载环境校验，避免 Edge 编译不支持的 API。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
