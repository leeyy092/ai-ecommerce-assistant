# 部署与外部同步核验

GitHub 核验：2026-09-13T00:54:14+08:00。部署文件核验：2026-09-13T00:45:24+08:00。本文件保存核验依据；首页摘要在唯一进度文件中。

| 项目 | 实际结果 | 依据 |
|---|---|---|
| 本地 Git | 已建立 | 当前分支 phase/01-foundation；原根目录 `/Users/yuyuyu/Documents/ChatGPT/产品-开发` |
| origin | `git@github.com:leeyy092/ai-ecommerce-assistant.git` | 实际读取 remote |
| GitHub 分支 | 已提交 HEAD 与远端一致 | `git ls-remote` 返回 `c263610541f8c8f7b41fd38c185f5feac94e8ee2` |
| main | `2a983cc55f136abbb49c5d02b55c1cb82b6547cc` | 实际读取远端 ref |
| 未提交内容 | 本次后续管理接入文件 | 工作区快照每次 sync 重新采集；未提交不等于已备份 GitHub |
| 仓库可见性 | unknown | 历史记录称 Private，本轮未查询仓库设置 |
| Dockerfile / compose.yaml | 存在 | compose 是本地 PostgreSQL + Web + Worker 配置 |
| 生产部署配置 / 云资源 / 域名 | unknown（未找到证据） | 未发现已跟踪的生产 Caddyfile、Vercel/Render/Fly 配置或部署工作流 |
| 线上 URL | unknown | README 中 `http://127.0.0.1:3000` 为本机地址 |
| 本机运行可用性 | 本轮未验证通过 | /api/health 请求 connection reset、HTTP 000；开发期间可能重启，不据此诊断根因 |
| TASK-029 试点运行与最低安全运维 | TODO | 原进度和任务定义 |

本轮未部署、未提交、未推送、未合并，未启动或停止业务服务。接入期间 ZCode 自行完成 TASK-004 并提交/推送 Gate 01，上表已重新核实最新远端。刷新总控不会联网重验。
