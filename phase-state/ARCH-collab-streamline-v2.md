# ARCH-collab-streamline-v2：协作功能精简方案 v2（新口径修正版）

- 角色：architect（只写报告，不改代码、不 commit）
- 日期：2026-08-18（新口径于当日 22:02 拍板）
- 基线：anzainan/open-pencil `master` HEAD=`9e27849b`；upstream/master=`4e48420a`；fork 真实上游基线=`fece63b5`（v0.14.0 时代，merge-base）
- v1 报告：`phase-state/ARCH-collab-streamline.md`（301 行）。**v2 = v1 + 新口径修正**，不是重写、没有新分析；collab/ 逐文件归属直接采信第一次评估会话的对比结果。

---

## 1. 新口径确认表

### 1.1 与 v1 的三处差异（用户 2026-08-18 22:02 拍板）

| # | 主题 | v1 旧口径 | v2 新口径 |
|---|------|-----------|-----------|
| 1 | 分享按钮 | 隐藏分享入口、不恢复 CollabPanel | **保留官方原版**：官方 CollabPanel / Trystero P2P 分享保留；删的是我们自研的外链分享（share.json / 游客页 / 密码门） |
| 2 | 多人协作 | 剔除含官方 P2P 栈在内的整段 | **官方多人协作保留**（CollabPanel + Yjs/Trystero 原版）；删的只是「我们加在官方多人上的改造」（自动进房 syncCollabRoom / HMAC 房间派生 / active 按用户隔离 / P0 回归修复 REQ-1~5） |
| 3 | AI 协作三条线 | v1 未单列 | **三条线全部保留**：文件稳定优化、自动保存、AI 协作（MCP relay/watchdog/3s 落盘/register 链路 9e27849b） |

### 1.2 资产三栏分类（新口径落地总览）

| 官方保留（回到官方原版行为） | 自研保留（AI 协作三条线 + 首页概念） | 自研剔除（本次精简的删除对象） |
|---|---|---|
| `src/components/CollabPanel/*`（432 行，官方分享面板：CollabSharePopover/ShareOrJoinRoom/JoinRoomPrompt/ConnectedRoom）——**v1 说删整目录 → v2 保留** | **文件稳定优化批**：原子保存、caret 对比修复、页面背景持久化、原生下载导出、SVG 粘贴导入、WindingRule 归一化、中文支持（字体/i18n）、8位hex、按钮坐标存储、批量不屏闪 reload 守卫、Pexels 图片搜索功能（分页/颜色筛选/真实宽高比/服务端 key 兜底） | **用户系统全套**：登录页/session token/members/permissions/通知中心/头像上传/presence 在线感知/只读拦截+权限申请弹窗 |
| `src/app/collab/context.ts`、`yjs-sync.ts`（与官方基线完全一致，原样保留）；`room/session/types/use/local-awareness/awareness` 的**官方部分（还原后）**；Trystero 信令 + Yjs CRDT 传输层；远程光标画布 overlay（彩色箭头+名字 pill） | **自动保存线**：autosave/beforeunload flush/op-journal 兜底/SSE 自动刷新/watchPath/selfWriteMtime/file-bridge 原子保存 writeFileAtomic+withWriteQueue/FileWatcher+reconcile | **自研外链分享三件套**：ShareGuestView 游客页、bridge/share.ts 客户端、SharePopover（share.json + 密码门）；服务端 share×4 端点 + HMAC 房间派生 `/api/v1/collab/room` + config.collab 下发 + parseCollabIceServers |
| `src/constants.ts`：TRYSTERO_APP_ID / ROOM_ID_LENGTH/CHARS / PEER_COLORS / getShareURL() —— **v1 说删 → v2 保留**（官方 collab 栈全部引用）；`/share/:roomId` 加入路由回到基线状态 | **AI 协作线**：MCP relay（/mcp、/rpc、/ws 反代）、watchdog REQ-6、headless 3s 落盘 REQ-7、浏览器 register 链路（9e27849b：spawn.ts resolveWebMCPHandle + connectAutomation + mcpProxy pipe）、node-rpc-backend save_file | **collab 自研改造**：自动进房 syncCollabRoom 块、awareness avatarImage/avatarBg 字段、local-awareness requestRepaint 改动、REQ-1~5 P0 回归修复、config.ts（自研新增） |
| 官方 SettingsDialog 对话框外壳（回退基线版）+ 官方 AI/模型设置入口 | **首页概念**：HomeView 落地 + FolderView/TrashView + /、/folder/:name、/trash、/editor 路由 + server dirs/pins/trash/recent 端点 + manifest 台账 | **设置四 tab 外壳改造**：ProfileSettingsPanel、TeamSettingsPanel、dialog.ts tab 状态；以及 /Mobai 外网子路径（vite base '/'）、usersys+自研分享相关 i18n 键与测试 |
| — | Docker 部署（Dockerfile/compose env 语义不变） | **/Mobai 外网子路径**（vite base '/'）、usersys+自研分享相关 i18n 键与测试 |

> 大白话总结：v2 的删除面从「用户系统 + 分享 + presence + 整个人协栈」缩小为「用户系统 + 自研分享 + presence + 我们加在官方多人上的改造」。官方 P2P 多人回到 upstream 原版行为——手动点分享生成链接 / 输房间号加入，不再按文件自动进房。

---

## 2. collab/ 逐文件归属判定表（第一次评估会话结果，直接采信、不重查）

基线 = `fece63b5`。图例：✅ = 官方原版保留不动；🔄 = 回退官方版本（`git checkout fece63b5 -- <file>`）；✂️ = 手术式逐处还原；🗑 = 删除。

| 文件 | 归属判定（vs fece63b5） | 操作 | 大白话影响 |
|---|---|---|---|
| `src/app/collab/context.ts` | **与官方基线完全一致**（官方原版） | ✅ 保留，一行不动 | 无。collab 上下文注入层，本来就是官方状态 |
| `src/app/collab/yjs-sync.ts` | **与官方基线完全一致**（官方原版） | ✅ 保留，一行不动 | 无。Yjs CRDT 同步核心，「两人同时编辑不互相覆盖」的地基 |
| `src/app/collab/awareness.ts` | 有差异：我们在官方版上**加了 avatarImage/avatarBg 字段**（自研改造） | 🔄 回退官方版本 | 远端用户信息回到官方的名字+颜色，不再带我们的自定义头像图/背景色。还原后远程光标展示与 upstream 完全一致 |
| `src/app/collab/config.ts` | **官方基线没有此文件**（自研新增：读服务端 config.collab） | 🗑 删除 | 与服务端删 `/api/v1/collab/room` + collab 下发块成对消失（§3.1）。删后 Trystero 用内置默认信令，与 upstream 行为一致 |
| `src/app/collab/local-awareness.ts` | 有差异：我们把 requestRender 改成了 **requestRepaint**（P0 光标刷新修正，自研） | 🔄 回退官方版本（恢复 requestRender） | 远端光标移动回到触发场景重绘（官方行为），不再是纯画布 repaint。若还原后原 P0 问题复发 → 作为「在官方版上重新修」的后续项处理，不混进本次精简 |
| `src/app/collab/room.ts` | 有差异（官方逻辑 + 我们的改造混合） | ✂️ 手术式：逐处还原 | 删自动进房/HMAC 房间派生相关代码，保留官方建房/加入/离开。方法：先 `git diff fece63b5 -- <file>` 看 hunk；自研占比高、拆不清的文件直接 `git checkout fece63b5` 整文件回退 |
| `src/app/collab/session.ts` | 有差异（混合） | ✂️ 手术式：逐处还原 | 同上，保留官方会话管理逻辑，删我们的改造 |
| `src/app/collab/types.ts` | 有差异（混合；含我们加的类型定义如 avatar 字段） | ✂️ 手术式：逐处还原 | 删自研类型、留官方类型。check 会兜住漏网的引用 |
| `src/app/collab/use.ts` | 有差异（含自动进房 syncCollabRoom 相关接线） | ✂️ 手术式：逐处还原 | 回到官方「手动点分享/加入」的交互入口；不再按文件路径自动进房 |

### 2.1 附带归属判定（设置对话框区，2026-08-18 23:21 修正：architect 只查了 settings/ 根目录文件名没递归子目录，误把官方组件判成自研新增；经 `git ls-tree -r fece63b5 src/components/settings/` 核实纠正）

| 文件 | 归属判定 | 操作 | 大白话影响 |
|---|---|---|---|
| `src/components/settings/provider/StockPhotoKeysSection.vue` | **官方基线存在**（官方组件）——我们加了 Pexels 默认 key 配置 | ✅ 保留我们的改动 | Pexels key 默认配置好，打开设置直接可用（用户 23:21 拍板保留） |
| `src/components/settings/storage/StorageSettingsPanel.vue` | **官方基线存在**（官方组件）——我们改成本地 bridge 工作区 + S3 CORS 配置复制 | ✅ 保留我们的版本 | 本地存储信息 + CORS 复制工具照常（用户 23:21 拍板保留） |
| `src/components/settings/vectorize/VectorizeSettingsSection.vue` | **官方基线存在**（官方组件）——仅 +3 行小改 | ✅ 保留 | 矢量化设置照常（用户 23:21 拍板保留） |
| `src/components/settings/SettingsDialog.vue` | 官方基线存在（官方对话框外壳，**自带 ai/media/storage 三 tab**） | 🔄 回退官方版本（删我们加的 profile/team 两个 tab 及其余自研改造；**无需重写无 tab**） | 设置回到官方三 tab 状态；Profile/Team 面板移除，官方 AI/媒体/存储入口恢复 |
| `src/components/settings/profile/ProfileSettingsPanel.vue` | **官方基线没有**（自研） | 🗑 删除 | 个人资料设置面板消失（用户系统，用户 22:02 定删） |
| `src/components/settings/team/TeamSettingsPanel.vue` | **官方基线没有**（自研） | 🗑 删除 | 团队设置面板消失（用户系统，用户 22:02 定删） |

> 注：**白板里的资源/素材搜索面板（Pexels 图片搜索 UI：分页/颜色筛选/真实宽高比）也是我们加的，用户 23:21 拍板保留**——搜索功能代码（packages/core/src/tools/stock-photo.ts）与面板 UI 全部保留，仅服务端 key 走 config.pexelsKey 下发兜底（§4-R1）。
---

## 3. 文件级操作清单（v1 §2 按新口径调整）

图例：🗑 = 整文件删除；🔄 = 回退官方版本（`git checkout fece63b5 -- <file>`）；✂️ = 手术式修改；✅ = 明确不碰。基线锚点 `fece63b5`。

### 3.1 file-bridge 服务端（custom/file-bridge/，= v1 §2.1，collab 相关措辞更新）

| 操作 | 位置 | 说明 / 证据 |
|---|---|---|
| ✂️ | `server.ts:58-74` | 🗑 `parseCollabIceServers()` —— collab ICE 配置解析。v2 注：官方 Trystero 用内置信令，这是自研扩展下发，随 config.collab 一起删 |
| ✂️ | `server.ts:16,17-20,21-26,41` | 删除 import：`decryptPassword`(crypto)、`AuthStore/isAdminRole/User/UserRole`(auth)、`NotificationStore`、`PresenceStore`、`PermissionStore`、`ShareStore/generateRandomPassword/...`、`deriveRoomId`(room-id)。**保留** design/events/mcp-proxy/mcp/manifest/paths/state 的 import |
| ✂️ | `server.ts:281-287` | `checkAuth()` 保留，但删第 285 行 session 回退分支（`if (authStore && sessionUser(request)) return null`）→ 写接口只认 BRIDGE_TOKEN。影响：AI/浏览器写入的鉴权回到 Phase C 之前的「token 单通道」，行为不变 |
| ✂️ | `server.ts:289-310` | 🗑 `authStore` 全局(290)、`bearerToken`(292)、`sessionUser`(298)、`adminUser`(306) |
| ✂️ | `server.ts:312-362` | 🗑 presence 台账清理/心跳：`sweepExpiredPresence`、`startPresenceSweep`、`reportOnline`、`getOnline` |
| ✂️ | `server.ts:369-371,378-386,404-405` | 🗑 初始化块：`collabRoomSecret`(371)、`presence`(379)、`authStore=new AuthStore`(381)、`permissions`(383)、`notifications`(384)、`shares`(386)、`presenceSweepTimer`(405)。**保留** `state`(376)、`bus`(377)、`manifest`(388)、watcher/reconcile(389-402) |
| ✂️ | `server.ts:412` | `mcpDeps.resolveActiveUserId: () => authStore?.getOwnerUserId() ?? null` → 改 `() => null`（active 按用户隔离的删除点：keyFor(null)→primary 回落，lib/state.ts:95-110，行为不变） |
| ✂️ | `server.ts:756-759` | 🗑 `activeReadKey()` 里 sessionUser/authStore 引用 → 直接 `return null`（getActive 落到 primary owner 记录） |
| ✂️ | `server.ts:797-1393` | **整段删除**（≈600 行连续块）：login(797)/logout(814)/session(824)/listMembers(832)/createMember(837)/updateMember(864)/deleteMember(894)/uploadAvatar(942)/serveAvatar(1004)/getPermissions(1031)/createPermissionRequest(1046)/listNotifications(1081)/resolveNotificationAction(1093)/markNotificationsRead(1151)/`resolveShareBaseURL`(1159)/getShare(1207)/createShare(1239)/deleteShare(1278)/verifyShare(1299)/serveShareContent(1323)/generateSharePassword(1342)/upsertFilePermission(1350) |
| ✂️ | `server.ts:1408-1431` | `/api/v1/config`：删 1411-1414 的「未登录最小配置」分支和 `sessionUser(request)`，**无条件返回完整配置**（token/pexelsKey/mcp 字段）；同时删除 1421-1426 的 `collab:{...}` 块（自研房间派生下发，官方 Trystero 不依赖）。详见 §4-R1 |
| ✂️ | `server.ts:1433-1452` | 🗑 `/api/v1/collab/room` —— **新口径 #2「HMAC 房间派生」的删除点**（自研：按文件 HMAC 派生房间号 + permissions.resolvePermission 校验）。官方 P2P 分享不走此端点，Trystero 用内置信令 |
| ✂️ | `server.ts:1687-1818` | dispatch 删除：auth/login\|logout\|session(1689-1702)、members(1704,1724-1738)、avatars(1742-1754)、permissions/permission-request(1756-1766)、notifications×3(1770-1787)、share×4(1791-1818) |
| ✂️ | `server.ts:1851` | shutdown 里删 `clearInterval(presenceSweepTimer)` |
| ✅ | `server.ts:202-235`（writeFileAtomic/withWriteQueue）、1404 health、1455-1492 MCP 反代(/mcp /rpc /health + OPTIONS)、1470 `/ws` upgrade、1478 mcpPath 桥接工具、1494-1685 files/fonts/events(SSE)/active/recent/dirs/pins/trash×3/rename/move/meta/file 全部读写端点、1820+ 静态托管 | **保留清单：自动保存线（原子保存/SSE/journal 兜底）与 AI 协作线（MCP relay）的地基，一行不动**（新口径 #3） |
| 🗑 | `lib/auth.ts`、`lib/notifications.ts`、`lib/presence.ts`、`lib/permissions.ts`、`lib/share.ts`、`lib/room-id.ts`(26)、`lib/crypto.ts`(51) —— 合计 **1,151 行** | usersys 台账全套。注意 `lib/state.ts`（active/recent，含 activeByUser）**保留不动**：keyFor(null)→primary 天然兼容无账号模式（state.ts:95-110）；「按用户隔离」的删除只发生在 server.ts 引用侧（412/756-759） |
| ✅ | `mcp-proxy.ts`、`mcp.ts`、`index.ts`、`lib/{design,events,manifest,paths,state}.ts` | MCP watchdog(REQ-6, mcp-proxy.ts:140-155)、headless 3s save_file(REQ-7, mcp-proxy.ts:126-138) **零改动**（新口径 #3 AI 协作线） |

### 3.2 App：用户系统（src/，= v1 §2.2，设置区按 v2 修正）

| 操作 | 位置 | 说明 |
|---|---|---|
| 🗑 | `src/views/LoginView.vue`(119)、`src/app/auth/session.ts`(152)、`src/app/auth/logout-dialog.ts`(12) | 登录页 + session token 全套（剔除项 #1） |
| ✂️ | `src/router.ts:3,7,8,16,26-32,39-47` | 删自研路由 `/login`(16)、`/share/:token(\w{32})`(26，游客页)、`/:shareToken(\w{6,32})`(32) + LoginView/ShareGuestView import；**`/share/:roomId`(28) 按官方基线状态处理（v2 修正：新口径 #1/#2 下这是官方 P2P 加入链接的路由，不再一刀删）**——对照 `git show fece63b5:src/router.ts` 逐 hunk：基线有对应处理 → 🔄 恢复；基线没有 → 分享交互退化为 CollabPanel JoinRoomPrompt「手动输房间号」，此路由随 ShareGuestView 一起删。beforeEach(39-47) 登录守卫整体删除（无 session 概念后守卫没有存在意义）。**保留** `/`、`/folder/:name`、`/trash`、`/editor`、`/storage→/` redirect、`/demo` |
| ✂️ | `src/App.vue:7,11,31,44` | 删 `restoreSession()` import+调用、`LogoutDialog` import+模板节点 |
| ✂️ | `src/main.ts:5,30-33` | 删启动时 `await restoreSession()`（B2 时序依赖随之消失） |
| 🗑 | `src/app/notifications/index.ts`(1)+`store.ts`(49)、`src/components/workspace/NotifyBell.vue`(227) | 通知中心（剔除项 #1） |
| ✂️ | `src/components/workspace/WorkspaceTopBar.vue:7,116` | 删 NotifyBell import+模板。设置按钮(108-115)去留见 §4-R4 决策点 D2 |
| 🗑 | `src/app/editor/readonly.ts`(15)、`src/components/editor/PermissionRequestDialog.vue`(64) | Phase B 只读拦截 + 权限申请弹窗（剔除项 #1「权限拦截」）。upstream EditorView 完全没有 readOnly 概念，整块自研，删得干净 |
| ✂️ | `src/app/editor/session/types.ts:17,38`、`modules.ts:72-73`、`src/app/tabs/index.ts`(readOnly 接线) | 删 editor state 的 `readOnly` 字段及「无编辑权限→只读」打开逻辑。影响：个人模式永远可编辑，这正是收拢目标 |
| 🗑🔄✂️ | **设置区（2026-08-18 23:21 修正）**：🗑 `src/components/settings/profile/ProfileSettingsPanel.vue`(273) + `team/TeamSettingsPanel.vue`(465)；🔄 `SettingsDialog.vue` **回退官方基线版本**（官方自带 ai/media/storage 三 tab，删我们加的 profile/team tab 即可，**不重写无 tab**）；✅ **StockPhotoKeysSection.vue / StorageSettingsPanel.vue / VectorizeSettingsSection.vue 保留我们的改动**（三者都是官方组件，我们加的内容用户 23:21 拍板保留：Pexels 默认 key / 本地 bridge+S3 CORS / +3 小改） | 剔除项 #1「设置四tab」。大白话：设置页回官方三 tab 样子，Profile/Team 两个自研面板删掉；Pexels 默认配置好、存储面板、矢量化设置照常（用户 23:21 确认） |
| ✂️ | `src/app/settings/dialog.ts`(26) | 重写为无 tab 状态：删 `settingsDirty/setSettingsDirty`、四 tab section 枚举（profile/team/media/storage）中的自研部分，**保留官方三 tab（ai/media/storage）语义**；`team-store.ts`(184)、`useAvatarURL.ts`(70) 🗑 |
| ✂️ | `src/views/FolderView.vue:25,321` + 周边权限 UI | 删 AccessDialog（文件夹访问申请，依赖 permissions.json）。**保留** FolderView 本体 + 重命名/移动/新建提示框（首页概念的地面设施） |
| ✂️ | `src/app/shell/menu/schema.ts`(±7)、`app-menu.ts`(±21) | 回退用户系统相关菜单项改动（对照 fece63b5 diff 逐条还原）；连带更新 `tests/engine/app/shell/menu/schema.test.ts` |
### 3.3 App：多人分享外链 + 游客页（剔除项 #2，自研部分；= v1 §2.3，末行按新口径改）

| 操作 | 位置 |
|---|---|
| 🗑 | `src/views/ShareGuestView.vue`(405)、`src/app/bridge/share.ts`(274，share link 客户端)、`src/components/workspace/SharePopover.vue`(880) —— **自研外链分享三件套**（share.json + 游客页 + 密码门），新口径 #1 下删除 |
| ✂️ | `src/views/EditorView.vue:38,151-174,360`（SharePopover import、`shareAccessible` watch(走 getPermissions)、模板行）；`src/app/bridge/client.ts:323(getPermissions),332(requestPermission)` 及 `BridgePermission` 类型 |
| ✅ | **官方 `CollabPanel/*` 保留**（v2 新口径 #1/#2 修正：v1 写「不恢复」→ 现按官方原版保留，作为 P2P 分享入口）。其后端 Trystero P2P 栈一并保留（§3.5），面板不是空壳。大白话：桌面顶栏的分享按钮回到官方行为——点一下生成 P2P 房间链接给同事，或输房间号加入 |

### 3.4 App：头像上传 + 在线感知（剔除项 #3；= v1 §2.4，不变）

| 操作 | 位置 |
|---|---|
| 🗑 | `src/app/presence/use.ts`(96)（8s 心跳 + SSE online.changed）、server 侧 `/api/v1/online` GET/POST(server.ts:1545-1557) + PresenceStore(§3.1) |
| ✂️ | `src/views/EditorView.vue:23,73-84`（`useDocumentPresence` import、presencePath watch、`provideCollabPanel(onlineUsers)`）；`MobileHud/MobilePresencePopover.vue`(85)+`MobileShareButton.vue`(15) 🗑，`MobileHud/context.ts`+`MobileHud.vue` 的 onlineUsers prop 清理 |
| ✂️ | `src/app/bridge/client.ts:471(reportOnline),488(getOnline)` + `BridgePresenceUser` 类型 |

> v2 注：presence（服务端 SSE「谁在线」台账）是我们在官方多人之外另加的一层，与 Yjs awareness 无关，照删。MobileShareButton 随在线感知移除（v1 决策不变）；桌面官方分享入口按 §3.5 保留——将来若也要移动端 P2P 分享，恢复该按钮并接到官方 CollabPanel 即可。

### 3.5 App：人-人实时协作（**v2 整段重写**：官方 P2P 栈保留 + 我们加的改造还原）

| 操作 | 位置 | 说明 / 大白话影响 |
|---|---|---|
| ✅ | `src/app/collab/context.ts`、`yjs-sync.ts` | 与官方基线完全一致，一行不动（§2）。Yjs CRDT + 上下文注入是官方多人协作的地基 |
| 🔄 | `src/app/collab/awareness.ts` | 回退官方版本：删我们加的 avatarImage/avatarBg。远端光标回到官方「名字+颜色」展示 |
| 🗑 | `src/app/collab/config.ts` | 自研新增，删除；与服务端 config.collab 块 + `/api/v1/collab/room`（§3.1）成对消失。Trystero 用内置信令，与 upstream 一致 |
| 🔄 | `src/app/collab/local-awareness.ts` | 回退官方版本：requestRepaint → requestRender。P0 光标刷新修正是自研改造，还原后若问题复发走后续项（§2） |
| ✂️ | `src/app/collab/room.ts` / `session.ts` / `types.ts` / `use.ts` | **逐处还原**：删自动进房/HMAC 房间派生/per-user 相关改造，保留官方建房/加入/离开/会话管理。先 `git diff fece63b5 -- <file>` 看 hunk；拆不清的整文件 `git checkout fece63b5`（§2） |
| ✅ | `src/components/CollabPanel/` **整目录保留**（432 行：CollabSharePopover/ShareOrJoinRoom/JoinRoomPrompt/ConnectedRoom） | v1 说删整目录 → v2 改为官方原版保留。P2P 分享入口、加入提示、已连接房间状态全部可用，零改动 |
| ✂️ | `src/views/EditorView.vue` collab 相关（:12-13,36-37,68-69,86-149,359） | **保留**官方接线：useCollab import、provide(COLLAB_KEY)、模板 CollabAvatarStack + 分享入口行 → 按 `git show fece63b5:src/views/EditorView.vue` 恢复基线状态；**删除**自研 `syncCollabRoom` 自动进房全块(86-149) + getCollabConfig import。大白话：从「打开文件就自动拉人进同一个房间」回到官方「手动点分享 / 输房间号加入」 |
| ✂️→✅ | `src/app/editor/canvas/collaboration-awareness.ts`(16) + `src/components/EditorCanvas.vue:24,26,36,40`（updateCursor，远程光标喂画布 overlay 的入口） | 对照 fece63b5 判归属：基线存在且一致 → ✅ 保留（远程光标渲染是官方能力，Figma 式彩色箭头+白边+名字 pill）；有我们的改动 → 🔄 回退基线版本。v1 随整栈删除 → v2 按基线状态恢复 |
| ✂️→✅ | `src/constants.ts`：TRYSTERO_APP_ID(71)、ROOM_ID_LENGTH/CHARS(72-73)、PEER_COLORS(~93-105)、getShareURL()(76-81) | **保留**（v1 说删 → v2 改留）：官方 collab 栈与 P2P 链接生成全部引用它们。仅当还原后 check 报 unused 才清理 |
| ✂️ | `src/app/collab/config.ts` 读取的 config.collab 字段由 server 侧删除（§3.1，server.ts:1421-1426）；docker-compose 无 COLLAB_* env，无需动 | 自研房间派生下发链路整体消失；官方 P2P 不依赖容器侧任何新端点/端口 |

### 3.6 /Mobai 外网子路径（剔除项 #5；= v1 §2.6，getShareURL 措辞更新）

| 操作 | 位置 | 说明 |
|---|---|---|
| ✂️ | `vite.config.ts:21-23` | `base: '/Mobai/'` → `'/'`（核心一刀，其余多为自动回落） |
| ✂️ | `vite/pwa.ts` | manifest 去前缀：`navigateFallback:'/index.html'`、`start_url:'/'`、`scope:'/'`、icons `/pwa-*.png` |
| ✅ | `packages/core/src/canvaskit.ts:15-26`、`vite/canvaskit-assets.ts` | **不用改**：两者都是读 `BASE_URL`/`server.config.base` 的通用逻辑，base 回 '/' 后自动无前缀（73b5db05 的 guard 修复保留） |
| ✅ | `index.html`（%BASE_URL% 占位）、AppMenu.vue:59 / EditorView.vue:175 图标 BASE_URL 前缀；**getShareURL() 随 §3.5 保留**（v2 修正：官方 P2P 分享链接生成入口，base 回 '/' 后 %BASE_URL% 自动回落，写法不用动） | — |
| ✂️ | `docker-compose.yml`：删 `PASSWORD_ENC_KEY` env + 注释块（usersys 密码加密专用）；`Dockerfile` 不动 | NPM 反代（location /Mobai/ 剥前缀）**外部运维项**：收拢后软路由改回根路径直通容器即可，本报告不操作、仅提示 |

### 3.7 i18n + 测试（= v1 §2.7，collab 测试按归属判定）

| 操作 | 位置 |
|---|---|
| ✂️ | `packages/vue/src/i18n/messages/dialogs.ts`(+201)、`panels.ts`(+6)；8 locale × (`dialogs.json`,`panels.json`)（de/es/fr/it/ja/pl/ru/zh-cn）：删除 login/members/permissions/notifications/share 密码/profile/team 等 usersys+自研分享键，**保留** home/folder/trash/newWhiteboard/teamSpace 等首页概念键；官方 CollabPanel 的文案在基线 locale 内容里，不碰。zh-cn 是主用语言，逐键核对 |
| ✂️ | `tests/engine/app/collab/`（6 文件）按测试对象判定：**测自研已删代码**（config.ts、HMAC 房间派生 room-id/bridge-resolve-room、server collab 端点 server）→ 🗑；**测官方保留行为**（Yjs roundtrip room-roundtrip、session/session-idb-order、local awareness）→ ✅ 保留并在还原后跑绿。`tests/engine/app/settings/share-popover-docpath.test.ts`、`team-store.test.ts` → 🗑 |
| ✂️ | `tests/engine/app/shell/menu/schema.test.ts`（菜单项断言随 schema 回退更新）；`tests/e2e/properties/page-section.spec.ts`(M,+55) 若含 usersys 场景则裁剪，否则保留 |
| ✅ | **稳定性批测试全保留**：`tests/engine/io/fig/export/{clone-safe,page-background,winding-rule}.test.ts`、`tests/engine/render/canvas/text-edit-caret.test.ts`、`tests/engine/app/document/io/binding-signal.test.ts`（file-bridge binding 信号，自动保存线） |

### 3.8 AI 协同链路：明确不碰（保留清单 #3 = 新口径 #3「AI 协作线」落点；= v1 §2.8）

| ✅ 位置 | 原因 |
|---|---|
| `custom/file-bridge/mcp-proxy.ts` 全部（含 REQ-6 watchdog :140-155、REQ-7 headless 3s save_file :126-138） | 只依赖 MCP_AUTH_TOKEN env，与用户系统零耦合 |
| `packages/mcp/src/node-rpc-backend.ts`（save_file:321/handleSave:~275-294）、`packages/mcp/src/server.ts`(hybridSendRPC)、`browser-rpc.ts` | 官方 headless Node 编辑后端，零改动 |
| `src/app/automation/bridge/*`（server.ts connectAutomation、handlers.ts save_file:39、tool-handlers/apply/replay journal） | 浏览器 register + AI op apply + journal 防丢，零改动（9e27849b 的 graph watch 重试保留） |
| `src/app/bridge/client.ts` 的文件读写/SSE/watchPath/selfWriteMtime 部分、`op-journal.ts`、`document/io/*` autosave+beforeunload flush | 自动保存线地基（新口径 #3），零改动 |
---

## 4. 关键风险点结论（v1 §3 按新口径调整）

### R1：砍掉登录后 AI 协作链路怎么接 —— **config 直接开放，MCP register 链路保持不动**（= v1 R1，不变）

- `/api/v1/config` 目前仅登录态下发完整配置（server.ts:1408-1431）；浏览器取 token：`resolveWebMCPHandle()`（src/app/automation/mcp/spawn.ts:395-421）fetch config 时附 `Authorization: Bearer <sessionToken>`(400-402)——这是 9e27849b 刚加的。
- register 链路本身：`connectAutomation`(src/app/automation/bridge/server.ts) → ws://同源/ws(server.ts:1470 upgrade) → mcpProxy.pipe(:1830-1835) → MCP server browser-rpc。**链路上没有任何一处检查 session token**，MCP 侧只认 MCP_AUTH_TOKEN（mcp-proxy.ts:299）。
- **结论：config 端点直接开放下发完整配置（回退 Phase C 之前语义），不需要保留任何门禁。** 大白话影响：以前「先登录才能拿到 AI 写盘令牌」；个人版拆掉登录后，打开页面 = 自动拿到 BRIDGE_TOKEN + Pexels key + MCP token。安全性无实质下降——能打开这个页面的人本来就能通过 UI 读写所有文件（UI 自己就是拿同一个 config token 在 PUT）。部署边界继续靠 Docker：LAN 8080 + AI 专用 127.0.0.1:8081。
- **最小改动方案（3 处，共 ~15 行）**：① server.ts:1408-1431 删未登录分支+collab 块，无条件返回完整配置；② spawn.ts 删 getSessionToken import + Authorization header 拼装（其余重试/超时/null 降级逻辑原样保留）；③ EditorView.vue 删 restoreSession import + onMounted await。
- **MCP register 链路零逻辑变更**（新口径 #3 AI 协作线）。验证：容器起好 → 浏览器开 /editor → MCP /health 从 no_app 变 ok（register 成功），AI set_fill 后画布实时可见。v2 注：EditorView 手术面比 v1 小——collab 接线是「恢复官方」而非删除，R1 三处改动本身不变。

### R2：server.ts 混合文件 —— 端点归属总表（= v1 R2，不变）

**必须保留（13 组）**：`GET /api/v1/health`(1404) · `GET /api/v1/config`(1408,简化后) · MCP 反代 `/mcp|/rpc|/health`+OPTIONS(1455-1468) · `/ws` upgrade(1470-1476)+websocket pipe(1829-1846) · mcpPath 桥接工具 POST(1478-1492) · `files` GET/POST + rename/move/trash/meta/file CRUD(1494-1502,1615-1685，**PUT/POST=原子保存 writeFileAtomic+withWriteQueue**) · fonts 列表+下载(1504-1518) · `events` SSE(1520-1523) · active GET/POST(1525-1533) · recent GET/POST(1535-1543) · dirs/pins/trash(+restore/delete)(1559-1613) · 静态托管 serveStatic(1820-1822,134+)

**剔除范围（端点）**：`/api/v1/collab/room`(1433-1452，HMAC+权限校验——新口径 #2「HMAC 房间派生」删除点，官方 Trystero 不依赖) · `/api/v1/online` GET/POST(1545-1557) · auth/login|logout|session(1689-1702) · members + /members/:id PATCH/DELETE(1704-1738) · avatars POST + /avatars/:name GET(1742-1754) · permissions GET/POST + permission-request(1756-1766) · notifications + read-all + :id/action(1770-1787) · share GET/POST/DELETE + verify + password + :token/content(1791-1818)

**剔除范围（非端点逻辑）**：import 行、parseCollabIceServers(58-74)、authStore/sessionUser/adminUser/bearerToken(289-310)、presence sweep 三件套+reportOnline/getOnline(312-362)、初始化块 collabRoomSecret/presence/authStore/permissions/notifications/shares/presenceSweepTimer(369-405)、797-1393 整段 handler（≈600 行）、mcpDeps.resolveActiveUserId(412)→`() => null`、activeReadKey(756-759) 简化、shutdown clearInterval(1851)。

**大白话影响：** server.ts 从 1,870 行缩到 ≈1,100 行。写盘鉴权回到「BRIDGE_TOKEN 单通道」；active/recent 的「按用户记打开文件」（新口径 #2「active 按用户隔离」）退化为单一 owner 维度（keyFor(null)→primary），首页「最近/正在编辑」展示不受影响（个人版只有一个使用者）。MCP、SSE、原子保存一行不碰。

### R3：分享入口 —— **v2 整段重写：保留官方原版分享（CollabPanel P2P）+ 删自研外链分享**

**事实：fork 里并存两种「分享」，必须分清：**

| | 官方① CollabPanel P2P 分享 | 自研② 外链分享 |
|---|---|---|
| 入口 | `src/components/CollabPanel/*`（CollabSharePopover/ShareOrJoinRoom/JoinRoomPrompt/ConnectedRoom） | `src/components/workspace/SharePopover.vue`(880) + EditorView 顶栏分享按钮行 |
| 机制 | Trystero 信令 + WebRTC P2P + Yjs CRDT；getShareURL()(constants.ts:76-81) 生成房间链接 → `/share/:roomId` 路由加入 | server 端 share.json 台账 + 游客页 ShareGuestView(405) + 密码门 + permissions 校验 |
| 归属 | **官方原版**（fece63b5 基线内） | **自研新增**（usersys 时代） |

**v1 结论是「隐藏全部分享入口、不恢复 CollabPanel」——新口径 #1/#2 修正为：保留官方①，删自研②。**
- 官方分享按钮回到桌面顶栏：点击 → 生成 P2P 房间链接（发给对方）或输入房间号加入；连上后双方 Yjs 实时同步 + 远程光标可见。这就是 upstream 原版行为，零改造。
- 自研外链分享三件套全消失：SharePopover/ShareGuestView/bridge share.ts 客户端（§3.3）、server 端 share×4 端点+密码生成+内容服务（server.ts:1207-1350 区段，§3.1）、`/share/:token` 与 `/:shareToken` 路由。
- **大白话影响**：「发链接给同事 → 对方浏览器输密码打开」的流程彻底没了；取而代之的是「本地开编辑器 → 点分享 → Trystero P2P」的实时协作流程。注意：Trystero 信令走公共中继，纯内网（不通外网）环境建不了连接——这与 upstream 官方行为一致，不是本次精简引入的回退。
- 移动端按 §3.4 不变（MobileShareButton 随在线感知移除），桌面入口保留；将来要移动端 P2P 分享再恢复该按钮并接 CollabPanel。

### R4：剔除后编译/lint 残留 —— 连带清理位置全表（= v1 R4，collab 部分按新口径更新）

原则：先删文件/回退、再清引用，`bun run check`（oxlint+tsgo）把漏网的 unused import / 未用变量全部报出来；Steiger 管架构边界。**按依赖顺序清理**（从叶子到根），每步跑一次 check：

1. **第一刀（纯删除/回退）**：§3.1 lib 7 文件、§3.2 LoginView/auth/notifications/NotifyBell/profile+team 面板（ProfileSettingsPanel/TeamSettingsPanel；**设置区三个官方组件 StockPhotoKeys/Storage/Vectorize 不删**）、§3.3 ShareGuestView/bridge share.ts/SharePopover、§3.4 presence use.ts/MobilePresencePopover/MobileShareButton、**§3.5 collab 自研部分（config.ts 🗑 + awareness/local-awareness 🔄 回退）**。
   - ⚠️ 注意：这些文件互相引用，删除/回退后必须立刻做第 2 步，中间态编译不过属预期。**CollabPanel 与官方 collab 栈本刀不碰**。
2. **第二刀（清引用，按文件）**：
   - `src/views/EditorView.vue` —— 最重的一个：presence watch + **syncCollabRoom 自研自动进房块** + shareAccessible 块 + readOnly 拦截 3 个 watch(178-230) + onMounted restoreSession → 删；模板 PermissionRequestDialog/readonly banner/**自研 SharePopover 行**/MobileHud :online-users → 删；**官方 CollabPanel 接线（provide(COLLAB_KEY)/useCollab/CollabAvatarStack 分享行）按基线状态恢复而非删除**
   - `src/router.ts`（§3.2：3 条自研路由+守卫删，/share/:roomId 按基线处理）、`src/App.vue`(4 处)、`src/main.ts`(2 处)
   - `src/components/EditorCanvas.vue` + collaboration-awareness.ts（对照基线判归属，§3.5）
   - `src/app/bridge/client.ts`：删 `authHeader()`(102-106)，`authHeaders()`(160-165) 简化为只走 BRIDGE_TOKEN；删 getPermissions/requestPermission/resolveCollabRoom/reportOnline/getOnline + BridgePresenceUser/BridgePermission 类型
   - `src/app/bridge/open-from-param.ts:1,16-18`（restoreSession）
   - `src/app/ai/chat/storage.ts:17,69-85`：删 restoreSession，config fetch 不带 header；**保留** pexelsKey→credential store 逻辑(80-85)（Pexels 服务端 key 兜底走这里，新口径 #3）
   - `src/app/automation/mcp/spawn.ts`(§4-R1 第 2 条)
   - `src/views/FolderView.vue:25,321`、`WorkspaceTopBar.vue:7,116`、`MobileHud/context.ts+MobileHud.vue`（onlineUsers prop）
   - `src/app/editor/session/{types,modules}.ts` + `src/app/tabs/index.ts`（readOnly 字段与接线）
   - `src/constants.ts`：**TRYSTERO_*/ROOM_*/PEER_COLORS/getShareURL 保留**（v2 修正：官方 collab 栈引用）；仅当 check 报 unused 才清理
   - `src/app/shell/menu/schema.ts + app-menu.ts`（回退到 fece63b5 版本对照）
3. **第三刀（i18n）**：messages/dialogs.ts+panels.ts 与 8 locale JSON 按 §3.7 逐键删；官方 CollabPanel 文案属基线内容不碰。Steiger 校验 messages.ts 与 locale JSON 键一致性，以 check 输出为准收尾。
4. **第四刀（测试）**：§3.7 collab 6 文件按测试对象判定 + share-popover-docpath/team-store 🗑 + schema.test.ts 更新；跑 `bun run test:unit` 全绿。
5. **决策点 D1**：ContextMenuOverlay/MovePrompt/NewProjectPrompt/RenamePrompt —— 属首页文件夹系统（保留），不删。
6. **决策点 D2**：WorkspaceTopBar「设置」按钮(108-115)：四 tab 删除后，**保留按钮但指向恢复后的官方 AI/模型设置对话框**（SettingsDialog 回退基线版）。若确定个人版完全不走应用内 AI chat 配置（只走 openclaw/MCP），则连按钮一起删。默认推荐前者：成本低且官方 AI 入口不失踪。
7. **决策点 D3（2026-08-18 23:21 更新）**：StockPhotoKeysSection/StorageSettingsPanel/VectorizeSettingsSection 判定为**官方组件**（architect 误判自研，已纠正）→ ✅ 全部保留我们的改动（用户 23:21 拍板：Pexels 默认配置好、存储面板、资源搜索面板全保留）；真正自研删除 = ProfileSettingsPanel/TeamSettingsPanel 两个面板 + dialog.ts tab 改造。Pexels key 同时走服务端 config 下发兜底（§4-R1）

### R5：官方最新版价值 —— **值得追，但不是现在追**（= v1 R5，不变）

`fece63b5..upstream/master` = 73 commits。与本项目相关的分类结论照旧：**保存/恢复可靠性**（e7c408a2 autosave coalesce #531、document recovery 生命周期、unsaved tabs recovery #505、IDB 标准化）价值高但须与我们 journal/op-journal + bridge binding 语义合并验证，不能盲合；**SVG/kiwi 加固**（#508 clipPath、c7b944d1 FIG containers）中高，追时先跑 winding-rule.test.ts 防覆盖我们的归一化；**编辑器大改**（#518 canvas view state、#519 split panes、#525 live JSX/HTML/CSS）是路线 B 成本高的主因，个人版非刚需可缓；**AI/MCP**（#522/#516 connections 分离）与我们「AI 走 openclaw/MCP」定位重叠，按需再追。

**成本结论：** 现在追 = v1 §1.1 路线 B 的完整代价（85 冲突文件）。建议把「追 upstream」拆成收拢之后的独立项目：先完成 A 线剔除（自研面从 24k→~16k 行，且官方 collab 栈保留使冲突区更贴近基线），稳定运行 1–2 周后做聚焦前向移植，优先级 = 保存/恢复可靠性 > SVG/kiwi 加固 > AI/MCP 设置 > 编辑器大改。
---

## 5. 保留功能完整性核对表（剔除后逐项确认，按新口径 #3 三条线组织）

| # | 保留项 | 依赖的关键代码 | 是否受剔除影响 | 验证点 |
|---|---|---|---|---|
| 1 | **官方原版多人协作**（v2 新增核对行）：CollabPanel P2P 分享 + Yjs/Trystero 实时同步 + 远程光标 | `src/components/CollabPanel/*`、`src/app/collab/` 还原后的官方部分（context/yjs-sync ✅，awareness/local-awareness 🔄，room/session/types/use ✂️）、Trystero+Yjs 传输层、TRYSTERO_*/PEER_COLORS/getShareURL 常量、远程光标画布 overlay、/share/:roomId 路由（基线状态） | **这是保留主体本身**——只删自研改造（自动进房/HMAC 派生/avatarImage 字段/requestRepaint 改动/REQ-1~5）。行为回到 upstream 原版：手动分享/加入，不再按文件自动进房 | E2E/手工：/editor 顶栏有官方分享按钮 → 建房生成 Trystero 链接；第二个浏览器窗口输房间号加入 → 双方互相看到远程光标（彩色箭头+名字 pill）且编辑实时同步不覆盖；还原后 awareness 不再携带 avatarImage；`bun run check` + collab 保留测试跑绿 |
| 2 | **文件稳定优化批**：caret 对比、页面背景持久化、原生下载导出、SVG 粘贴导入、WindingRule 归一化、中文支持（字体/i18n）、8位hex、按钮坐标存储、批量不屏闪 reload 守卫、**Pexels 图片搜索功能（含白板资源搜索面板——我们加的，用户 23:21 拍板保留）** | 全部在 packages/core\|kiwi + src/app/editor/clipboard/system.ts —— **剔除清单完全不碰这些文件**（§3.7 ✅ 测试保留）；Pexels key 链路：config.pexelsKey → storage.ts:80-85 → credential store；**设置面板三组件（StockPhotoKeys/Storage/Vectorize）保留我们的改动**（§2.1） | **基本不受影响**。唯一接触面：i18n locale JSON 双向编辑（usersys 键删 vs 中文稳定性键留，zh-cn 重点核对）+ ProfileSettingsPanel/TeamSettingsPanel 两个自研面板删除（功能代码与设置组件本身不碰）；vite base 回 '/' 后资源路径自动回落 | `bun run test:unit`（caret/page-background/winding-rule/clone-safe 四个专项全绿）+ canvas 视觉快照对比（renderer-visuals.spec.ts）+ 中文界面抽查 + E2E assets 面板搜图/翻页/颜色筛选 |
| 3 | **自动保存线**：file-bridge 存储、原子保存、autosave 可靠性、SSE 自动刷新、journal 兜底、beforeunload flush | writeFileAtomic+withWriteQueue(server.ts:202-235 ✅)、events SSE(1520-1523 ✅)、FileWatcher+reconcile(389-402 ✅)、watchPath/selfWriteMtime、op-journal.ts、autosave beforeunload(src/app/document/autosave/create.ts + client.ts ✅) | **不受影响**。checkAuth 去 session 分支后写路径仍是 BRIDGE_TOKEN（行为等价）；active/recent「按用户隔离」删除后退化为 owner 单维度（首页展示不变，§4-R2） | E2E：编辑→关标签页(beforeunload flush)→重开内容在；外部改文件→SSE 自动 reload；断网/半写场景 journal 恢复；并发 autosave 不互相覆盖 |
| 4 | **AI 协作线**：MCP relay + watchdog REQ-6 + headless 3s 落盘 REQ-7 + browserRPC register 链路（9e27849b）+ AI 工具集 | mcp-proxy.ts(REQ-6 :140-155, REQ-7 :126-138)、/mcp//rpc//ws 反代(server.ts:1455-1476 ✅)、node-rpc-backend(save_file:321)、connectAutomation+bridge handlers(§3.8 ✅) | **不受影响**，仅 R1 的 3 处 ~15 行改动（config 开放 + spawn.ts 去 header + EditorView 去 await）。register 链路本身零变更 | 容器起 MCP_AUTH_TOKEN → /editor 打开 → MCP /health: no_app→ok；AI set_fill 画布实时可见；杀 MCP 进程 → watchdog ≤30s 自动拉起（REQ-6）；无浏览器时 AI 编辑 3s 内落盘（REQ-7，curl 看文件 mtime） |
| 5 | **首页概念**：HomeView 落地页 + /editor 路由 + 文件夹/回收站管理 | `src/views/HomeView.vue`(299)、`FolderView/TrashView`、router `/`,`/folder/:name`,`/trash`,`/editor`（§3.2）；server dirs/pins/trash/recent 端点 + manifest 台账(§3.1 ✅) | **不受影响**。仅 WorkspaceTopBar 少一个 NotifyBell、FolderView 少 AccessDialog；「设置」按钮按 D2 指向恢复后的官方 AI 设置对话框 | E2E：打开 / → 见首页网格；新建白板→进 /editor；重命名/移动/删到回收站/恢复全通 |
| 6 | Docker 部署 | `Dockerfile`(不动)、`docker-compose.yml`(仅删 PASSWORD_ENC_KEY env, §3.6)；healthcheck 打 /api/v1/health(保留端点) | **不受影响**。MCP_AUTH_TOKEN/BRIDGE_TOKEN/DESIGN_ROOT/STATE_DIR env 语义全部不变；Trystero P2P 是浏览器侧 WebRTC，不依赖容器新增端口 | `docker compose up -d --build` → health ok；8081 AI 端口 curl MCP 通；数据卷读写正常 |

---

## 6. 分阶段实施建议（v1 Phase 0-6 保留，按新口径调整内容）

> 前置：从 master 开分支 `streamline/personal-local`；先跑一遍基线 `bun run check && bun run test:unit` 留底。每个阶段 = 一个 commit + 一次质量门，失败即 revert 该 commit，不影响后续阶段。

**Phase 0 — 基线与快照（0.5h）**
- 记录当前 check/test:unit/e2e 状态；确认 Docker smoke 通过（compose up + health + 开首页）。
- 验证标准：基线全绿或已知失败清单留档。

**Phase 1 — 服务端剔除（file-bridge，§3.1）**
- server.ts 按 §4-R2 总表删端点/逻辑；删 lib 7 文件；config 开放(R1)。其中 `/api/v1/collab/room` + collab 下发块删除 = **移除自研 HMAC 房间派生链路**（官方 Trystero 不依赖，新口径 #2）。
- 验证：`bun run check`(custom/ 在 lint 范围) + 手工 curl 矩阵：health/config(无 token 应返回完整配置且**不含 collab 字段**)/files CRUD/SSE/MCP /health；Docker smoke。MCP register 链路容器侧就绪（旧前端带 session header 也能拿到配置——sessionUser 删除后该 header 被忽略，兼容）。

**Phase 2 — 用户系统剔除（§3.2 + §3.7 i18n 第一遍）**
- 删 LoginView/auth/notifications/readonly/AccessDialog；router/App/main/FolderView/menus/i18n 清理。设置区：SettingsDialog 🔄 回退官方基线版（官方自带 ai/media/storage 三 tab）；Profile/Team 面板 🗑；**StockPhotoKeysSection/StorageSettingsPanel/VectorizeSettingsSection 是官方组件，保留我们的改动（用户 23:21 拍板，不删）**；dialog.ts 删自研 tab 部分、保留官方三 tab 语义。
- 验证：`bun run check` + `test:unit` + E2E 首页全流程（无登录直接进 HomeView；新建→编辑→保存）。此时 /editor 还带着 presence/自研 collab 引用边——Phase 3 紧跟，中间态允许 EditorView 编译不过**仅限本阶段 commit 内**（建议 Phase 2/3 合成一个 PR 但两个 commit）。

**Phase 3 — presence/自研分享剔除 + collab 改造还原（§3.3-3.5，v2 重写）**
- 删 ShareGuestView/SharePopover/bridge share.ts/presence use.ts/MobilePresencePopover+MobileShareButton；collab：config.ts 🗑、awareness/local-awareness 🔄 回退基线、room/session/types/use ✂️ 逐处还原（拆不清的整文件 checkout）、collaboration-awareness.ts + EditorCanvas 引用对照基线判归属（一致→✅ 保留 / 有差异→🔄）；EditorView 手术 = 删 presence 块 + **syncCollabRoom 自研自动进房块** + shareAccessible 块 + readOnly 3 watches + restoreSession，**官方 CollabPanel 接线按基线状态恢复**；constants TRYSTERO_* ✅ 保留。
- 验证：`bun run check`(unused import 清零) + `test:unit`(collab 测试按对象判定后全绿) + E2E/手工：**/editor 顶栏有官方分享按钮 → 建房生成 P2P 链接；第二窗口输房间号加入 → 光标可见、编辑同步（Yjs）**；无游客页路由(/share/:token 404)、无 readonly banner、无头像堆叠；MCP register 链路复验(R1 验证点)。

**Phase 4 — /Mobai 子路径回退 + Docker env（§3.6）**
- vite base '/'、pwa manifest 去前缀、compose 删 PASSWORD_ENC_KEY。getShareURL 保留但 BASE_URL 自动回落逻辑不变，无需额外处理。
- 验证：`bun run build` → dist/index.html 引用 `/assets/*`(无前缀)；Docker smoke 复跑；canvaskit.wasm 加载成功(浏览器 console 无 wasm 404)。NPM 侧提示运维改回根路径（外部，不操作）。

**Phase 5 — i18n/测试收尾 + 全量回归**
- i18n 逐键清理(R4 第 3 刀)、menu schema.test 更新、collab 保留测试跑绿、`test:dupes`(删了大块代码后克隆数应下降)。官方 CollabPanel 文案属基线 locale 内容，不碰。
- 验证：完整质量门 `bun run check && bun run format && bun run test:dupes && bun run test:tools && bun run test:unit && bun run test` + canvas 视觉快照对比(保留清单 #2) + §5 核对表逐项打勾（**含第 1 行官方多人协作的手工验证项**）。

**Phase 6（收拢稳定后，独立立项）— 聚焦追 upstream（§4-R5）**
- 优先级：保存/恢复可靠性(e7c408a2 等) > SVG/kiwi 加固(#508, c7b944d1) > AI/MCP 设置(#522/#516) > 编辑器大改(#518/#519，评估后再定)。官方 collab 栈保留后，追 upstream 时该区域冲突面反而更小（我们这边更贴近基线）。
- 每次追平单独 PR + 全量回归；winding-rule/caret 专项测试作为前置护栏。

---

## 附：本报告引用的关键 commit（fork 侧）

| commit | 内容 | v2 归属判定 |
|---|---|---|
| `973e4231` | merge: absorb upstream v0.14.0 (44 commits) | 基线锚点（fece63b5 = 其 upstream 侧父提交） |
| `f8306112` | file-bridge web deployment Phase 1–5 | 保留（自动保存线） |
| `777530fb/2bec5af0/4178e90f/fa3bf44a/92c01721...8b9e24e9` (usersys Phase A–G) | 用户系统全套 + 自研分享三件套 | 剔除（新口径 #1/#2） |
| `bb8404b6/37e6e4c1/8be685ab` | collab P0 回归修复 REQ-1~5（自动进房/HMAC/avatar/cursor repaint） | **v2 修正**：属「加在官方多人上的自研改造」→ 还原官方（§3.5），不再是整段剔除 |
| `9e27849b` | AI register 链路（spawn.ts resolveWebMCPHandle + config header + graph watch 重试） | **保留**（新口径 #3 AI 协作线，R1） |
| `1b09eed3/73b5db05` | presence avatars + /Mobai 子路径 | 剔除（presence/#5；canvaskit guard 修复保留） |
| `afedacb4..d6a6f1df`(④-⑧号稳定性批)、`c3f9d366/191c734a`(WindingRule)、`604c45ab`(team-space home + /editor) | 文件稳定优化批 + 首页概念 | 保留（新口径 #3 + 首页概念） |

> 收尾说明：v2 相对 v1 的净变化 = collab/ 从「整目录删除(1,045 行)」变为「还原官方(~60% 代码量保留) + 删自研改造」，CollabPanel 从删变留，分享入口从隐藏变恢复官方版；用户系统、presence、自研外链分享、设置四 tab、/Mobai 的剔除范围不变。
