# Gate 01 第二轮剩余问题修复 · ZCode

当前执行提示词对应 c87a141 的 REVIEW_2 FAIL；下方旧提示词仅保存历史。

```text
补充同版本正式复核（2026-09-13T22:31:24+08:00）：先读取 docs/reviews/CODEX_REVIEW_GATE_01_FORMAL_2026-09-13.md 和 docs/reviews/GATE_01_FORMAL_EVIDENCE_2026-09-13.json。本地/远端仍c87a141，22时独立复测再次确认4项HIGH，正式Gate=BLOCKED、技术FAIL，不是新的修复完成版本。只按报告第13节处理必须修复的H06/H08/H09/H10，保留已通过回归和D01；M01–M04沿用原技术核定。M05（本地Compose固定开发口令/发布地址）建议随H10小幅收敛；L01（根目录误留旧Schema/包配置）核对用途后处理；M05/L01不单独增加Gate阻断，不扩大P0。新修复提交后再交Codex，Owner放行独立记录。

请接手 AI 电商运营助手 Gate 01 第二轮复审后的 Phase 1 修复；只修 TASK-001–004，不开始 TASK-005、不合并 main、不部署。

项目根目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发；应用目录：其下 ai-ecommerce-assistant；总控：/Users/yuyuyu/Documents/AI-Workspace。
先显式读取 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、唯一进度 docs/ai-ecommerce-assistant/12_PROGRESS.md、09_TASKS.md、PHASE_PLAN.md、FINAL_DECISIONS.md、CODEX_REVIEW_HANDOFF.md，以及 docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_2_2026-09-13.md、GATE_01_REVIEW_2_EVIDENCE.json 和相关原合同。首轮报告与旧交接保留历史，不再按旧摘要重新处理已关闭项。

当前 Phase1 / TASK-004 / 待修复 / Gate REVIEW_2 FAIL / Checkpoint=YES。分支 phase/01-foundation；本轮复审提交 c87a141648227954725402c715063a900fa72659；main=2a983cc55f136abbb49c5d02b55c1cb82b6547cc。先实查HEAD、未提交差异与其他执行者；保留上轮及本轮管理文档、报告证据，不覆盖/reset，不创建平行项目。下一次复审基线为c87a141，目标在修复结束后重新冻结。

H01/H02/H03/H04/H05/H07及D01已独立通过；D01方案A无需再问：只禁当前组织Membership并撤登录会话，绝不由组织接口修改全局User.status，其他有效组织重登可用。

逐项给ACCEPT/DISCUSS/REJECT，按原TASK顺序一次一项修复：
1. TASK-001 / H10：deps生成客户端未复制进build，干净构建缺@/generated/prisma/client；隔离补客户端后构建仍缺BETTER_AUTH_SECRET/URL。修正确认生成物和非生产构建配置，生产秘密不得入镜像；在真实Docker环境完成干净build、Web/Worker/PG、迁移、初始化和登录smoke。没有运行时则准确保留BLOCKED，不把deps复现当容器实测，不延期到029结案。
2. TASK-002 / H08/H09及M04身份外键：审计同域必须覆盖父行变化和旧库存量；当前触发器两者都漏。Prisma7.10混合可空复合关系已由最小Schema验证可表达，需明确删除时只清store_id保留org_id的策略。14个可空领域时间列仍无时区，按报告清单补齐并用新增迁移；核对历史时区后转换，空库/旧版本升级均验证。补domain User.authUserId认证外键和明确删除策略，与H06协调；不能改写共享迁移或自动篡改审计旧行。
3. TASK-003 / H06及M01/M02/M03：并发initOwner的孤儿回收会互删在途身份，最终Auth=0/领域User=1且重跑假幂等。初始化与邀请需统一邮箱协调、权威重查、可恢复身份链和安全补偿；验证并发初始化、初始化/邀请交错、普通重跑与实际进程中断恢复。现有v1写入口补可信Origin/Content-Type/必要CSRF；登录仅认证成功清零，400/429不清零并明确代理信任；当前端点严格对象/类型/长度/正整数expected_version和稳定错误信封，注册拒绝每次新Response。
4. TASK-004：完成当前成员/组织/活跃组织共同写入口的M01/M03修复并回归H01/H02/H03/H07；保留D01及双组织不同角色行为，不扩RBAC/业务模块。

Medium不是整体延期：上述M01/M02/M03和M04认证外键均在Gate01 PASS前；只有UUID数据库格式约束可延期至首次后续Schema变更或TASK-028前（二者较早），仍作为TASK-002技术债。实际部署域名/反代校验属TASK-029；不自动并入TASK-005，不修改认证框架string主键。详见报告第4节。

原套件本轮独立通过：typecheck、build、unit14/14、integration46/46、e2e8/8；这些并未覆盖所有剩余反例。按报告保存有意义的回归，特别是真实HTTP/Cookie、权限矩阵、审计状态/版本/会话一起回滚、数据库持续同域、完整时间类型清单、空库/升级和Docker闭环。测试只使用隔离数据库和临时凭据，不操作现有开发/客户数据。

遵守原Git授权、每TASK记录和Phase分支规则；仅提交本任务相关文件，检查敏感内容，不force push、不重写历史。不把修复自测当Codex复审PASS或Owner放行。

完成后重读磁盘最新唯一进度，更新TASK表、摘要、唯一状态块、CODEX_REVIEW_HANDOFF及下一轮P07_CODE_REVIEW完整提示词；保留首轮与本轮报告，列出实际修复提交和c87a141..新提交差异。回到待审查/CODEX_REVIEW_REQUIRED、Checkpoint=YES、工具Codex；真实缺证如实标明。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 并读回项目首页MD/HTML和总控PROJECTS.md。独立复审PASS后仍需Owner阶段放行，不能自行进入下一Phase。
```

---

## 历史首轮提示词原文（不得作为当前指令）

# 修复 Gate 01 审查问题 · ZCode

> 历史提示词：本文件正文保存首轮 c263610 的修复交接。后续 ZCode 已提交修复与 D01 方案 A；当前应按首页使用 P07_CODE_REVIEW.md 做第二轮复审，不再按下文重复首次修复或询问 D01。若复审发现新问题，由该轮更新本文件。

```text
请在 /Users/yuyuyu/Documents/ChatGPT/产品-开发 显式读取 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、docs/ai-ecommerce-assistant/12_PROGRESS.md、PHASE_PLAN.md、CODEX_REVIEW_HANDOFF.md，以及 docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md 和 GATE_01_EVIDENCE.json。

当前为 Phase 1 / CODEX_REVIEW_GATE_01，结论 BLOCKED，TASK-001–004 完整验收均 FAIL，10 HIGH、4 MEDIUM。基线 main=2a983cc，冻结 phase/01-foundation=c263610541f8c8f7b41fd38c185f5feac94e8ee2；TASK-001/002已在恢复基线，不能只看分支diff忽略它们。

先核对分支、版本、未提交文件与其他执行者；保留 Product OS 与审查文档修改。逐项给出 ACCEPT/DISCUSS/REJECT，再按依赖一次一个 TASK 修复：TASK-001 H10；TASK-002 H08/H09；TASK-003 H04/H05/H06/H07；TASK-004 H01/H02/H03及相关H07。以报告真实反例和完成判据为准；M01–M04按风险和相称工作量处理，不为风格重构或扩大P0。

D01：GPT/Owner尚需明确全局账号禁用与组织成员禁用语义。裁决前不可自行改变业务定义，可先完成不依赖D01的修复；H03保留待决状态。租户管理员不能仅凭本组织角色控制其他组织账号有效性。

现有unit14/14、integration28/28、e2e6/6、typecheck/build通过，不证明反例已通过。补真实HTTP/Cookie、多组织不同角色、邀请失败和并发、审计故障回滚、数据库同域/时区、新空库及向前升级验证。H10需要真实Docker构建/启动验证；环境不具备时如实记录。关闭公开注册后应保持受控初始化/邀请可用，不手工伪造Better Auth Cookie。

仅在phase/01-foundation修复本轮问题，遵守原Git授权及每TASK记录要求。不改写共享历史/迁移，不开始TASK-005，不合并main，不部署。记录原问题、修改、实际检查、提交版本和剩余缺口。

完成后更新原12_PROGRESS.md任务表、摘要、唯一状态块与CODEX_REVIEW_HANDOFF；保留基线c263610，明确修复commit/diff。满足修复检查后回待审查/CODEX_REVIEW_REQUIRED，Checkpoint=YES，工具Codex，next_prompt=prompts/P07_CODE_REVIEW.md。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 并读回项目首页与00_CONTROL_CENTER/PROJECTS.md。交Codex复审，Owner最终放行，不自行宣布独立审查通过。
```
