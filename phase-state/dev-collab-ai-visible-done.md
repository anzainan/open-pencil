# dev-collab-ai-visible：方案 A 实施完成（浏览器 register MCP，AI 编辑实时可见）

- 角色：dev
- 日期：2026-08-18
- 基线 HEAD：8be685ab（collab P0+回归修复轮）
- 依据：`phase-state/ARCH-collab-ai-visible.md` §4 主根因 + §5 方案 A

## 改动清单（仅白名单 3 文件，共 ~30 行）

1. **src/app/automation/mcp/spawn.ts** — `resolveWebMCPHandle()`：
   fetch `/api/v1/config` 时携带 `Authorization: Bearer <session-token>`。token 取自
   `@/app/auth/session` 的 `getSessionToken()`（与 BridgeClient 写接口同一鉴权体系，
   client.ts:102-106 同款用法）。**未登录不带该头** → 服务端门控不放宽，游客仍只回
   最小配置（无 mcpAuthToken/mcpWsPath），行为不变。重试循环内每次 attempt 都重新取
   token，restoreSession 稍后才完成也能在后续 attempt 生效。
2. **src/views/EditorView.vue** — onMounted 中 `await restoreSession()` 先于
   `spawnMCPIfNeeded()`（幂等，main.ts/router 已先行启动，此处仅汇合同一 Promise），
   保证 web 生产模式取 config 时 token 就绪。
3. **src/app/automation/bridge/server.ts** — `watchGraphReplacements()` 加固：
   `getStore()`（=getActiveStore）无 active tab 会 throw → 改为 catch 后 500ms 延后
   重试（warn 日志），避免 EditorView 先于首个 tab 挂载时 register 链路崩溃且无重连；
   `disconnect()` 同步清理重试 timer。WS connect/register 本身不受影响。

明确未触碰：collab/session.ts、yjs-sync.ts、room.ts（人-人 Yjs）、node-rpc-backend.ts /
mcp-proxy.ts（headless REQ-7 落盘）、io/write.ts / io/read.ts / autosave/create.ts
（保存链路）、custom/file-bridge/**（服务端）。

## 自测结果

| 项 | 命令/方式 | 结果 |
|---|---|---|
| lint:structure 全仓（含 tests/） | `bun run lint:structure` | **0 errors**，仅基线 2 个 max-lines warning（packages/core/src/layout.ts、src/app/bridge/client.ts），未新增 |
| 类型检查（app tsconfig） | `bunx tsgo --noEmit` | exit 0 |
| vue-tsc（.vue SFC） | `bun run check:vue` | EditorView.vue 无错误；HomeView.vue / ShareGuestView.vue 各 1 个 TS2322 为**基线已有**（本次未改动的文件，类型自包含不相关） |
| collab + mcp-spawn 单测 | `bun test ./tests/engine/app/collab ./tests/engine/tauri/mcp-spawn.test.ts` | **43 pass / 0 fail**（room-roundtrip、server、session-idb-order、bridge-resolve-room、config、room-id、mcp-spawn） |
| mcp 包单测（headless/browser-rpc/auth 回归） | `bun test ./tests/engine/mcp` | 142 pass / 2 fail；**stash 对照 HEAD 同口径 142/2**，失败项为 stdio spawn 环境依赖与 packages/mcp 错误文案断言（app 层改动不可达），非本次引入 |
| yjs-sync 单测 | `bun test ./tests/engine/collab` | 5 pass / 3 fail；**stash 对照 HEAD 同为 5/3**（裸 bun 环境缺 window，createAutosave useEventListener 抛错），环境限制非本次引入 |
| 格式化 | oxfmt 对 3 个改动文件 | 合规（wsURL 三元式 reflow 为同文件既有行的格式归一） |

静态场景核对：
- config fetch 带 Authorization 头（仅登录态；未登录不带 → 门控行为不变）✓
- restoreSession 时序在 EditorView 取 mcp 之前 ✓
- bridge/server.ts 无 tab 时不崩溃（500ms 延后重试路径 + disconnect 清理 timer）✓
- `git status` 改动面仅白名单 3 文件 ✓

## 待验证点（需部署环境，本地无法覆盖）

1. **nginx `/Mobai/ws` Upgrade**：生产 nginx 配置不在 repo；若未带 WebSocket
   Upgrade/Connection 头反代，register 握手仍会失败（ARCH §4-附带风险 4）。HTTP /health
   通不代表 WS 通，需部署侧确认。
2. **容器 `MCP_AUTH_TOKEN`**：必须非空，file-bridge 才会 spawn 上游 MCP server 并在
   config 下发 mcpAuthToken/mcpWsPath（ARCH §b 第 1/3 步）。
3. **端到端冒烟**（按 ARCH §6）：登录后 DevTools 看 `/api/v1/config` 含
   mcpAuthToken+mcpWsPath；打开 .fig 后 WSS established、`/health.status=ok`；an-design
   set_fill ≤1s 画布变色 + undo 栈 "AI: set_fill" + 不刷新；双窗口 Yjs 秒播；浏览器在线
   期间 mcp-proxy 3s save_file 刷屏消失（browserSockets>0 跳过生效）。
4. **document_id 命名空间**：headless 期 AI 拿到的 `file:<绝对路径>` id，浏览器上线后
   回传会 "Document not found"——预期行为，AI 侧重取 list_documents 即可（ARCH §4-2）。

## 回归结论

人-人 Yjs、headless 落盘、autosave/保存链路文件零改动；REQ-1（自动进房）/REQ-4/5
（active 隔离）/REQ-6（MCP 自动重启）所在代码未触碰，collab 回归套件全绿。
