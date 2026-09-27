# Gate03 Review1 独立证据

被审 `85a93ec..8f3f28d`，业务277109d。正式结论以父目录 `CODEX_REVIEW_GATE_03_REVIEW_1_2026-09-27.md` 为准；这里是可复现证据，不是第二份进度。

新归档 `/tmp/aiea-g3r1-20260927-sxfw4c8z/repo`，全新PG17@55483。install/migrate/typecheck/unit/integration/build/e2e 的日志与 JSON 记录真实退出码。Playwright仅调整隔离端口33183；8用例通过不代表Phase3页面已交付。

`g3-independent.test.ts` 使用项目原 imports 集成测试的真实会话/临时数据库初始化，新增18场景；没有改被审业务代码。复制到新冻结归档应用 `tests/integration/g3-independent.test.ts`，使用新PG17的 DATABASE_URL，Node24/Pnpm10与 frozen lockfile；运行：

```sh
pnpm exec vitest run tests/integration/g3-independent.test.ts --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

API→私有文件→真实handleValidateTask→提交API→PG事实查询，唯一时效注入把合成staging生成时间设置为25小时前。全部输入都是合成数据，不含真实客户资料。

`probes.log` 首15例13FAIL/2PASS；H04a因recordCount bigint与number比较而假绿，后改为0n，仅重跑该项及新增H04d，记录 `probes-coverage.log`（2FAIL）。`probes-fields.log` 是新增币种与地址两例（2FAIL）。有效去重为18场景，正常对照C01通过，17个反例失败；不把skipped当PASS。JSON原报告全部保留。

探针到正式发现：H01/H01b/H07→G3-H01；H02a/b/c→G3-H02；H03a/b/c→G3-H03；H04a/d→G3-H04；H04c→G3-H05；H05→G3-H06；H06→G3-H07；M01/M01b→G3-H08；H04b→G3-M01。`observations.json` 保留每次实际状态/金额/版本/行数。

原139集成与72单元只跑一次，不把新探针失败混入原自测数字。未新测100000行性能、SIGKILL恢复、Docker生产Worker全链；不得由build成功推定这些通过。真实OSS云边界保持TASK029或更早启用/部署前。

清理与Product OS sync读回见 `final-verification.json`（收尾后写入）；实际交接回执见 `coordination-receipt.json`。候选始终冻结至返修START，Codex不修改主副本业务实现。
