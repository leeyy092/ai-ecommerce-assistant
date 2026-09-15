import { LoginForm } from "./LoginForm";

export const metadata = { title: "登录 · AI 电商运营助手" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">AI 电商运营助手</h1>
      <LoginForm />
    </main>
  );
}
