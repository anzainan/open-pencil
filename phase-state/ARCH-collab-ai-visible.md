# ARCH-collab-ai-visible：AI（an-design 经 MCP）编辑画布，用户浏览器实时看不到

- 角色：architect（只读诊断，未改任何代码）
- 日期：2026-08-18
- 范围：仅「AI 编辑 → 用户浏览器实时可见」链路；保存/autosave 互相覆盖问题另见 ARCH-collab-save-flush.md，本文不展开。
- 方法：纯源码静态分析（未跑 CLI/bun、未找 .fig）。所有结论均给出 file:line 证据。

---

## 1. 结论先行

**断点在「MCP server ↔ 浏览器」这一环：本部署里浏览器从未向 MCP server register，`/health = no_app` 恒成立。**

MCP server 的 `hybridSendRPC`（packages/mcp/src/server.ts:326-340）设计是「浏览器在线 → 把工具 RPC 发给用户浏览器内存画布；离线 → 落 Node headless 会话」。由于 register 链路在 web 生产模式断掉（见 §4），**所有 AI 编辑都走了 headless Node 后端：只存在于 MCP server 进程内的一份独立内存 SceneGraph，靠 REQ-7 每 3s `save_file` 写盘**。用户浏览器既收不到 Yjs/awareness 广播（Yjs 只活在每个浏览器 tab 里），磁盘变更的 SSE 自动重载又被「防丢守卫」结构性抑制 → 只有手动 F5 重新读盘才看得到。

一句话：**AI 编辑没有进「官方在线通道」（浏览器内存 apply + Yjs 广播），而是全部落进了「headless 纯磁盘通道」**；根因是 web 模式取 MCP token 的 config 请求没带登录态，`/api/v1/config` 对未认证请求不下发 `mcpAuthToken/mcpWsPath`。

---

## 2. 数据流（AI set_fill → 用户浏览器）

### 步骤总览

| # | 环节 | file:line | 输入 → 输出 |
|---|------|-----------|-------------|
| 1 | an-design op-mcp.py | （外部脚本，不在 repo） | MCP tool call `set_fill` → HTTPS POST `/Mobai/mcp`（nginx 反代到容器 :8080） |
| 2 | file-bridge 反代 /mcp | custom/file-bridge/server.ts:1455-1468 | 原样转发给上游 MCP server（loopback，端口由 `MCP_PORT` 决定，实测部署为容器内 8082/7600） |
| 3 | MCP tool 包装层 | packages/mcp/src/tool/registration.ts:132-197 | 拆出 `document_id/page_id`（automationTargetSchema :102-119），组 `{command:'tool', args:{name, args}}` → `sendRPC`（=hybridSendRPC） |
| 4 | **分支点** | packages/mcp/src/server.ts:326-340 | `browserRPC.isConnected()`？是→步骤 A；否→步骤 B（**本部署恒为否**） |
| A1 | WS 发给浏览器 | packages/mcp/src/browser-rpc.ts:167-200 | `{type:'request', id, command, args}` → 已 register 的 browserWs |
| A2 | 浏览器收包执行 | src/app/automation/bridge/server.ts:76-101 | `handleRequest(id, command, args)` |
| A3 | 目标解析（tab） | src/app/automation/bridge/handlers.ts:44-66；target.ts:85-115 | `document_id`→`getTabById`，缺省用 active tab → 拿到用户**当前打开的 tab store** |
| A4 | apply 到内存画布 | src/app/automation/bridge/tool-handlers.ts:9-21；apply.ts:170-239 | `def.execute(figma, args)` 直接改活 SceneGraph + computeAllLayouts + requestRender + flash；`undo:true`（入栈 "AI: set_fill"，apply.ts:137-161）+ `journal:true`（防丢日志 apply.ts:129-135） |
| A5 | **Yjs 广播** | src/app/collab/session.ts:227-236；yjs-sync.ts:63-74,142-175 | graph mutation → editor event `node:updated` → `syncNodeToYjs` → Y.Doc transact → Trystero 房间广播。**本 tab 用户立即看到（图就是被改的内存图），其他协作者经 Yjs 秒见** |
| A6 | 落盘 | src/app/document/io/write.ts:31-47 | 后续 autosave PUT file-bridge → 磁盘；journal 水位清空（write.ts:43-46） |
| B1 | Node headless 会话 | packages/mcp/src/node-rpc-backend.ts:342-362,185-209,101-131 | `resolveSession`：显式 `document_id` / default session / mcpRoot **顶层**第一个 .fig（readdir 非递归 :117）→ 进程内独立内存图（open_file 时从磁盘加载 :74-89） |
| B2 | （无广播） | — | Node 会话与 Yjs/awareness/SSE **零耦合**；浏览器对此一无所知 |
| B3 | REQ-7 周期落盘 | custom/file-bridge/mcp-proxy.ts:126-138 | `browserSockets===0` 时每 3s POST `/rpc {command:'save_file'}` → node-rpc-backend handleSave writeFile（node-rpc-backend.ts:275-294）→ **仅磁盘更新** |
| B4 | （次级、非实时）磁盘→tab 自动重载 | custom/file-bridge/server.ts:389-395；lib/events.ts:72-120；src/app/bridge/client.ts:601-666；document/io/watch.ts:36-41；read.ts:93-168 | FileWatcher（仅 manifest 登记文件）→ SSE `file.changed` → 打开该文件的 tab `watchPath` → `reloadFromDisk` **整文档重建 + toast**。但守卫见 §4-次级，协作场景基本被抑制 |

### a. AI 的 MCP 编辑是直接改磁盘，还是进了 Yjs/awareness？

**本部署：纯「headless 内存图 + 周期写盘」，完全不进 Yjs/awareness。**
Yjs/awareness 通道只存在于浏览器 tab 内部（src/app/collab/session.ts:154-237），MCP server 侧没有任何 Y.Doc。官方设计里 AI 编辑**可以**进内存画布从而触发 Yjs 广播——但前提是步骤 A 的「浏览器已 register」。该前提在本部署不成立，所以实测 = 纯磁盘路径。「刷新后才看到」与 B1-B4 完全自洽：F5 = 全新读盘（readReloadSource/openFigFile），绕过所有内存态。

### b. MCP server ↔ 浏览器连接现在建立了吗？条件是什么？

**未建立。** `/health = no_app` ⇔ `browserRPC.isConnected()` 为 false（packages/mcp/src/server.ts:134-141；browser-rpc.ts:77-79：需 browserWs 已连且 register 成功）。

web 生产模式建立连接的完整条件链（**当前在第 2 步断掉**）：
1. 容器 `MCP_AUTH_TOKEN` 非空 → file-bridge spawn 上游 MCP server，`/api/v1/config` 才可能带 mcp 字段（server.ts:416-417,1427-1429；docker-compose.yml `MCP_AUTH_TOKEN`）。
2. **浏览器登录态**：`sessionUser(request)` 从 `Authorization: Bearer <session-token>` 解析用户（custom/file-bridge/server.ts:298-303）；未认证 → config 只回 `{token:null, pexelsKey:null}`，**无 mcpAuthToken/mcpWsPath**（server.ts:1408-1414）。
3. `mcpProxy.isReady()`（上游健康）才附带下发（server.ts:1427）。
4. 浏览器侧：`resolveWebMCPHandle()` fetch `/api/v1/config`（spawn.ts:390-413）拿到 token+wsPath → EditorView onMounted `connectAutomation(..., {wsPath})`（src/views/EditorView.vue:268-281）。
5. WS 连 `${origin}/ws`（bridge/server.ts:21；file-bridge `/ws` upgrade server.ts:1470-1476 → mcp-proxy.pipe mcp-proxy.ts:244-287）→ onopen 发 `{type:'register', token}`（bridge/server.ts:71-74）→ `registerBrowser` 校验 token、置 browserWs/browserRegistered（browser-rpc.ts:217-241）。
6. nginx 必须对 `/Mobai/ws` 带 WebSocket Upgrade 头反代（生产 nginx 配置不在 repo，**需部署侧确认**；HTTP 的 /health 通不代表 WS 通）。

### c. 用户浏览器在线时，AI 编辑是否走「apply 内存链 + autosave 落盘」？为何实测没生效？

**设计上会，代码全链路已存在且是官方通道（步骤 A1-A6）**：applyAutomationTool 改活图、入 undo（"AI: <tool>"）、写防丢 journal；graph event → Yjs 广播；autosave 覆盖落盘并清 journal（write.ts:43-46）。
**实测没生效的原因只有一个：register 从未成功（§b 第 2 步），`hybridSendRPC` 永远走 B 分支。** 浏览器在线与否对 AI 路由毫无影响——因为「在线」的判据不是 SSE/presence，而是 MCP WS register（mcp-proxy.ts:74-75 的 `browserSockets` 同理只统计 /ws 连接数）。

### d. 浏览器离线/headless 时，AI 编辑下次打开能否看到？

**能，已成立且被用户实测证实。** Node 会话 open_file 时从磁盘加载（node-rpc-backend.ts:74-89），工具改内存图，REQ-7 每 3s save_file writeFile 落盘（mcp-proxy.ts:126-138；node-rpc-backend.ts:284-288）。任何全新打开（F5/重开 tab）都从磁盘读 → 可见。注意：若 AI 从未 open_file/new_document（无 session、无 filePath），save_file 会静默失败（mcp-proxy.ts:131-136 注释明示忽略错误）——an-design 流程里通常先 list_documents/open_file，故实测落盘成功。

---

## 3. 关键文件清单

| 路径 | 职责（一句话） |
|------|----------------|
| packages/mcp/src/server.ts | MCP HTTP+WS server；`hybridSendRPC` 浏览器优先/Node 兜底的分支点（:326-340）；/health no_app 判定（:134-141） |
| packages/mcp/src/browser-rpc.ts | 浏览器 register/RPC 桥：isConnected、sendRPC、registerBrowser token 校验 |
| packages/mcp/src/node-rpc-backend.ts | headless Node 编辑会话（独立内存 SceneGraph + save_file 写盘），**无广播能力** |
| packages/mcp/src/tool/registration.ts | 110+ canvas ToolDef → MCP tool；document_id/page_id 透传；save_file/open_file/new_document/batch |
| custom/file-bridge/server.ts | 容器桥接服务：/mcp、/ws 反代（:1455-1476）、/api/v1/config 登录态门控（:1408-1431）、FileWatcher→SSE（:389-398） |
| custom/file-bridge/mcp-proxy.ts | spawn 上游 MCP server；REQ-6 自动重启；**REQ-7 headless 3s save_file**（:126-138）；/ws pipe + browserSockets 计数（:244-296） |
| src/app/automation/mcp/spawn.ts | 浏览器侧 MCP server 发现：web 生产 `resolveWebMCPHandle` 取 config token/wsPath（**断点所在，:390-413**）；Tauri spawn 路径 |
| src/views/EditorView.vue | onMounted 里按 `mcp?.wsPath` 决定是否 connectAutomation（:268-281）；只读态 sceneVersion 拦截回滚（:214-231） |
| src/app/automation/bridge/server.ts | 浏览器 WS register + RPC 执行入口（connectAutomation，:15-133） |
| src/app/automation/bridge/handlers.ts / target.ts / tool-handlers.ts / apply.ts | RPC→tab 解析、applyAutomationTool（undo+journal+layout+render）、AI 活跃窗口/flush 守卫（apply.ts:41-82） |
| src/app/collab/session.ts / yjs-sync.ts | Y.Doc/awareness 房间会话；graph event↔Yjs 双向同步（人-人协作生效的通道，也是 AI 在线路径要复用的广播器） |
| src/app/document/io/watch.ts / read.ts / write.ts / source-state.ts | 打开文档后 watchPath 订阅 SSE file.changed；reloadFromDisk 全套防丢守卫；写盘 + markAIOpFlushComplete；bindingDocumentId 进房信号（REQ-1，source-state.ts:15,39-42） |
| src/app/bridge/client.ts | BridgeClient：SSE 订阅、watchPath 重载触发与自写 echo 水印（:601-666）、putFile |

---

## 4. 问题定位（精确位置 + 为什么实时看不到）

### 主根因（断点）
**src/app/automation/mcp/spawn.ts:390-413 × custom/file-bridge/server.ts:1408-1414**

- `resolveWebMCPHandle()`：`fetch('/api/v1/config', { signal })` —— **不带任何 Authorization 头**（spawn.ts:394）。
- `/api/v1/config`：`const user = sessionUser(request)`，而 sessionUser 只认 `Authorization: Bearer <session-token>`（server.ts:298-303）；未认证直接返回最小配置 `{token:null, pexelsKey:null}`（server.ts:1412-1414），**不含 mcpAuthToken/mcpWsPath**。
- 连锁：config 无 mcp 字段 → resolveWebMCPHandle 重试 5 次后返回 null（spawn.ts:410-412）→ EditorView.vue:275 `mcp?.wsPath` 为 undefined → **connectAutomation 永不调用** → 浏览器从不发 register → browser-rpc.ts:77 isConnected()=false → server.ts:327 hybridSendRPC 恒走 nodeBackend。
- 与历史实测吻合：08-17 `/health = no_app`；08-18 AI set_fill「成功落盘、实时不可见」= B 通道行为特征。

### 次级因素（为何连「磁盘变了自动重载」都救不了）
即使 SSE `file.changed` 到达打开该文件的 tab，`reloadFromDisk` 的防丢守卫在协作场景下结构性抑制整文档重建：
- src/app/document/io/read.ts:133 —— `savedVersion < sceneVersion`（内存有未落盘改动即跳过；**Yjs 远端应用 human 编辑也会 bump sceneVersion**，活跃协作时几乎恒真）；
- read.ts:136-139 —— AI 活跃窗口 10s；read.ts:143-146 + apply.ts:80-82 + write.ts:46 —— **每次 bridge 写盘（含 autosave）后 10s flush guard**；
- src/app/bridge/client.ts:617-620 —— 自写 echo mtime 水印 + 本地 1s 内写过即跳过。
这些守卫是防「旧磁盘覆盖新内存」的正确设计，不是 bug——它恰恰说明「磁盘重载」不该作为 AI 实时可见的主通道；主通道应是官方在线路径（步骤 A）。

### 附带风险点（修主根因后要一并处理/确认）
1. **无 tab 时 connectAutomation 会崩**：`watchGraphReplacements()` 立即 `getStore()`（bridge/server.ts:52-55），而 `getActiveStore()` 在无 active tab 时 throw（src/app/tabs/index.ts:95-99）。若 EditorView 先于首个 tab 挂载，register 直接失败且无重连。
2. **document_id 命名空间不一致**：Node 会话 id = `file:<绝对路径>`（node-rpc-backend.ts:63-65），浏览器 tab id = 随机 tab id（target.ts:109）。AI 在 headless 期拿到的 document_id，浏览器上线后回传会「Document not found」（该错误是真实工具错误，hybridSendRPC 会原样上抛 server.ts:330-334）——可接受但需 AI 侧重取 list_documents。
3. **只读共享视图**：readOnly tab 会把 sceneVersion 变化拦截 + undo（EditorView.vue:214-231），AI 编辑会被回滚；owner 自己的工作区 tab 不受影响，本场景不触发，留档即可。
4. **nginx /ws Upgrade**：生产 nginx 配置不在 repo，需确认 `/Mobai/ws` 带 `Upgrade/Connection` 头反代（否则 register 的 WS 握手失败，主根因修了也连不上）。

---

## 5. 修复方向

### 方案 A（推荐）：打通官方在线通道——让 web 模式浏览器正常 register
**改法**：`resolveWebMCPHandle()` 取 config 时带上会话 token；并确保 `restoreSession()` 先于 `spawnMCPIfNeeded()` 完成。即 spawn.ts:394 的 fetch 加 `headers: { Authorization: Bearer ${getSessionToken()} }`（token 来自 src/app/auth/session.ts，与 BridgeClient 写接口同一鉴权体系 client.ts:102-106），并在 EditorView onMounted（EditorView.vue:270）前 await restoreSession()。顺手加固 bridge/server.ts:52-55 对「无 tab」的防护（getStore 失败时延后重试而非崩溃）。
**为什么推荐**：完全走官方既有通道——hybridSendRPC→WS→applyAutomationTool→Yjs 广播的代码全链路已存在且被人-人协作验证过同步器可靠；浏览器在线时 AI 编辑 = 直接改用户活图（≤1s 可见）+ Yjs 秒播给其他协作者 + undo/journal/autosave 全套语义自动生效；离线时 headless 兜底原样保留。不发明新机制，符合「官方有现成的用官方」铁律。
**改动面估计**：~15-30 行（spawn.ts 鉴权头 + restoreSession 时序、bridge/server.ts 无 tab 防护），零服务端改动；外加部署侧确认 nginx /ws Upgrade（配置在容器外）。风险低：未登录/游客本就不该拿到 MCP token，行为不变。

### 方案 B（不推荐）：强化磁盘通道——AI headless 写盘后强制唤醒浏览器重载
**改法**：file-bridge watcher 发现「外部写（无自写水印）」且该 path 有在线 presence 时，绕过 read.ts:133/143-146 守卫触发 reloadFromDisk。
**为什么不推荐**：与防丢守卫正面冲突——用户内存有未落盘改动时磁盘并非「更新」而是「分叉」，强制重载必然二选一丢失（用户编辑 or AI 编辑），需要自研合并/冲突策略 = 自己开发奇怪东西；且直接踩进 ARCH-collab-save-flush.md 已识别的保存域雷区。仅当方案 A 因部署限制（如 nginx 无法改）不可行时，作为降级兜底再议。

### 方案 C（备选叠加项）：MCP 侧明确「在线/离线」语义提示
**改法**：an-design/MCP prompt 或 tool 结果里显式告知当前执行的是 browser-live 还是 headless-disk 模式（hybridSendRPC 分支信息可透传到响应），让 AI/用户知道「这次改动实时可见 / 需要刷新」。
**定位**：不改数据面，只改提示面；可与方案 A 叠加（~20-40 行，registration.ts + server.ts），降低沟通成本。优先级低于 A。

---

## 6. 验证方案（方案 A 实施后）

前置：容器 `MCP_AUTH_TOKEN` 已配置；测试账号对目标 .fig 有编辑权限。

1. **config 下发验证**
   - 操作：登录后在浏览器 DevTools 看 `/api/v1/config` 响应，或 `curl -H "Authorization: Bearer <session-token>" .../Mobai/api/v1/config`。
   - 预期：含 `mcpAuthToken` + `mcpWsPath:"/ws"`（未登录请求仍应只回最小配置——回归确认门控未被放宽）。
2. **register 建立验证**
   - 操作：打开工作区 .fig；DevTools Network 看 `/ws` WSS 连接是否 Established；容器侧 `curl .../Mobai/health`。
   - 预期：WSS established（send register）；`/health.status = "ok"`（此前 no_app）。file-bridge 日志有 `[file-bridge] MCP proxy ready`。
3. **核心场景：用户浏览器开着文件，AI 改画布 ≤1s 可见**
   - 操作：an-design 对该文件执行 `set_fill`（如 0:7 → #FF0000）。
   - 预期：≤1s 内画布变色并带 flash 高亮；DevTools Console 无 reload toast；undo 栈出现 "AI: set_fill"；**全程不刷新**。计时口径：MCP tool 返回时刻 vs canvas 重绘（WS RTT + apply，同容器/局域网应远小于 1s）。
4. **Yjs 广播回归（人-AI 混合协作）**
   - 操作：两个浏览器窗口开同一文件（REQ-1 自动同房），再让 AI set_fill。
   - 预期：未触发编辑的第二个窗口**不刷新**即看到变色与远端光标/在线列表正常；反向：人手改色 AI 侧 get_page_tree/set_fill 也能读到新值。
5. **落盘与 REQ-7 行为回归**
   - 操作：AI 编辑后等 autosave；观察容器日志。
   - 预期：autosave PUT 成功、磁盘 .fig 更新（mtime 前进）；浏览器在线期间（browserSockets>0）**不再出现** mcp-proxy 的 3s save_file 刷屏（mcp-proxy.ts:130 跳过条件生效）。
6. **离线兜底负向对照**
   - 操作：关掉所有浏览器 → `/health` 回 no_app；AI set_fill。
   - 预期：≤~4s 内磁盘落盘（REQ-7）；重新打开文件即可见，headless 能力不回退。
7. **工程质量门**
   - `bun run check`、`bun run test:unit` 全绿；涉及 .vue 改动跑 `bun run check:vue`。
