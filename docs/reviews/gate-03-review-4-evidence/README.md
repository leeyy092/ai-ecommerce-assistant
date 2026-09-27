# Gate03 Review4 独立证据

审查G3R4-20260927-01，通知G3R4-20260927-02。冻结ea1c15f（业务bc5e4b2），差异6539fcb..ea1c15f；结论PASS，关闭R3两项残余。技术通过、Owner放行、GitHub、部署和真实试用分别记录。

本轮新/tmp git archive+新PG17.11@127.0.0.1:57034，未复用Z02数据库；context.json/review-runner.py记录环境及命令。每个同名json记录实际参数/cwd/时间/退出码，log为原始输出。环境已清理，复现时必须创建自己的副本和新PG，不能连接历史端口。

顺序：offline frozen install→generate→12迁移→typecheck→test:integration（139）→test:g3（候选四进程18+4+21+4）→仅临时副本加入g3r4-independent.test.ts单独运行（10）。全部exit0；integration不含后加入的R4场景。script-exit-propagation.json为真实package脚本的受控退出码验证，23只是模拟失败值。

R4补充：4种结构损坏、读取EIO后恢复、expected更正后补齐、减少expected不擅自升级、日期迁移、未声明日期不造覆盖、派生coverage故障导致整事务回滚并恢复。observations.json保留50条原始观测，含本轮重跑的既有场景，不将观测条数当测试数。

unit/build/E2E无变更且未本轮重复；引用R3独立72/build0/E2E8，Z02本候选自测另列，不混作本轮独立结果。100000行/SIGKILL/生产Worker容器全链/真实OSS云仍按原任务与启用边界，不作本轮通过声明。

R1 42/R2 57/R3 61件不可变产物哈希均一致；原docs探针不改，app H04d仅授权隔离日期。cleanup.json记录PG停止、自己的/tmp删除与端口关闭。coordination-receipt.json/final-verification.json为可追加管理记录，其余由本轮索引固定哈希。
