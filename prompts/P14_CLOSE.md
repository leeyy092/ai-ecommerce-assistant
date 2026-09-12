# 只补齐收尾与总控

```text
请在 /Users/yuyuyu/Documents/ChatGPT/产品-开发 显式读取 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、12_PROGRESS.md、09_TASKS.md 与 PHASE_PLAN.md，并检查实际 Git 差异和最近执行证据。
本轮只补管理收尾，不启动业务 TASK。核对当前任务表、摘要、唯一 Product OS 状态块是否一致；保留历史与其他执行者的工作，无法核实的检查写 unknown/未执行。
根据证据更新当前阶段/TASK、工具、完整 next_prompt、完成标准、Checkpoint 和下一步。GitHub 与部署只有实际核验才能更改结果和核验时间，不把本地有 remote 写成已同步。
运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回 00_START_HERE.md 和总控 PROJECTS.md，确认可复制提示词指向正确工具和当前任务。
告诉我进度是否已写回、总控是否已刷新、现在该用哪个工具。用户本轮明确只读时不写文件、不刷新，给出待写回内容。
```
