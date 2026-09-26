#!/bin/bash
# G2R3-20260926-01-N1：Compose 链路重验（每步独立日志+真实退出码+断言）
CTX=/tmp/aiea-compose-ctx
APP=/tmp/aiea-fix-g2r3/ai-ecommerce-assistant
LOG=/tmp/aiea-r3fix-logs/compose-n1
export PATH=/tmp/aiea-node24/bin:$PATH
P="aiea-r3fix"
SUM="$LOG/summary.jsonl"; : > "$SUM"
step(){ local id="$1" name="$2" exit="$3" expect="$4"; echo "{\"step\":\"$id\",\"name\":\"$name\",\"exit\":$exit,\"expect\":\"$expect\"}" >> "$SUM"; }

cd "$CTX" || exit 9
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
SECRET=$(grep '^BETTER_AUTH_SECRET=' .env | cut -d= -f2-)
OWNER_PW="R3n1-Owner-$RANDOM-pw"

# S1 构建（真实退出码，完整日志，不经管道）
docker compose -p $P build > "$LOG/s1-build.log" 2>&1; E1=$?
step S1 "compose build(完整日志+真实退出码)" $E1 "exit=0"
[ $E1 -ne 0 ] && { step S1b "构建失败中止" 1 "exit=0"; cat "$SUM"; exit 1; }

# S2 镜像存在 + canary 不进镜像
docker image inspect aiea-r3fix-web > "$LOG/s2-image-web.log" 2>&1; E2a=$?
docker image inspect aiea-r3fix-worker >> "$LOG/s2-image-web.log" 2>&1; E2b=$?
docker run --rm aiea-r3fix-web sh -c 'ls /app/.data 2>&1 | grep -q "No such file" && (grep -rq canary-secret-r3fix /app 2>/dev/null && echo FOUND || echo CLEAN)' > "$LOG/s2-canary.log" 2>&1
grep -q CLEAN "$LOG/s2-canary.log"; E2c=$?
E2=$(( E2a + E2b + E2c ))
step S2 "镜像存在+canary排除断言" $E2 "exit=0"

# S3 up + 健康
docker compose -p $P up -d > "$LOG/s3-up.log" 2>&1; E3a=$?
code=000; for i in $(seq 1 60); do code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null); [ "$code" = "200" ] && break; sleep 2; done
[ "$code" = "200" ]; E3b=$?
docker compose -p $P ps --format "{{.Service}} {{.Status}}" > "$LOG/s3-ps.log" 2>&1
E3=$(( E3a + E3b ))
step S3 "up+健康200" $E3 "exit=0"

# S4 宿主侧官方迁移
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$PW")
(cd "$APP" && DATABASE_URL="postgresql://aiea:$ENC@127.0.0.1:5433/aiea_dev" pnpm exec prisma migrate deploy) > "$LOG/s4-migrate.log" 2>&1; E4a=$?
grep -q "All migrations have been successfully applied" "$LOG/s4-migrate.log"; E4b=$?
E4=$(( E4a + E4b ))
step S4 "官方12迁移" $E4 "exit=0"

# S5 init-owner（容器内 dist bundle）
docker compose -p $P exec -T web sh -c "printf '%s' '$OWNER_PW' | node dist/scripts/init-owner.js --org R3N1复修组织 --email owner@r3n1.local --name Owner" > "$LOG/s5-owner.log" 2>&1
grep -q "初始化完成：org=" "$LOG/s5-owner.log"; E5=$?
step S5 "init-owner" $E5 "exit=0"

# S6 登录→建店/源→上传
curl -s -c "$LOG/cookies.txt" -X POST http://127.0.0.1:3000/api/auth/sign-in/email -H "content-type: application/json" -H "origin: http://127.0.0.1:3000" -d "{\"email\":\"owner@r3n1.local\",\"password\":\"$OWNER_PW\"}" > "$LOG/s6-login.json" 2>&1
grep -q '"token"' "$LOG/s6-login.json"; E6a=$?
STORE=$(curl -s -b "$LOG/cookies.txt" -X POST http://127.0.0.1:3000/api/v1/stores -H "content-type: application/json" -H "origin: http://127.0.0.1:3000" -d '{"name":"R3N1店","external_store_id":"R3N1-1","platform":"manual","currency":"CNY","timezone":"Asia/Shanghai"}')
STORE_ID=$(echo "$STORE" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null); [ -n "$STORE_ID" ]; E6b=$?
SRC=$(curl -s -b "$LOG/cookies.txt" -X POST http://127.0.0.1:3000/api/v1/data-sources -H "content-type: application/json" -H "origin: http://127.0.0.1:3000" -d "{\"store_id\":\"$STORE_ID\",\"name\":\"R3N1源\",\"adapter_kind\":\"csv\",\"source_namespace\":\"ns-r3n1\"}")
SRC_ID=$(echo "$SRC" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null); [ -n "$SRC_ID" ]; E6c=$?
printf 'store_external_id,source_updated_at,external_product_id,product_name,category,product_status,external_sku_id,sku_code,sku_name,specification,sku_status\nR3N1-1,2026-09-11T01:00:00Z,P1,保温杯,杯具,active,S1,CUP-RED,红杯,,active\n' > "$LOG/upload.csv"
UPLOAD=$(curl -s -b "$LOG/cookies.txt" -X POST http://127.0.0.1:3000/api/v1/imports -H "origin: http://127.0.0.1:3000" -F "store_id=$STORE_ID" -F "data_source_id=$SRC_ID" -F "entity_type=products" -F "file=@$LOG/upload.csv;filename=products.csv;type=text/csv")
echo "$UPLOAD" > "$LOG/s6-upload.json"
TASK_ID=$(echo "$UPLOAD" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null); [ -n "$TASK_ID" ]; E6d=$?
E6=$(( E6a + E6b + E6c + E6d ))
step S6 "登录/建店/建源/上传201" $E6 "exit=0"

# S7 Worker 校验至 preview_ready
st=none; for i in $(seq 1 40); do st=$(curl -s -b "$LOG/cookies.txt" "http://127.0.0.1:3000/api/v1/imports/$TASK_ID" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['status'])" 2>/dev/null); [ "$st" = "preview_ready" ] && break; sleep 2; done
echo "final_status=$st" > "$LOG/s7-status.log"; [ "$st" = "preview_ready" ]; E7=$?
step S7 "Worker校验preview_ready" $E7 "exit=0"

# S8 签名下载一致
KEY="raw/$TASK_ID/source.csv"; EXP=$(python3 -c "import time;print(int((time.time()+300)*1000))")
SIG=$(python3 -c "import hmac,hashlib,sys;print(hmac.new(sys.argv[1].encode(),f'{sys.argv[2]}:{sys.argv[3]}'.encode(),hashlib.sha256).hexdigest())" "$SECRET" "$KEY" "$EXP")
curl -s -b "$LOG/cookies.txt" "http://127.0.0.1:3000/api/v1/imports/$TASK_ID/file?expires=$EXP&signature=$SIG" -o "$LOG/dl1.csv" 2>&1
diff "$LOG/upload.csv" "$LOG/dl1.csv" > "$LOG/s8-diff.log" 2>&1; E8=$?
step S8 "签名下载一致" $E8 "exit=0"

# S9 重启后读回一致
docker compose -p $P restart web worker > "$LOG/s9-restart.log" 2>&1; E9a=$?
code2=000; for i in $(seq 1 60); do code2=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null); [ "$code2" = "200" ] && break; sleep 2; done
EXP2=$(python3 -c "import time;print(int((time.time()+300)*1000))")
SIG2=$(python3 -c "import hmac,hashlib,sys;print(hmac.new(sys.argv[1].encode(),f'{sys.argv[2]}:{sys.argv[3]}'.encode(),hashlib.sha256).hexdigest())" "$SECRET" "$KEY" "$EXP2")
curl -s -b "$LOG/cookies.txt" "http://127.0.0.1:3000/api/v1/imports/$TASK_ID/file?expires=$EXP2&signature=$SIG2" -o "$LOG/dl2.csv" 2>&1
diff "$LOG/upload.csv" "$LOG/dl2.csv" > "$LOG/s9-diff.log" 2>&1; E9b=$?
E9=$(( E9a + E9b ))
step S9 "重启web/worker后读回一致" $E9 "exit=0"

# S10 清理并断言无残留
docker compose -p $P down -v --rmi local > "$LOG/s10-down.log" 2>&1; E10a=$?
LEFT=$(docker ps -a --format '{{.Names}}' | grep -c "aiea-r3fix"); VOL=$(docker volume ls --format '{{.Name}}' | grep -c "aiea-r3fix"); IMG=$(docker images --format '{{.Repository}}' | grep -c "aiea-r3fix")
[ "$LEFT" = "0" ] && [ "$VOL" = "0" ] && [ "$IMG" = "0" ]; E10b=$?
echo "left=$LEFT vol=$VOL img=$IMG" > "$LOG/s10-cleanup.log"
E10=$(( E10a + E10b ))
step S10 "down-v清理无残留" $E10 "exit=0"

echo "--- SUMMARY ---"; cat "$SUM"
