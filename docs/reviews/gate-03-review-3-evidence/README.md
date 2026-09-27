# Gate03 Review3 独立证据

冻结6539fcb（业务ca5ad76），差异dd975cd..6539fcb。新/tmp git archive、新原生PG17.11@127.0.0.1:57024，生产Web57025；未用Z02数据库。正式结论见上级15节报告：FAIL 1HIGH(H04父订单更正覆盖)、1MEDIUM(H03损坏staging错误语义)。

复现时从冻结提交新建自己的临时副本和PG17。context.json、review-runner.py保存配置和原命令；本轮环境已清理，不能直接连接历史端口。先install/generate/migrate/typecheck/unit/integration，再test:g3三个独立进程；原g3-contract.test.ts保持原SHA。test:g3原运行17/18+4/4+21/21，聚合1，唯一H04d共享店铺前提无效；原件仅-t H04d独立进程1PASS/17skipped，原18去重有效全过，不把跳过计通过。

将g3r3-independent.test.ts复制至临时repo/tests/integration，单独进程运行：4有效场景1PASS/3FAIL。H03截断JSON与null返回503/retryable true但零副作用；完整过期manifest返回409 IMPORT_PREVIEW_STALE；H04父头expected1→2后，当前行数1、店铺版本4，最新行覆盖仍complete/version3。observations.json保留全部前后值与每个来源日志。

script-exit-propagation.json执行真实package脚本，受控vitest stub模拟前/中/后失败及全成功，分别1/1/1/0。23仅是控制实验退出码，不是业务套件退出码。

第一轮env-invalid-*日志是审查runner相对TMPDIR造成的环境失败，完整保留，不作产品结论；harness-correction.json说明修正。有效unit72/integration139均exit0，integration先于新增R3探针，不包含R3。build/E2E8通过，原始输出保留。prior-integrity.json核对R1 42件/R2 57件历史哈希不变。

每个同名json记录真实命令/cwd/时间/退出码，log为原始输出。cleanup.json记录本轮PG停止、临时根移除与端口关闭；Z02环境未动。100000行/SIGKILL/新生产Worker容器/真实OSS云不作本轮通过，原延期边界不变。coordination-receipt.json与final-verification.json是可追加管理记录，其余由索引固定哈希。
