/**
 * 初始 Owner 初始化（TASK-003；Gate-01 正式复核 H06 修复版）。
 * 密码只经隐藏输入/受限文件传入；与邀请共用邮箱协调锁（identity-email:<email>）；
 * 幂等返回前核实完整身份链，断链时以本次密码重建认证身份（owner_init_recovered）。
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { writeAudit } from "@/services/audit";

export class OwnerInitError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface InitOwnerInput {
  orgName: string;
  email: string;
  displayName: string;
  demoMode: boolean;
  password: string;
  /** 仅测试用故障注入点：Auth 身份创建后、领域事务前抛错（H06 同型） */
  testHookAfterAuth?: () => Promise<void>;
}

/** 桥接 better-auth 创建 Auth 身份（库负责密码哈希）；由脚本/路由层注入 */
export type SignUpFn = (
  email: string,
  password: string,
  name: string,
) => Promise<{ authUserId: string }>;

export interface InitOwnerResult {
  orgId: string;
  userId: string;
  alreadyInitialized: boolean;
  /** 身份链断裂后以本次密码重建（alreadyInitialized=true 且 recovered=true） */
  recovered?: boolean;
}

/** 删除孤儿认证身份（无领域 User）；Session/Account 经库级联清除 */
async function purgeOrphanAuthIdentity(db: PrismaClient, authUserId: string): Promise<void> {
  await db.authUser.delete({ where: { id: authUserId } }).catch(() => {});
}

export async function initOwner(
  db: PrismaClient,
  input: InitOwnerInput,
  signUp: SignUpFn,
): Promise<InitOwnerResult> {
  const email = input.email.trim().toLowerCase();
  if (!input.orgName.trim()) throw new OwnerInitError(422, "VALIDATION_ERROR", "组织名不能为空");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OwnerInitError(422, "VALIDATION_ERROR", "邮箱格式不正确");
  }
  if (!input.displayName?.trim() || input.displayName.trim().length > 80) {
    throw new OwnerInitError(422, "VALIDATION_ERROR", "显示名长度须为 1–80 个字符");
  }
  if (!input.password || input.password.length < 8) {
    throw new OwnerInitError(422, "VALIDATION_ERROR", "密码至少 8 位");
  }

  let createdAuthUserId: string | null = null;
  try {
    return await db.$transaction(async (tx) => {
      // H06：与邀请一致的邮箱协调锁（事务级，自动释放）
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity-email:${email}`})) IS NULL AS ok`;

      const existing = await tx.user.findUnique({ where: { email } });

      if (existing) {
        const ownerMembership = await tx.membership.findFirst({
          where: { userId: existing.id, role: "owner" },
        });
        if (!ownerMembership) {
          throw new OwnerInitError(
            409,
            "IMPORT_CONFLICT",
            "该邮箱已是其他身份（非 Owner），不能凭初始化接管",
          );
        }
        // H06：幂等返回前核实完整身份链
        const authAlive = await tx.authUser.findUnique({
          where: { id: existing.authUserId },
        });
        if (authAlive) {
          return { orgId: ownerMembership.orgId, userId: existing.id, alreadyInitialized: true };
        }
        // 链断裂：以本次密码重建认证身份并回接（可真实登录）
        const rebuilt = await signUp(email, input.password, input.displayName.trim());
        createdAuthUserId = rebuilt.authUserId;
        await tx.user.update({
          where: { id: existing.id },
          data: { authUserId: rebuilt.authUserId },
        });
        await writeAudit(tx, {
          orgId: ownerMembership.orgId,
          actorUserId: existing.id,
          action: "owner_init_recovered",
          entityType: "user",
          entityId: existing.id,
          afterSummary: { reason: "broken_auth_chain_rebuilt" },
        });
        return {
          orgId: ownerMembership.orgId,
          userId: existing.id,
          alreadyInitialized: true,
          recovered: true,
        };
      }

      // 历史孤儿认证身份（无领域 User）安全回收后重建
      const orphan = await tx.authUser.findUnique({ where: { email } });
      if (orphan) {
        await purgeOrphanAuthIdentity(db, orphan.id);
      }

      const created = await signUp(email, input.password, input.displayName.trim());
      createdAuthUserId = created.authUserId;

      if (input.testHookAfterAuth) {
        await input.testHookAfterAuth();
      }

      const user = await tx.user.create({
        data: {
          id: crypto.randomUUID(),
          authUserId: created.authUserId,
          email,
          displayName: input.displayName.trim(),
        },
      });
      const org = await tx.organization.create({
        data: {
          id: crypto.randomUUID(),
          name: input.orgName.trim(),
          ownerUserId: user.id,
          demoMode: input.demoMode,
        },
      });
      await tx.membership.create({
        data: { orgId: org.id, userId: user.id, role: "owner" },
      });
      await writeAudit(tx, {
        orgId: org.id,
        actorUserId: user.id,
        action: "owner_init",
        entityType: "organization",
        entityId: org.id,
        afterSummary: { demoMode: input.demoMode },
      });
      return { orgId: org.id, userId: user.id, alreadyInitialized: false };
    });
  } catch (error) {
    if (createdAuthUserId) {
      await purgeOrphanAuthIdentity(db, createdAuthUserId).catch(() => {});
    }
    throw error;
  }
}

/**
 * Owner/成员密码的一次性重置（部署管理员核验身份后执行；撤销全部旧会话）。
 * passwordHash 由调用方用 better-auth 的哈希函数生成，本服务不接触明文。
 */
export async function resetUserPassword(
  db: PrismaClient,
  email: string,
  passwordHash: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } });
  if (!user) throw new OwnerInitError(404, "NOT_FOUND", "用户不存在");

  await db.$transaction(async (tx) => {
    await tx.authAccount.updateMany({
      where: { userId: user.authUserId, providerId: "credential" },
      data: { password: passwordHash },
    });
    await tx.authSession.deleteMany({ where: { userId: user.authUserId } });
    await writeAudit(tx, {
      orgId: (await tx.membership.findFirst({ where: { userId: user.id } }))?.orgId ?? "",
      actorType: "system",
      action: "password_reset",
      entityType: "user",
      entityId: user.id,
      afterSummary: { sessionsRevoked: true },
    });
  });
}
