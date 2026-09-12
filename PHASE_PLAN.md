# P0 开发阶段与 Codex Review Checkpoint 规划

版本：1.0 · 2026-09-12（依据 DEVELOPMENT_HANDOFF.md v1.1 §6 任务顺序与用户 Codex Review 规则制定；任务编号、名称、依赖与顺序完全沿用 09_TASKS.md，不合并、不跳过）

## 执行与 Review 规则（摘自用户规则，长期有效）

- 任一时刻仅一个 TASK 处于 IN_PROGRESS；同一 TASK 可跨会话并按 12_PROGRESS 检查点续接。
- Phase 内 Checkpoint = NO 时连续执行后续 TASK，无需逐个等待用户确认；每 TASK 完成后更新 12_PROGRESS.md 并输出固定格式汇报。
- 到达 Review Gate：立即停止开发，状态更新为 CODEX_REVIEW_REQUIRED（写入 12_PROGRESS.md），生成/更新根目录 CODEX_REVIEW_HANDOFF.md，等待用户提供 Codex Review 结果与放行。
- Phase 中途出现「数据库 Schema 重要修改、API Contract 重要修改、模块即将被大量依赖」时，即使用户未要求也可提前触发 Gate（主动提示）。
- 收到 Review 后逐条标 ACCEPT/DISCUSS/REJECT；优先修 Critical/High；Medium/Low 以不明显拖慢 MVP 为限；修完重跑测试、更新进度，经放行进入下一 Phase。
- 文案/UI 小调整/小 Bug 不触发 Gate。
- GPT_PRODUCT_DECISION_REQUIRED 状态出现时暂停等待用户决策。

## 阶段划分（8 Phase / 8 Gate）

| Phase | 模块 | TASK | Gate |
|---|---|---|---|
| Phase 1 项目地基 | 运行环境·数据库·身份·权限 | 001–004 | CODEX_REVIEW_GATE_01 |
| Phase 2 数据接入基础 | 店铺/数据源·统一Adapter·上传与任务 | 005–007 | CODEX_REVIEW_GATE_02 |
| Phase 3 六类文件导入链路 | 校验·预览·原子提交 | 008–012 | CODEX_REVIEW_GATE_03 |
| Phase 4 计算与规则引擎 | 任务编排·指标·队列·异常·快照发布 | 013–016 | CODEX_REVIEW_GATE_04 |
| Phase 5 AI 链路 | 模型网关·VOC·建议·日报 | 017–020 | CODEX_REVIEW_GATE_05 |
| Phase 6 Dashboard 与老板主路径 | 首页·指标页·SKU | 021–022 | CODEX_REVIEW_GATE_06 |
| Phase 7 全功能工作台 | 客服·告警·行动·导入向导·设置 | 023–027 | CODEX_REVIEW_GATE_07 |
| Phase 8 演示、试点与验收 | 演示包·运维·整体验收 | 028–030 | CODEX_REVIEW_GATE_08（终审） |

## 各 Phase 要点

- **Phase 1**：可启动工程（001）→ P0 全量数据表与约束（002）→ 登录/初始 Owner/受控邀请（003）→ 组织隔离与四角色权限服务（004）。Gate 01 检查重点：Prisma Schema 与 04_DATA_MODEL 一致性（复合外键/自然键/枚举）、Better Auth 集成、服务端权限强制。
- **Phase 2**：店铺/数据源配置锁定（005）→ CSV/Mock 统一 Adapter 与黄金样本（006）→ 私有存储+上传+ImportTask+最小 pg-boss（007）。Gate 02：Adapter 契约、存储私有性、幂等键。
- **Phase 3**：008 映射/校验/预览（按公共内核→六类规则→预览冲突分段交付）→ 009 提交内核与商品 → 010 订单 → 011 广告 → 012 客服/售后/退款。Gate 03：原子性、自然键 upsert、错误码体系、coverage 声明。
- **Phase 4**：013 持久任务与快照发布（含 F01/F08 评估身份与两阶段发布协议）→ 014 基础指标 → 015 队列指标 → 016 十条规则（按店铺级/对象级分段）。Gate 04：v1.1 六组契约修订（B1–B6）落实、Decimal/时区、D+7 口径、发布竞态。
- **Phase 5**：017 模型网关与 Schema 门禁（需百炼 Key，本阶段初实测）→ 018 VOC → 019 建议 → 020 日报与降级。Gate 05：PART9 Schema/语义校验、脱敏出站、预算硬停（F11 保留原计费合同）。
- **Phase 6**：021 Dashboard 六区块+指标页（确定性区块→AI 状态分段）→ 022 SKU 列表/详情/产品聚合。Gate 06：同版快照读取、无前端计算、C 角色拒绝。
- **Phase 7**：023 客服中心 → 024 告警中心 → 025 行动状态与日报阅读 → 026 导入向导（提交→历史恢复分段）→ 027 设置与成员。Gate 07：客服投影零泄漏、导入向导不可跳过预览、与 08_API_SPEC 一致（注意 F12：/ai-insights 为单一列表+详情，无五 Tab）。
- **Phase 8**：028 演示包 → 029 试点运维 → 030 整体验收。Gate 08（终审，准备部署 MVP）：PART23 上线必验项、性能实测、验收记录。

## 当前进度快照（本文件不作为进度真源，仅导航；实际状态见 12_PROGRESS.md）

- 2026-09-12：TASK-001 DONE（Phase 1 内）；用户已对 TASK-001 单独发起过一次 Codex 审查（CODEX_REVIEW_HANDOFF.md 在根目录）。
