/**
 * 受控邀请服务（TASK-003；02_USER_ROLES + 08 §17.2）。
 * 单次使用、48 小时有效、只存 token 哈希；接受用 CAS 原子消费（并发仅一次成功）。
 * 邀请链接仅生成不发送；公开 token 预览只返回组织名、遮罩邮箱与到期时间。
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

  const invitation = await ctx.db.invitation.create({
    data: {
      orgId: ctx.orgId,
      email,
      role: input.role,
      tokenHash: sha256(token),
      expiresAt,
      invitedBy: ctx.userId,
    },
  });

  await writeAudit(ctx.db, {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "invite_create",
    entityType: "invitation",
    entityId: invitation.id,
    afterSummary: { email: maskEmail(email), role: input.role, expiresAt: expiresAt.toISOString() },
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

  const updated = await ctx.db.invitation.updateMany({
    where: { id, orgId: ctx.orgId, status: invitation.status, rowVersion: expectedVersion },
    data: { status: "revoked", rowVersion: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new InvitationError(409, "VERSION_CONFLICT", "邀请状态已变化，请刷新后重试");
  }

  await writeAudit(ctx.db, {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "invite_revoke",
    entityType: "invitation",
    entityId: id,
  });
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
  /** 新用户创建 Auth 身份的回调（由路由层桥接 better-auth，避免服务层耦合其类型） */
  signUpNewUser?: (email: string, password: string, name: string) => Promise<{ authUserId: string }>;
}

/** 接受邀请：CAS 原子消费 token；并发两次仅一次成功（验收标准） */
export async function acceptInvitation(db: PrismaClient, input: AcceptInput): Promise<void> {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: sha256(input.token) },
  });
  if (!invitation) throw new InvitationError(404, "NOT_FOUND", "邀请不存在");

  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= Date.now()) {
    await db.invitation.updateMany({
      where: { id: invitation.id, status: "pending" },
      data: { status: "expired", rowVersion: { increment: 1 } },
    });
    throw new InvitationError(410, "INVITATION_EXPIRED", "邀请已过期");
  }
  if (invitation.status !== "pending") {
    throw new InvitationError(409, "INVITATION_USED", "邀请已被使用或撤销");
  }

  // 邮箱一致性：已登录用户必须与受邀邮箱一致，且不能凭邀请接管已有身份
  if (input.sessionUser) {
    if (input.sessionUser.email.toLowerCase() !== invitation.email) {
      throw new InvitationError(403, "FORBIDDEN", "当前登录邮箱与受邀邮箱不一致");
    }
  }

  // 新用户：先创建 Auth 身份（库负责密码哈希），失败则不消费 token
  let authUserId: string;
  if (!input.sessionUser) {
    if (!input.displayName?.trim() || !input.password) {
      throw new InvitationError(422, "VALIDATION_ERROR", "新用户需提供姓名与密码");
    }
    if (!input.signUpNewUser) {
      throw new InvitationError(500, "INTERNAL_ERROR", "缺少新用户注册通道");
    }
    try {
      const created = await input.signUpNewUser(
        invitation.email,
        input.password,
        input.displayName.trim(),
      );
      authUserId = created.authUserId;
    } catch {
      throw new InvitationError(409, "IMPORT_CONFLICT", "该邮箱已存在账号，请直接登录后接受邀请");
    }
  } else {
    authUserId = (await db.user.findUniqueOrThrow({ where: { id: input.sessionUser.id } }))
      .authUserId;
  }

  // CAS：仅当仍为 pending 时消费；并发第二次到此 count=0 → 409
  const consumed = await db.invitation.updateMany({
    where: { id: invitation.id, status: "pending" },
    data: { status: "accepted", acceptedBy: input.sessionUser?.id ?? null, rowVersion: { increment: 1 } },
  });
  if (consumed.count !== 1) {
    throw new InvitationError(409, "INVITATION_USED", "邀请已被使用");
  }

  try {
    await db.$transaction(async (tx) => {
      const domainUser = input.sessionUser
        ? await tx.user.findUniqueOrThrow({ where: { id: input.sessionUser.id } })
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
    // 领域写入失败时回滚 token 消费状态，允许重试
    await db.invitation.updateMany({
      where: { id: invitation.id, status: "accepted" },
      data: { status: "pending", acceptedBy: null, rowVersion: { increment: 1 } },
    });
    throw error;
  }
}
