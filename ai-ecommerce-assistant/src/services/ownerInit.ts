/**
 * 初始 Owner 初始化（TASK-003；02_USER_ROLES + 08 §17.2）。
 * 输入组织名、Owner 邮箱/显示名与 demo 标记；密码只经隐藏输入/受限文件传入，禁止命令行明文。
 * 幂等：重复执行校验并返回既有身份，不重设密码、不建第二个 Owner、不凭邮箱接管已有账号。
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
}

/** 桥接 better-auth 创建 Auth 身份（库负责密码哈希）；由脚本/路由层注入 */
export type SignUpFn = (email: string, password: string, name: string) => Promise<{ authUserId: string }>;

export interface InitOwnerResult {
  orgId: string;
  userId: string;
  alreadyInitialized: boolean;
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

  const existingDomainUser = await db.user.findUnique({ where: { email } });
  if (existingDomainUser) {
    const ownerMembership = await db.membership.findFirst({
      where: { userId: existingDomainUser.id, role: "owner" },
    });
    if (ownerMembership) {
      // 幂等重跑：返回既有身份，不校验/不重设密码
      return {
        orgId: ownerMembership.orgId,
        userId: existingDomainUser.id,
        alreadyInitialized: true,
      };
    }
    throw new OwnerInitError(
      409,
      "IMPORT_CONFLICT",
      "该邮箱已是其他身份（非 Owner），不能凭初始化接管",
    );
  }

  const existingAuthUser = await db.authUser.findUnique({ where: { email } });
  if (existingAuthUser) {
    throw new OwnerInitError(
      409,
      "IMPORT_CONFLICT",
      "该邮箱已存在认证账号但无领域身份，需人工核验处理",
    );
  }

  const created = await signUp(email, input.password, input.displayName.trim());

  const result = await db.$transaction(async (tx) => {
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
    return { orgId: org.id, userId: user.id };
  });

  return { ...result, alreadyInitialized: false };
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
