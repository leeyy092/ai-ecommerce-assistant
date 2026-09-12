/**
 * 审计写入（TASK-003）：只存操作者/组织/动作/目标与脱敏摘要，不存密码、客户原文或密钥。
 */
import type { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";

export interface AuditEntry {
  orgId: string;
  storeId?: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "system";
  action: string;
  entityType: string;
  entityId: string;
  beforeSummary?: Record<string, unknown> | null;
  afterSummary?: Record<string, unknown> | null;
  requestId?: string;
}

export async function writeAudit(db: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      id: randomUUID(),
      orgId: entry.orgId,
      storeId: entry.storeId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType ?? (entry.actorUserId ? "user" : "system"),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeSummary:
        entry.beforeSummary === null || entry.beforeSummary === undefined
          ? undefined
          : (JSON.parse(JSON.stringify(entry.beforeSummary)) as Prisma.InputJsonValue),
      afterSummary:
        entry.afterSummary === null || entry.afterSummary === undefined
          ? undefined
          : (JSON.parse(JSON.stringify(entry.afterSummary)) as Prisma.InputJsonValue),
      requestId: entry.requestId ?? randomUUID(),
    },
  });
}
