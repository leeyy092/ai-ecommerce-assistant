import { headers } from "next/headers";
import { getPrismaClient } from "@/database/prisma";
import { getSessionContext } from "@/lib/session";
import { previewInvitationByToken, InvitationError } from "@/services/invitations";
import { AcceptForm } from "./AcceptForm";

export const metadata = { title: "接受邀请 · AI 电商运营助手" };

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  operator: "运营",
  customer_service: "客服",
  owner: "所有者",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = getPrismaClient();

  let preview: Awaited<ReturnType<typeof previewInvitationByToken>> | null = null;
  let failure: string | null = null;
  try {
    preview = await previewInvitationByToken(db, token);
  } catch (error) {
    failure =
      error instanceof InvitationError ? error.message : "邀请信息读取失败，请稍后重试";
  }

  const session = preview
    ? await getSessionContext(new Request("http://local", { headers: await headers() }))
    : null;
  const emailMatches =
    !!session && !!preview && session.user.email.toLowerCase() === preview.email;
  const emailMismatch = !!session && !!preview && !emailMatches;
  const needsAccount = !session;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">加入组织</h1>
      {failure ? (
        <div
          className="max-w-sm rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          <p>{failure}</p>
          <p className="mt-2 text-xs">如需重新加入，请联系组织管理员重新发送邀请。</p>
        </div>
      ) : preview ? (
        <>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            组织「{preview.orgName}」邀请 <strong>{preview.maskedEmail}</strong>{" "}
            以「{ROLE_LABEL[preview.role] ?? preview.role}」身份加入。
          </p>
          <p className="text-xs text-neutral-500">
            邀请将于 {new Date(preview.expiresAt).toLocaleString("zh-CN")} 到期，单次有效。
          </p>
          {emailMismatch ? (
            <p
              className="max-w-sm rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
              role="alert"
            >
              当前登录邮箱与受邀邮箱不一致。请先退出登录，再用受邀邮箱注册/登录后接受。
            </p>
          ) : (
            <AcceptForm
              token={token}
              needsAccount={needsAccount}
              initialName={session?.user.displayName ?? ""}
            />
          )}
        </>
      ) : null}
    </main>
  );
}
