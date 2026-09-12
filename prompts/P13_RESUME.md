# 首次接入 / 换工具 / 中断恢复

```text
请打开 /Users/yuyuyu/Documents/ChatGPT/产品-开发 这个真实项目根目录，显式读取项目 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md，并按配置读取 12_PROGRESS.md、09_TASKS.md、DEVELOPMENT_HANDOFF.md、FINAL_DECISIONS.md、PHASE_PLAN.md。
不要假设新规则已自动加载；先用一行说明实际路径、当前 Phase/TASK、分支、Checkpoint 和接手工具。
检查磁盘最新任务表、执行证据、状态块和实际未提交差异；有矛盾先恢复核验，不能照旧摘要重复做已完成任务。保留所有在途改动，另一个工具仍在写同一文件时先完成交接。
读取最新 next_prompt 指向的提示词，按其当前授权范围执行；如果它指回本恢复提示词，先根据证据明确具体动作并修正，不循环调用。到 PHASE_PLAN 的 Gate 时停止，不跨阶段自行放行。
每轮结束更新原进度及下一步，运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回首页和总控；只读请求则输出待写回内容，不修改文件。
```
