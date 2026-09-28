/**
 * GET /api/v1/alert-rules（08 §17.2；G4R2 H07 修复版）
 * 规则阈值、启用状态、版本与样本门槛读取（O/A/P；403/404）。
 * 读取店铺当前 ruleset 下每条规则的最新配置；未物化的规则按引擎默认呈现
 * （引擎构建时会以同值落库）。附带最近一次评估状态便于配置页解释影响。
 */
import type { NextRequest } from "next/server";
import { ok, fail, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { ALWAYS_DISABLED, DEFAULT_RULE_PARAMS, RULE_VERSION } from "@/services/alerts/engine";

export const runtime = "nodejs";

const RULE_IDS = Object.keys(DEFAULT_RULE_PARAMS);

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewBusinessData });
    const url = new URL(req.url);
    const storeId = url.searchParams.get("store_id") ?? "";
    if (!storeId) return fail(422, "缺少 store_id", { code: "VALIDATION_ERROR" });
    const db = getPrismaClient();
    const store = await db.store.findFirst({ where: { orgId: ctx.orgId, id: storeId }, select: { id: true, rulesetVersion: true, currentSnapshotVersion: true, snapshotStatus: true } });
    if (!store) return fail(404, "店铺不存在", { code: "NOT_FOUND" });

    const items = [];
    for (const ruleId of RULE_IDS) {
      const cfg = await db.ruleConfig.findFirst({ where: { orgId: ctx.orgId, storeId, rulesetVersion: store.rulesetVersion, ruleId }, orderBy: { ruleVersion: "desc" } });
      const parameters = (cfg?.parameters ?? DEFAULT_RULE_PARAMS[ruleId] ?? {}) as Record<string, unknown>;
      const latestEval = await db.ruleEvaluation.findFirst({ where: { orgId: ctx.orgId, storeId, ruleId }, orderBy: { updatedAt: "desc" }, select: { status: true, reasonCode: true, periodStart: true, entityKey: true, subchannel: true } });
      items.push({
        rule_id: ruleId,
        enabled: cfg?.enabled ?? !ALWAYS_DISABLED.has(ruleId),
        rule_version: cfg?.ruleVersion ?? RULE_VERSION,
        ruleset_version: store.rulesetVersion,
        thresholds: parameters,
        sample_thresholds: Object.fromEntries(Object.entries(parameters).filter(([k]) => k.startsWith("min_") || k === "zero_day_needed")),
        config_version: cfg?.rowVersion ?? 0,
        p1_not_enableable: ALWAYS_DISABLED.has(ruleId),
        latest_evaluation: latestEval ? { status: latestEval.status, reason_code: latestEval.reasonCode, period_start: latestEval.periodStart.toISOString().slice(0, 10), entity_key: latestEval.entityKey, subchannel: latestEval.subchannel } : null,
      });
    }

    return ok(
      { items },
      {
        dataset_version: store.currentSnapshotVersion?.toString() ?? null,
        ruleset_version: store.rulesetVersion,
        snapshot_status: store.snapshotStatus,
      },
    );
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
