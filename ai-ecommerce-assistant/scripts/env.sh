# 应用隔离 Node 24 工具链（不改动系统与其他项目的运行环境）
# 用法：source scripts/env.sh（随后 node -v 应显示 v24.x）
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -x "$APP_DIR/.tools/node24/bin/node" ]; then
  echo "未找到 $APP_DIR/.tools/node24。请按 README「工具链准备」安装 Node 24.21.0（darwin-arm64）。" >&2
  return 1 2>/dev/null || exit 1
fi
export PATH="$APP_DIR/.tools/node24/bin:$PATH"
