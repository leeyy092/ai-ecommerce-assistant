# 阶段审查 · Codex

```text
请在 /Users/yuyuyu/Documents/ChatGPT/产品-开发 读取 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、映射的真实进度/任务/验收/决策文档、PHASE_PLAN.md 和 CODEX_REVIEW_HANDOFF.md。
先确认当前 Gate、Phase、基线、待审提交和文件差异。旧 TASK-001 交接不能充当 Phase 1 全阶段交接；缺少当前交接或代码仍在变化时先说明缺证据，不给旧版本的 PASS。
本轮做独立审查，不开展后续业务任务。按阶段合同核对实际代码、必要测试与结果。Phase 1 重点为运行环境、数据库约束、身份与邀请、两组织隔离、四角色服务端权限与客服字段投影。
每个可操作问题写触发条件、影响、位置和修复验收。结论用 PASS/FAIL/BLOCKED：缺证据不是通过，检查未执行要说明原因。
FAIL 时记录问题并把下一工具设为 ZCode，next_prompt=prompts/P08_FIX.md，状态待修复；BLOCKED 写清需要补的证据；PASS 记录精确版本并等待用户阶段放行，不能直接替用户合并或启动下一 Phase。
除非用户本轮明确只读，每轮结束维护原 12_PROGRESS.md 中任务表、当前摘要、状态块和审查证据，保留历史。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回首页与总控。用户只读时不写文件、不刷新，输出完整待写回内容并说明尚未保存。
最后只告诉我审查结论、主要影响、下一工具及是否需要阶段放行。
```
