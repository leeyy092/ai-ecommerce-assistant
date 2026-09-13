# syntax=docker/dockerfile:1
# AI 电商运营助手｜Web 与 Worker 共用镜像（TASK-001；Gate-01 H10 修复）
# 运行时与本地工具链一致：Node 24.21.0

FROM node:24.21.0-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
# postinstall 会执行 `prisma generate`，必须先提供 schema 与 Prisma 配置（H10）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile

FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 构建阶段不访问数据库；占位值仅满足构建期环境校验，运行时由 compose/环境注入真实值
ENV DATABASE_URL=postgres://placeholder:placeholder@127.0.0.1:5432/placeholder
RUN pnpm build

FROM node:24.21.0-bookworm-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
# Web 默认入口；Worker 服务以 command: node dist/jobs/worker.js 覆盖
# 运行时必需的 BETTER_AUTH_SECRET/BETTER_AUTH_URL/DATABASE_URL 由 compose 注入（见 compose.yaml）
CMD ["pnpm", "start"]
