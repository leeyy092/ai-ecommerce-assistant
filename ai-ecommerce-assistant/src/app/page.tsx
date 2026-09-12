export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">AI 电商运营助手</h1>
      <p className="max-w-xl text-sm text-neutral-500 dark:text-neutral-400">
        工程已初始化（TASK-001：可启动的应用与验证环境）。
        业务页面将在后续任务中按规格实现，本页不展示任何演示业务数据；
        产品与工程规格见仓库 docs/ai-ecommerce-assistant/。
      </p>
      <a
        className="text-sm underline text-neutral-600 hover:text-neutral-900 dark:text-neutral-300"
        href="/api/health"
      >
        健康检查 GET /api/health
      </a>
    </main>
  );
}
