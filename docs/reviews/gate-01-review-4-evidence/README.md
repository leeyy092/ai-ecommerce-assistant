# Gate 01 REVIEW_4 独立复验证据

审查版本：`858c20ab9645b494840b219f0b39b01c39023291`；修复差异 `9a5798c..858c20a`；Phase 1 / TASK-001–004。这里是本轮Codex实际执行的证据，不是ZCode自测报告，也不是唯一进度源。

正式结论：[15节报告](../CODEX_REVIEW_GATE_01_REVIEW_4_2026-09-14.md)。机器索引：[GATE_01_REVIEW_4_EVIDENCE_2026-09-14.json](../GATE_01_REVIEW_4_EVIDENCE_2026-09-14.json)。当前BLOCKED，H08/H11已通过，新增H12；剩余M03/M04/M06/M07。

## 证据导航

| 内容 | 文件 |
|---|---|
| Git版本、原文件校验与历史保留 | remote-refs.txt、snapshot.json、source-check-before-write.json、final-verification.json |
| 安装/生成、类型、Unit18、构建、E2E8 | install.log、typecheck.log、unit.log、build.log、e2e.log、checks.jsonl |
| Integration60与H11旁观事务 | integration.log、integration-isolation.json、scripts/review-integration.mjs |
| H08两个并发方向、实际锁等待、删除 | db-probes.json/H08_*、scripts/review-db.ts |
| M04遗漏领域表与非UUID JobRun写入 | db-probes.json/M04_* |
| M06首次/重复upTo、官方兼容 | db-probes.json/M06_*、helper-deploy.log、cli-extra.json |
| M07实际模型差异 | schema-diff.log（只生成，未执行DROP SQL） |
| 真实HTTP、D01、角色、撤权、回滚、M01/M02/M03 | http-probes.json、http-probes.log、scripts/review-http.ts、web.log |
| **H12非UTC反例与UTC对照** | **timezone-probe.json、timezone-utc-control.json、scripts/review-timezone.ts、adapter-timestamp-excerpt.txt** |
| 官方空库8迁移、四→八、七→八、重复及坏行拒绝 | migrate.log、upgrade-results.json、previous-upgrade.json、real-upgrade-*.log、previous-*.log |
| 真实Docker纯Git上下文构建 | docker-build.log、docker-build-result.json |
| 默认/特殊字符口令两条容器闭环 | container-results.json、container-default-*.log、container-special-*.log、scripts/container.py、compose-review.yaml |
| Worker生命周期、缺配置、健康降级 | runtime.json、worker.log、missing-*.log、health-cleanup.json、pg-stop.log |
| Secrets扫描与归档边界 | secrets.json、archive-safety.json |
| 环境清理与Product OS | environment-before.json、environment-cleanup.json、docker-images-cleanup.log、colima-stop.log、product-os-sync.log、final-verification.json |

## 可复现的关键实验

- **H08：**用两个真实PG连接分别重现“父行更新挂起→插旧组织审计”和“插审计挂起→改父行”；第三连接查询pg_stat_activity实际确认Lock等待，然后提交阻塞方。后者被拒，最终跨域计数0；没有关闭触发器。
- **H11：**在独立集群另建旁观库，保持一个BEGIN/INSERT事务跨越完整60例集成测试。将临时应用.env的DATABASE_URL故意改为不可达端口1，同时进程注入正确隔离集群地址；全套通过，旁观连接PID不变、COMMIT成功、独立连接可读到行、测试库无遗留。之后恢复临时.env。
- **H12：**新PG集群默认TimeZone=Asia/Shanghai；经正式HTTP创建邀请并对照响应epoch与原始pg读取epoch。再将合成邀请置于明确合法历史场景：49小时前创建、48小时TTL、1小时前过期。当前ORM读出的时刻比真实epoch多8小时，预览/接受/me均200。第二个Web进程与探测客户端只增加连接参数`options=-c timezone=UTC`，同一代码下epoch相等、过期预览410、后续接受409、无会话。409来自预览把状态改为expired；不能将其误读为仍成功接受。没有修改原应用，也没有对真实历史数据做时间平移。
- **M03：**对临时auth_rate_limit增加拒绝invite键的CHECK以模拟DB失败，预览/接受均500非JSON；随后移除约束。审计故障回滚与统一request_id另有通过证据。
- **M04：**枚举数据库主键表及UUID约束，17/28领域表已约束，11张遗漏；辅助AuthRateLimit另列。以当前Prisma成功插入非UUID的JobRun ID验证，不只是搜索注释。
- **M06：**对空库首次upTo第4迁移，再重复相同调用；第二次错误地执行第5–8份。另在辅助器全量生成的库上执行官方CLI，No pending、exit0，说明缺官方列的旧问题已修。
- **M07：**对已成功迁移的临时库运行官方migrate diff，得到删除fk_audit_log_store_same_domain的SQL。该SQL只归档，没有执行。

## 环境和复现准备

所有实验仅使用独立可丢弃集群和纯Git临时副本：Node24.21.0、pnpm10.34.5、Prisma7.10.0、PostgreSQL17.11；本次PG端口55470，Web3000，UTC对照Web3002。Docker项目aiea-r4-codex-858c20a，回环3301/55480，默认和特殊字符密码各使用新数据卷。

脚本原样归档在scripts，重跑时须重新准备它们约定的目录：父目录含repo/ai-ecommerce-assistant、old/ai-ecommerce-assistant（c87a141）、clean-context/ai-ecommerce-assistant、evidence、root.txt及临时env.json。Node探测脚本放在应用临时副本根，以当前锁定依赖运行。env.json仅含测试DATABASE_URL、随机BETTER_AUTH_SECRET/E2E_OWNER_PASSWORD及对应BETTER_AUTH_URL；不复用原开发库、账号、Cookie或密钥。旧归档通过临时node_modules链接解析已锁定CLI依赖。

本次Docker上下文只包含git archive跟踪文件，无宿主node_modules/生成客户端；使用本机legacy builder，允许标准层缓存，未声称no-cache。默认与含URL保留字符随机密码均完成up、8迁移、init-owner、真实Cookie登录/me、公开注册403×2、Worker检查、down --volumes。密码只在运行时传入，未归档。

## 结果边界

E2E首次8/8，保留aborted/ECONNRESET和颜色变量警告。旧版本CLI第一次缺prisma/config模块属于审查副本依赖准备错误，见upgrade-review-setup-error.log；补临时依赖解析后真实重跑完成，没有修改历史迁移。原ZCode的iCloud根因分析本轮未独立重复验证。

R3子进程退出证据继续保留，本轮H06做现有恢复回归及真实HTTP并发，未重新执行整套进程退出实验。没有运行后续CSV/Job/AI业务功能、真实企业数据或生产负载；没有Owner放行、提交、推送、合并或线上部署。

SHA256SUMS.json记录本目录最终文件哈希，清单自身除外；原始.env、临时凭据、Cookie和数据库数据不归档。最终清理与视图读回以final-verification.json为准。
