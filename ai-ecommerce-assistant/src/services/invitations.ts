/**
 * 受控邀请服务（TASK-003；Gate-01 H06/H07 修复版）。
 * 单次使用、48 小时有效、只存 token 哈希；接受路径：
 *   输入完整校验（写库前）→ 孤儿 Auth 身份安全回收 → 框架建 Auth 身份（事务外）
 *   → 单一事务（token CAS 消费 + 领域 User + Membership + Audit）
 *   → 事务失败补偿删除 Auth 身份，邀请回到 pending，可安全重试。
 */
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { writeAudit } from "@/services/audit";
import { maskEmail } from "@/lib/email";

const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export type Role = "owner" | "admin" | "operator" | "customer_service";

/** 各角色可邀请的角色范围（02 权限矩阵） */
const INVITABLE: Record<Role, Role[]> = {
  owner: ["admin", "operator", "customer_service"],
  admin: ["operator", "customer_service"],
  operator: [],
  customer_service: [],
};

export class InvitationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface InviterContext {
  db: PrismaClient;
  orgId: string;
  userId: string;
  role: Role;
}

export async function createInvitation(
  ctx: InviterContext,
  input: { email: string; role: Role; baseUrl: string },
): Promise<{ id: string; url: string; expiresAt: Date }> {
  if (!INVITABLE[ctx.role].includes(input.role)) {
    throw new InvitationError(403, "FORBIDDEN", "当前角色不能邀请该角色");
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InvitationError(422, "VALIDATION_ERROR", "邮箱格式不正确");
  }

  const existingMember = await ctx.db.membership.findFirst({
    where: { orgId: ctx.orgId, user: { email } },
  });
  if (existingMember) {
    throw new InvitationError(409, "IMPORT_CONFLICT", "该邮箱已是组织成员");
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // H07：邀请创建与审计同一事务
  const invitation = await ctx.db.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: {
        orgId: ctx.orgId,
        email,
        role: input.role,
        tokenHash: sha256(token),
        expiresAt,
        invitedBy: ctx.userId,
      },
    });
    await writeAudit(tx, {
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "invite_create",
      entityType: "invitation",
      entityId: created.id,
      afterSummary: { email: maskEmail(email), role: input.role, expiresAt: expiresAt.toISOString() },
    });
    return created;
  });

  return { id: invitation.id, url: `${input.baseUrl}/invite/${token}`, expiresAt };
}

export async function listInvitations(
  ctx: InviterContext,
  filter: { status?: "pending" | "expired" | "revoked" } = {},
) {
  return ctx.db.invitation.findMany({
    where: { orgId: ctx.orgId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function revokeInvitation(
  ctx: InviterContext,
  id: string,
  expectedVersion: number,
): Promise<void> {
  const invitation = await ctx.db.invitation.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!invitation) throw new InvitationError(404, "NOT_FOUND", "邀请不存在");
  if (invitation.status === "accepted") {
    throw new InvitationError(409, "IMPORT_CONFLICT", "邀请已被接受，不能撤销");
  }
  if (invitation.role === "owner" || !INVITABLE[ctx.role].includes(invitation.role)) {
    throw new InvitationError(403, "FORBIDDEN", "不能撤销该角色的邀请");
  }

  // H07：CAS 撤销与审计同一事务
  const updated = await ctx.db.$transaction(async (tx) => {
    const result = await tx.invitation.updateMany({
      where: { id, orgId: ctx.orgId, status: invitation.status, rowVersion: expectedVersion },
      data: { status: "revoked", rowVersion: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new InvitationError(409, "VERSION_CONFLICT", "邀请状态已变化，请刷新后重试");
    }
    await writeAudit(tx, {
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "invite_revoke",
      entityType: "invitation",
      entityId: id,
    });
    return result;
  });
  void updated;
}

/** 公开 token 预览：无内部数据；过期实时返回 410（并顺手把过期状态落库）。
 *  返回的 email 仅供服务端一致性判断，公开 API 必须只返回 maskedEmail。 */
export async function previewInvitationByToken(
  db: PrismaClient,
  token: string,
): Promise<{
  orgName: string;
  email: string;
  maskedEmail: string;
  expiresAt: string;
  role: Role;
}> {
  const invitation = await db.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!invitation) throw new InvitationError(404, "NOT_FOUND", "邀请不存在");

  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= Date.now()) {
    await db.invitation.updateMany({
      where: { id: invitation.id, status: "pending" },
      data: { status: "expired", rowVersion: { increment: 1 } },
    });
    throw new InvitationError(410, "INVITATION_EXPIRED", "邀请已过期，请联系管理员重新发起");
  }
  if (invitation.status !== "pending") {
    const code = invitation.status === "expired" ? "INVITATION_EXPIRED" : "INVITATION_USED";
    const status = invitation.status === "expired" ? 410 : 409;
    throw new InvitationError(
      status,
      code,
      invitation.status === "revoked" ? "邀请已被撤销" : "邀请已失效",
    );
  }

  const org = await db.organization.findUnique({ where: { id: invitation.orgId } });
  return {
    orgName: org?.name ?? "",
    email: invitation.email,
    maskedEmail: maskEmail(invitation.email),
    expiresAt: invitation.expiresAt.toISOString(),
    role: invitation.role,
  };
}

export interface AcceptInput {
  token: string;
  displayName?: string;
  password?: string;
  /** 已登录用户接受时提供 */
  sessionUser?: { id: string; email: string };
  /** 框架创建 Auth 身份（库哈希）；返回 Set-Cookie 由路由层转发（H05） */
  signUpNewUser?: (email: string, password: string, name: string) => Promise<{ authUserId: string }>;
  /** 仅测试用故障注入点：Auth 身份创建后、领域事务前抛错（H06） */
  testHookAfterAuth?: () => Promise<void>;
}

/** 删除孤儿认证身份（无领域 User）；AuthSession/AuthAccount 经库级联清除 */
async function purgeOrphanAuthIdentity(db: PrismaClient, authUserId: string): Promise<void> {
  await db.authUser.delete({ where: { id: authUserId } }).catch(() => {});
}

/** 接受邀请：单一事务 + PG 事务级咨询锁（按受邀邮箱与邀请记录双键）串行化；
 *  并发两次仅一次成功（后到者在锁内看到已消费 → 409，且从未创建 Auth 身份）；
 *  失败可恢复：输入先校验、孤儿 Auth 身份安全回收、领域事务失败补偿删除 Auth 身份。
 *  注意：signUpNewUser（框架、独立连接）在事务回调内执行，其写入不随本事务回滚，
 *  由 catch 分支补偿删除；这是 H06 的明确补偿策略。 */
export async function acceptInvitation(db: PrismaClient, input: AcceptInput): Promise<void> {
  const tokenHash = sha256(input.token);

  // 快速失败预检（权威判定在锁内重读）
  const peek = await db.invitation.findUnique({ where: { tokenHash } });
  if (!peek) throw new InvitationError(404, "NOT_FOUND", "邀请不存在");
  if (peek.status === "pending" && peek.expiresAt.getTime() <= Date.now()) {
    await db.invitation.updateMany({
      where: { id: peek.id, status: "pending" },
      data: { status: "expired", rowVersion: { increment: 1 } },
    });
    throw new InvitationError(410, "INVITATION_EXPIRED", "邀请已过期");
  }
  if (peek.status !== "pending") {
    throw new InvitationError(409, "INVITATION_USED", "邀请已被使用或撤销");
  }
  if (input.sessionUser && input.sessionUser.email.toLowerCase() !== peek.email) {
    throw new InvitationError(403, "FORBIDDEN", "当前登录邮箱与受邀邮箱不一致");
  }

  let createdAuthUserId: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      // 事务级咨询锁：同邮箱/同邀请的并发接受完全串行（void IS NULL 仅为可反序列化）
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite-email:${peek.email}`})) IS NULL AS ok`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite-id:${peek.id}`})) IS NULL AS ok`;

      // 锁内权威重读
      const invitation = await tx.invitation.findUniqueOrThrow({ where: { tokenHash } });
      if (invitation.status !== "pending") {
        throw new InvitationError(409, "INVITATION_USED", "邀请已被使用");
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        throw new InvitationError(410, "INVITATION_EXPIRED", "邀请已过期");
      }

      let authUserId: string;
      if (input.sessionUser) {
        authUserId = (await tx.user.findUniqueOrThrow({ where: { id: input.sessionUser!.id } }))
          .authUserId;
      } else {
        // H06：写库前完整校验输入
        const name = input.displayName?.trim() ?? "";
        if (name.length < 1 || name.length > 80) {
          throw new InvitationError(422, "VALIDATION_ERROR", "姓名长度须为 1–80 个字符");
        }
        if (!input.password || input.password.length < 8) {
          throw new InvitationError(422, "VALIDATION_ERROR", "密码至少 8 位");
        }

        // H06：孤儿 Auth 身份（有 Auth 无领域）安全回收后重建，保证可重试
        const existingAuth = await tx.authUser.findUnique({ where: { email: invitation.email } });
        if (existingAuth) {
          const hasDomain = await tx.user.findUnique({ where: { authUserId: existingAuth.id } });
          if (hasDomain) {
            throw new InvitationError(
              409,
              "IMPORT_CONFLICT",
              "该邮箱已存在账号，请直接登录后接受邀请",
            );
          }
          await purgeOrphanAuthIdentity(db, existingAuth.id);
        }

        if (!input.signUpNewUser) {
          throw new InvitationError(500, "INTERNAL_ERROR", "缺少新用户注册通道");
        }
        try {
          const created = await input.signUpNewUser(invitation.email, input.password, name);
          authUserId = created.authUserId;
          createdAuthUserId = authUserId;
        } catch {
          throw new InvitationError(
            409,
            "IMPORT_CONFLICT",
            "该邮箱已存在账号，请直接登录后接受邀请",
          );
        }

        if (input.testHookAfterAuth) {
          await input.testHookAfterAuth();
        }
      }

      // H06/H07：token CAS 消费 + 领域 User + Membership + Audit 同一事务
      const consumed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: "pending" },
        data: {
          status: "accepted",
          acceptedBy: input.sessionUser?.id ?? null,
          rowVersion: { increment: 1 },
        },
      });
      if (consumed.count !== 1) {
        throw new InvitationError(409, "INVITATION_USED", "邀请已被使用");
      }

      const domainUser = input.sessionUser
        ? await tx.user.findUniqueOrThrow({ where: { id: input.sessionUser!.id } })
        : await tx.user.create({
            data: {
              id: crypto.randomUUID(),
              authUserId,
              email: invitation.email,
              displayName: input.displayName?.trim() || invitation.email.split("@")[0],
            },
          });
      await tx.membership.create({
        data: { orgId: invitation.orgId, userId: domainUser.id, role: invitation.role },
      });
      await writeAudit(tx, {
        orgId: invitation.orgId,
        actorUserId: domainUser.id,
        action: "invite_accept",
        entityType: "invitation",
        entityId: invitation.id,
        afterSummary: { role: invitation.role },
      });
    });
  } catch (error) {
    if (createdAuthUserId) {
      // H06 补偿：领域事务失败 → 删除本次创建的 Auth 身份；邀请随事务回滚仍 pending，可重试
      await purgeOrphanAuthIdentity(db, createdAuthUserId).catch(() => {});
    }
    throw error;
  }
}
