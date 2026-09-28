/**
 * PATCH /api/v1/alert-rules/{rule_id}（08 §17.2；07 §28；G4R2 H07 修复版）
 * O/A 修改允许的阈值/启用状态：expected_version 对当前配置行 CAS（409）；
 * 修改增 store.ruleset_version、该规则增 rule_version（07 §28），
 * 其余规则配置保守延续到新 ruleset（不重置已调参数/停用状态）；
 * 触发重建并返回 rebuild_job_id。P1 规则（R04/R06）不可启用（422）。
 * 旧重建任务携带旧 ruleset 目标，runRebuildJob 会判 superseded，不覆盖新配置。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { fail, ok, serviceFailure, internalFailure, guardWrite } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { writeAudit } from "@/services/audit";
import { ALWAYS_DISABLED, DEFAULT_RULE_PARAMS, RULE_EXTRA_THRESHOLD_KEYS, RULE_VERSION } from "@/services/alerts/engine";
import { canonicalEvaluationAt, requestRebuild } from "@/services/snapshot";

export const runtime = "nodejs";

const RULE_IDS = new Set(Object.keys(DEFAULT_RULE_PARAMS));

const PatchSchema = z
  .object({
    store_id: z.string().min(1),
    thresholds: z.record(z.string(), z.number().finite()).optional(),
    enabled: z.boolean().optional(),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();

/** rules-v1 → rules-v2；非标准名尾部数字递增；超长截断（列宽80） */
function nextRulesetVersion(cur: string): string {
  const m = /^rules-v(\d+)$/.exec(cur);
  let next: string;
  if (m) next = `rules-v${Number(m[1]) + 1}`;
  else {
    const tail = /-(\d+)$/.exec(cur);
    next = tail ? `${cur.slice(0, tail.index)}-${Number(tail[1]) + 1}` : `${cur}-2`;
  }
  return next.length > 80 ? next.slice(0, 80) : next;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ rule_id: string }> },
) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, { capability: CAPABILITIES.manageSettings });

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    const body = PatchSchema.parse(parsed);
    const { rule_id: ruleId } = await params;
    if (!RULE_IDS.has(ruleId)) return fail(404, "规则不存在", { code: "NOT_FOUND" });

    // P1 数据源未接入：不开放启用（07 R04/R06；阈值可预留）
    if (ALWAYS_DISABLED.has(ruleId) && body.enabled === true) {
      return fail(422, "P1 规则未接入数据源，不可启用", { code: "VALIDATION_ERROR" });
    }

    // 阈值键白名单（默认参数键 ∪ R05/R12 金额/目标扩展键）
    const allowedKeys = new Set([...Object.keys(DEFAULT_RULE_PARAMS[ruleId] ?? {}), ...(RULE_EXTRA_THRESHOLD_KEYS[ruleId] ?? [])]);
    const badKeys = Object.keys(body.thresholds ?? {}).filter((k) => !allowedKeys.has(k));
    if (badKeys.length > 0) {
      return fail(422, "不支持的阈值项", { code: "VALIDATION_ERROR", fieldErrors: Object.fromEntries(badKeys.map((k) => ["thresholds", `未知阈值 ${k}`])) });
    }
    if (body.thresholds === undefined && body.enabled === undefined) {
      return fail(422, "没有任何变更", { code: "VALIDATION_ERROR" });
    }

    const db = getPrismaClient();
    const store = await db.store.findFirst({ where: { orgId: ctx.orgId, id: body.store_id }, select: { id: true, timezone: true, datasetVersion: true, rulesetVersion: true } });
    if (!store) return fail(404, "店铺不存在", { code: "NOT_FOUND" });

    const current = await db.ruleConfig.findFirst({ where: { orgId: ctx.orgId, storeId: store.id, rulesetVersion: store.rulesetVersion, ruleId }, orderBy: { ruleVersion: "desc" } });
    // CAS：expected_version 对当前配置行（未物化时为 0）
    const expectedRowVersion = current?.rowVersion ?? 0;
    if (body.expected_version !== expectedRowVersion) {
      return fail(409, "规则配置已被他人修改，请刷新后重试", { code: "VERSION_CONFLICT" });
    }

    const baseParams: Record<string, unknown> = { ...((DEFAULT_RULE_PARAMS[ruleId] ?? {}) as Record<string, unknown>), ...((current?.parameters ?? {}) as Record<string, unknown>), ...(body.thresholds ?? {}) };    const newEnabled = body.enabled ?? current?.enabled ?? !ALWAYS_DISABLED.has(ruleId);

    const result = await db.$transaction(async (tx) => {
      const fresh = await tx.store.findUniqueOrThrow({ where: { id: store.id }, select: { rulesetVersion: true, datasetVersion: true, timezone: true } });
      if (fresh.rulesetVersion !== store.rulesetVersion) {
        throw Object.assign(new Error("规则集已更新，请刷新后重试"), { status: 409, code: "VERSION_CONFLICT" });
      }
      const nextRuleset = nextRulesetVersion(fresh.rulesetVersion);
      // 其余规则配置保守延续到新 ruleset（F09：无变化重建不重置用户的调参/停用）
      for (const otherId of RULE_IDS) {
        if (otherId === ruleId) continue;
        const latest = await tx.ruleConfig.findFirst({ where: { orgId: ctx.orgId, storeId: store.id, rulesetVersion: fresh.rulesetVersion, ruleId: otherId }, orderBy: { ruleVersion: "desc" } });
        if (!latest) continue;
        await tx.ruleConfig.create({ data: { orgId: ctx.orgId, storeId: store.id, rulesetVersion: nextRuleset, ruleId: otherId, ruleVersion: latest.ruleVersion, enabled: latest.enabled, parameters: latest.parameters as Prisma.InputJsonValue } });
      }
      const created = await tx.ruleConfig.create({
        // T02：config_version（rowVersion）跨修改单调递增——新行继承旧行版本+1，
        // GET 返回最新行 rowVersion，过期版本真实 409
        data: { orgId: ctx.orgId, storeId: store.id, rulesetVersion: nextRuleset, ruleId, ruleVersion: (current?.ruleVersion ?? RULE_VERSION - 1) + 1, enabled: newEnabled, parameters: baseParams as Prisma.InputJsonValue, rowVersion: (current?.rowVersion ?? 0) + 1 },
      });
      await tx.store.update({ where: { id: store.id }, data: { rulesetVersion: nextRuleset } });
      const evaluationAt = canonicalEvaluationAt(fresh.timezone, new Date());
      const rebuild = await requestRebuild({
        db: tx, orgId: ctx.orgId, storeId: store.id,
        datasetVersion: fresh.datasetVersion, rulesetVersion: nextRuleset,
        evaluationAt, requestedBy: ctx.userId,
      });
      await writeAudit(tx, {
        orgId: ctx.orgId, actorUserId: ctx.userId, action: "alert_rule_update", entityType: "rule_config", entityId: created.id,
        beforeSummary: { ruleset_version: store.rulesetVersion, rule_version: current?.ruleVersion ?? null, enabled: current?.enabled ?? null, parameters: current?.parameters ?? null },
        afterSummary: { ruleset_version: nextRuleset, rule_version: created.ruleVersion, enabled: created.enabled, parameters: created.parameters },
      });
      return { ruleset_version: nextRuleset, rule_version: created.ruleVersion, enabled: created.enabled, thresholds: created.parameters, rebuild_job_id: rebuild.id };
    });

    return ok({ rule_id: ruleId, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(422, "请求字段类型或取值不合法", {
        code: "VALIDATION_ERROR",
        fieldErrors: Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message])),
      });
    }
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
