# phase1-server 完成报告

分支 streamline/personal-local，基线 9e27849b。目标：删用户系统/分享/presence 端点 + config 开放 + 清 3 个 TS 错误文件。

## 改动清单

### A. custom/file-bridge/server.ts（1870 → 958 行，-912）
| # | 项 | 处理 |
|---|----|------|
| A1 | `parseCollabIceServers()` | 已删（含注释块） |
| A2 | import 清理 | 删 crypto/auth/notifications/presence/permissions/share/room-id 7 组 import；paths 组内删 `OPENPENCIL_REL_DIR`（仅头像代码用）。保留 design/events/mcp-proxy/mcp/manifest/paths/state |
| A3 | checkAuth session 回退分支 | 已删，仅剩 BRIDGE_TOKEN 校验 |
| A4 | authStore/bearerToken/sessionUser/adminUser | 全部已删 |
| A5 | presence 台账 4 函数（sweepExpiredPresence/startPresenceSweep/reportOnline/getOnline） | 已删 |
| A6 | 初始化块 collabRoomSecret/presence/authStore/permissions/notifications/shares/presenceSweepTimer | 已删；保留 state/bus/manifest/watcher/reconcile |
| A7 | `mcpDeps.resolveActiveUserId` | 改 `() => null`（注释同步更新为单用户口径） |
| A8 | activeReadKey/getActive/setActive | activeReadKey 直接 return null（去参）；getActive 去 request 参数，调用点同步改 `getActive()`；setActive 写侧 userId = activeReadKey() |
| A9 | login/logout/session/members CRUD/avatars×2/permissions×2/notifications×3/share×6 + resolveShareBaseURL/shareView/adminDenied | 整段已删（含模块级 resolveShareBaseURL） |
| A10 | /api/v1/config | 无条件返回完整配置；删未登录分支与 collab 块 |
| A11 | /api/v1/collab/room | 整端点已删 |
| A12 | dispatch auth/members/avatars/permissions/notifications/share 全部路由 | 已删。**清单外补删**：`/api/v1/online` 路由（引用已删的 getOnline/reportOnline/presence，不删则 tsc 报错） |
| A13 | shutdown `clearInterval(presenceSweepTimer)` | 已删 |

残留自查：任务书给定 grep（authStore/sessionUser/adminUser/*Store/deriveRoomId/parseCollabIceServers/collabRoomSecret 等扩展词表）→ **0 命中**。

### B. custom/file-bridge/lib/ 删除 7 文件（-1,151 行）
auth.ts(389) / crypto.ts(51) / notifications.ts(142) / permissions.ts(199) / presence.ts(89) / room-id.ts(26) / share.ts(255)。
保留 design/events/manifest/paths/state 五件；已核实保留文件零 import 指向被删文件。mcp-proxy/mcp/index 一行未动（git status 确认）。

### C. config 开放（AI 写盘令牌自动拿）
- server.ts /api/v1/config：见 A10
- src/app/automation/mcp/spawn.ts：删 getSessionToken import + Authorization header 拼装；重试(5次)/超时(2s AbortSignal)/null 降级逻辑保留；doc 注释同步更新
- src/views/EditorView.vue：删 restoreSession import（保留 currentUser，collab 接线未动）+ onMounted 内 `await restoreSession()`

### D. TS 错误处理表（判定基线 fece63b5）
| 文件:行 | 错误 | git diff fece63b5 归属判定 | 处理 |
|---------|------|---------------------------|------|
| LayerTree.vue:53 | `readOnly` computed 未使用 (TS6133) | **我们加的**（官方基线无此行；同批加的行内 guard 直接用 store.state.readOnly，此 computed 纯冗余） | 删声明 + 移除随之无用的 `computed` import |
| HomeView.vue:54 | Readonly<Ref<readonly StorageDocument[]>> ≠ Ref<StorageDocument[]> (TS2322) | **我们加的**（整个文件为新增文件） | 断言修复：`workspace.documents as Ref<StorageDocument[]>`，vue import 补 `type Ref` |
| FolderView.vue:32,58 | workspaceLabel 未使用 + 同型 readonly 数组错 | **我们加的**（整个文件为新增文件；workspaceLabel 系 usersys 残留） | 删 workspaceLabel + 连带无用的 provider computed 与 storageProviderRegistry import（BRIDGE_STORAGE_PROVIDER 仍被 SSE 过滤用，保留）；documents 断言同 HomeView |

其余 4 个错误按口径不在本轮处理：ProfileSettingsPanel.vue:6 / SharePopover.vue:857 / ShareGuestView.vue:107 / EditorView.vue:372（原 :374，因删 restoreSession 两行上移）。

## 自测结果
1. `bunx tsc --noEmit custom/file-bridge/server.ts`：语义错误 **0**（初查发现 1 处真实错误 getActive(request) 调用点未同步 → 已修；剩余仅环境噪音 TS2867/TS2503 Bun global + import.meta.dir，系沙箱缺 @types/bun，改动前同样存在）。esnext flags 下复核同结论。
2. `bunx vue-tsc --noEmit -p tsconfig.json`：error TS **8 → 4**（≤5 ✓）；余 4 个全部落在 Phase 2/3 待删文件清单内，LayerTree/HomeView/FolderView 归零。
3. 冒烟（本地 bun 起服 :8080，临时目录 + 假 token，已清理）：
   - GET /api/v1/health → `{"ok":true,...}` ✓
   - GET /api/v1/config **无 token** → 完整配置：含 token/pexelsKey/mcpAuthToken/mcpWsPath/mcpHealthPath/mcpMcpPath，**不含 collab** ✓
   - POST /api/v1/files 写鉴权：无 token → 401；Bearer BRIDGE_TOKEN → 201（checkAuth 保留生效）✓
   - 被删端点全部 404：auth/session、auth/login、members、avatars、permissions、notifications、share?path=、collab/room、online ✓

## 待部署验证点
- [ ] 生产容器重启 file-bridge 后：无 token GET /api/v1/config 返回完整配置（AI/MCP 写盘令牌链路）
- [ ] spawnMCPIfNeeded 在 web 生产模式无需登录即可拿到 mcpAuthToken/wsPath（浏览器未登录场景回归）
- [ ] EditorView onMounted 直连 MCP relay 正常（不再依赖 restoreSession 时序）
- [ ] 旧客户端若仍请求 /api/v1/online|share|auth/* → 404 兜底，不阻塞页面（Phase 2 删 UI 前过渡态）
- [ ] src/app/collab/config.ts 拉 config 的 collab 字段将为 undefined → Phase 3 处理传输回退

## 约束遵守
- 只动白名单文件；mcp-proxy/mcp/index/lib{design,events,manifest,paths,state} git status 零改动
- 未 push（仅本地 commit）；未提交任何真实 key/token（冒烟用临时假 token，已清理）
