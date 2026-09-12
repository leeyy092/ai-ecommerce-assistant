#!/usr/bin/env bash
# 本地 PostgreSQL 17 开发实例管理（TASK-001）。
# 数据目录、日志与端口全部限定在本应用内，不占用系统默认实例。
# 依赖：brew install postgresql@17（仅使用其二进制，不注册全局服务）
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGDATA="${APP_DIR}/.postgres"
PG_PORT="${PG_PORT:-5433}"
PG_USER="${PG_USER:-aiea}"
PG_DB="${PG_DB:-aiea_dev}"
PG_LOG="${APP_DIR}/.runtime/pg.log"

need_pg() {
  if [ ! -x "${PGBIN}/pg_ctl" ]; then
    echo "未找到 PostgreSQL 17（${PGBIN}/pg_ctl）。请先：brew install postgresql@17" >&2
    exit 1
  fi
}

case "${1:-help}" in
  init)
    need_pg
    mkdir -p "${APP_DIR}/.runtime"
    if [ ! -f "${PGDATA}/PG_VERSION" ]; then
      echo "初始化集群 ${PGDATA}，端口 ${PG_PORT}，用户 ${PG_USER}"
      "${PGBIN}/initdb" -D "${PGDATA}" -U "${PG_USER}" --encoding=UTF8 --locale=C
      echo "port = ${PG_PORT}" >>"${PGDATA}/postgresql.conf"
    fi
    "${PGBIN}/pg_ctl" -D "${PGDATA}" -l "${PG_LOG}" -w start
    if ! "${PGBIN}/psql" -p "${PG_PORT}" -U "${PG_USER}" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
      "${PGBIN}/createdb" -p "${PG_PORT}" -U "${PG_USER}" "${PG_DB}"
    fi
    echo "数据库就绪 postgres://${PG_USER}@127.0.0.1:${PG_PORT}/${PG_DB}"
    ;;
  start)
    need_pg
    mkdir -p "${APP_DIR}/.runtime"
    exec "${PGBIN}/pg_ctl" -D "${PGDATA}" -l "${PG_LOG}" -w start
    ;;
  stop)
    need_pg
    exec "${PGBIN}/pg_ctl" -D "${PGDATA}" -m fast -w stop
    ;;
  status)
    need_pg
    exec "${PGBIN}/pg_ctl" -D "${PGDATA}" status
    ;;
  *)
    echo "用法 ${0} init|start|stop|status"
    echo "默认 端口 ${PG_PORT} 用户 ${PG_USER} 数据库 ${PG_DB} 数据目录 ${PGDATA}"
    ;;
esac
