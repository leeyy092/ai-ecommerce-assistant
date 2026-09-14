# syntax=docker/dockerfile:1
# AI 电商运营助手｜Web 与 Worker 共用镜像（Gate-01 H10 修复版）
# 运行时与本地工具链一致：Node 24.21.0

FROM node:24.21.0-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
# postinstall 执行 `prisma generate`，须先提供 schema 与 Prisma 配置
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile

FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
# H10：deps 阶段生成的 Prisma 客户端在 src/generated（不在 node_modules），
# 构建上下文里没有它（.gitignore 排除），必须显式从 deps 复制
COPY --from=deps /app/src/generated ./src/generated
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 构建阶段不访问数据库也不需要真实认证秘密：
# 占位值仅满足可能触碰的模块级读取；运行时由 compose 注入真实值并强校验
# （认证实例为懒加载，正常构建不会初始化；此处占位是纵深防御）
ENV DATABASE_URL=postgres://placeholder:placeholder@127.0.0.1:5432/placeholder
ENV BETTER_AUTH_SECRET=build-time-placeholder-not-a-secret
ENV BETTER_AUTH_URL=http://localhost:3000
RUN pnpm build

FROM node:24.21.0-bookworm-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
# Web 默认入口直接以 node 启动，避免运行时经 corepack/pnpm 触发网络解析；
# Worker 服务以 command: node dist/jobs/worker.js 覆盖
# 运行时必需的 BETTER_AUTH_SECRET/BETTER_AUTH_URL/DATABASE_URL 由 compose 注入（见 compose.yaml）
CMD ["node", "node_modules/next/dist/bin/next", "start"]
