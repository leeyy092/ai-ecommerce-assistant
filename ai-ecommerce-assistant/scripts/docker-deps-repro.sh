#!/usr/bin/env bash
# Gate-01 H10 等价复现（本机无 Docker 的静态等价验证）：
# 在与 Dockerfile deps 阶段完全相同的文件布局下：
#   1) pnpm install --frozen-lockfile --ignore-scripts（链接依赖；Codex 已证明全量安装可走到 postinstall）
#   2) 执行 postinstall 的实际命令 `pnpm exec prisma generate`（旧布局在此报 "Could not find Prisma Schema"）
# 退出 0 = 依赖布局 + Prisma 生成顺序正确。
# 真实 Docker runtime 构建仍未在本机验证（见 12_PROGRESS 已知限制）。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$APP_DIR/.tools/node24/bin:$PATH"
LAYOUT="$(mktemp -d /tmp/aiea-docker-deps-repro.XXXXXX)"
trap 'rm -rf "$LAYOUT"' EXIT

cd "$LAYOUT"
cp "$APP_DIR/package.json" "$APP_DIR/pnpm-lock.yaml" "$APP_DIR/pnpm-workspace.yaml" "$APP_DIR/.npmrc" ./
mkdir -p prisma
cp "$APP_DIR/prisma/schema.prisma" prisma/schema.prisma
cp "$APP_DIR/prisma.config.ts" ./

"$APP_DIR/.tools/node24/bin/pnpm" install --frozen-lockfile --ignore-scripts >install.log 2>&1 || {
  echo "FAIL: pnpm install 失败" >&2; tail -20 install.log >&2; exit 1;
}

"$APP_DIR/.tools/node24/bin/pnpm" exec prisma generate >generate.log 2>&1 || {
  echo "FAIL: postinstall 等价命令 prisma generate 失败" >&2; tail -20 generate.log >&2; exit 1;
}

if [ ! -e "$LAYOUT/src/generated/prisma" ]; then
  echo "FAIL: 未生成 Prisma 客户端到 src/generated/prisma" >&2; exit 1
fi

echo "OK: deps 布局等价复现通过（install + postinstall 等价命令 prisma generate）"
