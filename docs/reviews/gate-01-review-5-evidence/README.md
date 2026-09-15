# Gate 01 REVIEW_5 独立证据

冻结：32fb0d3e8ad19b691cf66006638a418ca949e2a4；差异858c20a..32fb0d3。结论PASS，Owner未放行。正式报告为上级目录CODEX_REVIEW_GATE_01_REVIEW_5_2026-09-14.md，机器索引为GATE_01_REVIEW_5_EVIDENCE_2026-09-14.json。本目录不是进度真源。

| 内容 | 文件 |
|---|---|
| 安装、类型、18单元、构建、8个E2E | checks.jsonl及install/typecheck/unit/build/e2e.log |
| 65集成及H11旁观事务 | integration.log、integration-isolation.json |
| H08实际锁等待/删除、M04/M06 | db-probes.json、db-probes.log、db-catalog.json |
| H12四种时效、多连接、会话过期与M03会话故障 | time-probes.json、time-probes.log、scripts/review-time.ts |
| 真实HTTP授权、D01、审计回滚、限流/输入 | http-probes.json、http-probes.log、web.log |
| 官方空库/重复/8→10/坏行守卫 | migrate.log、cli-results.json、upgrade-*.log、helper-deploy.log |
| M07生成差异与隔离破坏性对照 | schema-diff.log、schema-boundary.json、schema-boundary.log、scripts/review-schema.ts |
| Docker纯Git构建、双口令非UTC完整链路 | docker-build-result.json、docker-build.log、container-results.json、container-*.log |
| 版本/原文件及秘密检查 | remote-refs.txt、snapshot.json、secrets-source.json、archive-safety.json |
| 清理、视图同步与历史保留 | environment-before.json、environment-cleanup.json、health-cleanup.json、product-os-sync.log、final-verification.json |

本轮Node24.21.0、pnpm10.34.5、Prisma7.10.0、pg8.23.0、PG17.11。临时集群端口55471，默认Asia/Shanghai；Web3000；独立UTC默认库用于对照。容器项目aiea-r5-codex-32fb0d3，回环3301/55480，默认和随机特殊字符密码分别使用新卷，数据库均固定Asia/Shanghai。Docker只用git archive内容，无宿主依赖/生成客户端，允许标准层缓存。

H12用原始pg读取epoch作参考，创建响应精确相等；SQL到ORM有小于1ms的精度截断。过期预览后接受409，直接接受410；有效期剩1小时接受200且Cookie有效。额外验证当前会话过期401和三个参数场景各6条并发应用池连接UTC。

M03分别注入限流写失败和临时不可读取会话表，后者在finally恢复原表名；所有操作仅针对可丢弃测试库。当前四类邀请入口和列表错误均为503 JSON，无部分提交。两方向H08通过pg_stat_activity确认Lock，非仅sleep推断。

M07的自动生成SQL**不等价**：除了SET NULL列清单，还改变ON UPDATE行为。仅在一次性aiea_r5_schema_sim数据库应用作为反证，删除报23502/org_id；当前迁移下删除通过、组织字段保留。该模拟没有更改工程迁移、主测试库或开发库。它验证已约定的人工维护边界与行为护栏，不代表当前提交仍有该删除缺陷。

脚本在scripts中原样归档。复现需新建自己的临时父目录，其下repo/ai-ecommerce-assistant与clean-context/ai-ecommerce-assistant为当前Git归档，old/ai-ecommerce-assistant为858c20a；安装锁定依赖并对old建立CLI依赖解析；创建evidence与受限env.json（数据库URL、随机认证秘密与E2E密码）、root.txt。Node脚本放在应用临时副本根运行；通过REVIEW_OUT传结果路径，HTTP脚本另需REVIEW_WEB_LOG，时间脚本在E2E Owner与HTTP回归准备后运行。复现者须改用自己确认空闲的端口和隔离数据库；原.env、随机凭据、Cookie及数据目录不归档。

第一次HTTP复用脚本漏传REVIEW_WEB_LOG，在日志比对处失败；保留http-probes-setup-error.json/log，补环境参数后完整重跑exit0。E2E首次8/8，保留pg弃用与颜色变量警告；容器保留依赖下载/平台检测提示。不把环境准备错误算为产品缺陷，不隐去首次失败。

ZCode本轮容器证据实际位于应用下ai-ecommerce-assistant/docs/reviews/gate-01-r5-evidence，交接中的根相对路径不准确；本轮找到并读取真实路径，未移动其文件。这里是Codex独立执行的新证据。

原应用109个跟踪文件（含24个ZCode证据）应保持未改；最终状态见final-verification.json。SHA256SUMS.json列本目录文件哈希，清单自身除外。未执行未来Phase、合并、推送、线上部署或真实企业试用；更早未改历史实验保留原证据与适用限制。
