/**
 * GET /api/health —— 公开基础探针（08_API_SPEC §17.2）。
 * 健康时 200 {status:"ok"}；数据库不可用或环境缺失时 503 {status:"degraded"}。
 * 响应不包含连接串、密钥、内部配置、堆栈或业务数据。
 */
import { NextResponse } from "next/server";
import { loadEnv } from "@/lib/env";
import { getDbPool, pingDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let ok = false;
  try {
    const env = loadEnv();
    ok = await pingDb(getDbPool(env));
  } catch {
    ok = false;
  }

  return NextResponse.json(
    { status: ok ? "ok" : "degraded" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
