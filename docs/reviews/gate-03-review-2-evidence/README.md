# Gate03 Review2 独立证据

候选 dd975cd（业务6b408cb），差异8f3f28d..dd975cd；最终FAIL见上级15节报告。证据全部来自本次独立git archive和新PG17，不采用执行者数据库或测试结论。

`context.json`/`baseline.json`记录环境；`review-runner.py`记录实际命令并清除代理、注入仅合成测试配置。每项同名json包含命令/cwd/开始时间/真实exit，log是未经改写的stdout+stderr。生产Web E2E配置只变独立端口。临时环境已按cleanup.json删除，复现请新建自己的/tmp副本与PG17，不能直接照旧端口连接他人环境。

复现顺序：从冻结提交归档ai-ecommerce-assistant → 新PG17空库 → offline frozen install、Prisma generate/migrate deploy → tsc/unit/integration/build/E2E → 独立进程运行两个原g3文件 → 把本目录g3-r2-independent.test.ts复制到临时repo/tests/integration后运行。Vitest都用maxWorkers=1/minWorkers=1；不同g3文件不能混成同进程。精确命令见各json。

原g3-contract全18是17PASS/1FAIL(exit1)，仅H04d共享店铺前提导致6n≠2n；保留原件，独立进程选择`-t 'H04a|H04d'`得到2PASS/16skipped，原18逻辑场景有效去重18PASS。g3-h04-contract四独立店铺对照4PASS。不能把skipped算通过或直接将2改6。

补充`g3-r2-independent-first.test.ts`首轮19例11PASS/8FAIL。跨namespace别名预期不属原R1同来源前提，排除本轮缺陷/放行依据并保留观察；改为同来源后PASS。地址首次在commit后读preview409，修正成提交前读preview200。随后仅跑修正两项和新增DST两项（1PASS/3FAIL/17skipped）。最终有效21例=12PASS/9FAIL，逐条来源见supplemental-accounting.json；9场景归根因见报告，不重复计数。

`observations.json`保留两轮G3_EVIDENCE及来源，地址预览有效值取targeted日志。原18及四对照日志、全部失败输出均保留。integration139在加入补充探针前完成，不包含g3独立文件或补充场景。

`script-exit-propagation.json`以PATH中的受控vitest stub执行真实test:g3脚本，第一23/第二0/聚合0，验证退出码传播；23不是真实业务测试码。实际业务退出码见g3-original.json和g3-h04-controls.json。

`r1-integrity.json`证明原R1索引42产物哈希未变；`scope-diff.txt`/`scope-stat.txt`是冻结差异；working-status.txt保留审查前管理现场。索引immutable_artifacts只收固定证据与正式报告；后续coordination-receipt.json/final-verification.json可追加真实交接与读回，不作为历史不可变测试证据。

本次仅合成数据。100000行、SIGKILL、新生产Worker容器、真实OSS云未新验；E2E错误输出保留，不用构建或exit0替代缺失验收。原范围和延期边界以报告/原合同为准。
