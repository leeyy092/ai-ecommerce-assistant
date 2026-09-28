# B01 设置页面接入执行提示词

```text
# B01 设置真实页面接入（TASK027首批切片 + TASK021局部入口）

编号：B01-SETTINGS-INTEGRATION-20260928-01。根目录 /Users/yuyuyu/Documents/ChatGPT/产品-开发。本文为Codex04准备的执行合同；只有04向B01实际发送同编号START才生效。先只读ACK不构成START。

## 目标与原合同

把原先只有组件的组织/建店/建源/权限说明接为可实际访问的 /settings 页面，以真实Cookie、既有API与隔离PG验证。遵循03_INFORMATION_ARCHITECTURE的 /settings 默认organization及 ?tab=organization|stores|data-sources|permissions，02角色与08接口原合同。必要片段来自已批准MVP-CORE-20260928-01，不能标TASK021/027整体完成。

当前主线Z02 G4R3-20260928-02返修013–016，基线6cfa36d；04总协调和独立审查，Z02负责后端/API/Worker及主线管理/Git/sync，B01只负责本白名单页面。B01无主线Git/管理写入。A01仅分析。21:00日报由B01既有自动化id21负责，只读，不派发任务。

## 逐文件白名单（均相对于 ai-ecommerce-assistant/）

允许新建：
- src/app/settings/page.tsx
- src/app/settings/layout.tsx
- src/app/settings/loading.tsx
- src/app/settings/error.tsx
- src/features/settings/SettingsEntry.tsx
- tests/unit/settings/integration/identity.test.ts
- tests/unit/settings/integration/settings-entry.spec.ts
- tests/unit/settings/integration/playwright.config.ts
- tests/unit/settings/integration/seed.ts
- tests/unit/settings/integration/README.md

允许解除冻结并最小修改：
- src/features/settings/SettingsPanel.tsx
- src/features/settings/types.ts
- src/features/settings/StoreSettings.tsx
- src/features/settings/data-sources/DataSourcePanel.tsx

其他原35源/测试保持原SHA。既有SettingsPanel默认行为及组件测试不应悄悄改变；新增受控参数可用于本首批入口仅显示本次获准tab。若有实际技术必要新增/改别的文件，先列准确路径和原因交04，不自行扩白名单。

证据只允许在 tests/unit/settings/integration/evidence/ 新建本轮日志、截图、命令退出码、哈希清单、候选diff及交接README；不覆盖旧组件证据。运行环境、构建产物、数据库仅放本轮独立/tmp，不在主副本运行生成客户端、pnpm安装、构建或类型增量；主副本仅以上代码/测试文件可写。不改依赖/lockfile/根配置/全局样式/共享layout/首页/login/其他路由、API/services/schema/worker/auth，亦不改任何管理/计划/进度或Git。Z02须避开本新增settings路由目录及以上四个既有B01专属目录，不暂存提交B01在途文件。

## 接入行为与质量底线

1. 服务端页面权限复用现有getSessionContext/访问能力与真实会话；未登录去现有/login（只允许安全本地返回路径，如现有login不支持则提供明确登录入口，不改共享login）。O/A进入；P/C及失去成员资格不得得到设置数据、资源名或短暂敏感渲染。页面导航遵原URL tab合同，非法tab安全回默认；无假入口指向未实现导入/AI/成员页面。
2. 复用组织、店铺和数据源既有组件/API，串起建店→进入数据源→建源→刷新可读。创建成功只表示实体已创建，不表示平台已连接/已导入/已计算/AI已完成。真实表单与既有冲突/校验响应，空数据/无权限/网络错误可解释；Mock必须持续标示演示且服从演示店铺限制。
3. SettingsEntry/组合父层按userId+activeOrgId+role/授权变化完整卸载旧表单、列表、选择和请求；切组织/跨标签回页/重新登录/失权不展示旧组织信息或把旧表单提交到新组织。页面守卫不能代替服务端每次授权；客户端预检不声称原子授权。保留组件已有abort/重读/不自动重试写入约束。
4. data-sources入口需要店铺选择、覆盖日期与现有查询相符；URL中store_id/from/to按原03约定合法校验，任何URL指定店铺必须由当前组织真实API核验，不推断可见性。保存/切tab后可合理接续，跨组织先清除旧筛选。
5. 本轮不实现店铺编辑/归档（listStores缺row_version的明确接口前置，留原027后续，不假完成）、成员邀请管理页面（现有组件保持冻结，后续须真实Admin可见/可管理角色核验）、AI设置（017/019/020/021依赖）、导入恢复（任务状态响应/任务列表/模板/retry缺口）。这些是本切片未覆盖项，非缩减原P0或首批最终验收。不得为满足本轮造新后端或改原Gate结论。

## 独立并行环境及验收

先核对actual HEAD与四个可修改源的旧SHA，保存本切片差异基线。测试从固定6cfa36d git archive + 原35组件 + 本白名单候选制作独立/tmp快照，禁止从Z02正修改的后端混合取文件；无Git worktree/分支/commit。使用本轮新PG17（端口先检查冲突，仅127.0.0.1）及本轮独立Web/浏览器上下文，环境变量/密钥只用公开或合成测试值。全链走真实Better Auth Cookie/API/数据库；不用route.fulfill代替核心正负例。不得接触Z02/Codex其他临时库/服务器。

有效验收至少含：O/A登录并访问设置、组织信息读取、建店→建源→刷新真实存在；匿名直接URL不返回设置内容；P/C直接URL拒绝与POST403对照；不同组织店铺不泄露；跨标签组织切换/用户切换/失权后旧表单与响应清除；服务端409/422/失败后不误报成功或自动重复提交；Mock/归档店铺源限制按原API；390/1280真实页面截图和可操作性；生产构建、非增量tsc及受影响旧组件回归。数据库种子可直接准备权限/组织/归档等前提，动作需经真实请求。只跑相称检查，不重复不变全套或声称所有P0通过。

发现真实API阻塞时给具体请求/期望/实际/证据，由04协调Z02在其TASK处理；B01不能扩写后端。可以完成不依赖该缺口的页面片段并准确标未通过项。

## 汇合与交接

B01完成即冻结：列新建/修改逐文件SHA、基线、真实命令/退出码/截图、已测未测、环境和清理证据，发送04。该轮只证明基线6cfa36d上的限定页面切片；Z02本轮候选冻结并经独审后，04在一致新快照合并两个切片再检验页面/API兼容。04安排唯一Git集成人，B01不自行提交。TASK026/027整体与MVP端到端/Owner验收/部署仍另记。
```
