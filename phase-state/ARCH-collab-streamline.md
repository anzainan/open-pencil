# ARCH-collab-streamline：fork 收拢为「纯本地 + 个人使用 + AI 协同」的路线评估与剔除清单

- 角色：architect（只读分析，未改任何代码、未 commit）
- 日期：2026-08-18
- 基线：anzainan/open-pencil `master` HEAD=`9e27849b`；upstream/master=`4e48420a`（已 fetch，2026-08-18）
- 方法：纯 git + 源码静态分析。所有结论给 file:line 证据。大白话解释见每个决策的「影响」段。

---

## 0. 关键事实速览（先看懂数字再看结论）

| 指标 | 数值 | 证据 |
|---|---|---|
| fork 真实上游基线 | `fece63b5`（v0.14.0 时代，= master 与 upstream/master 的 merge-base） | `git merge-base master upstream/master` → fece63b5；merge commit `973e4231 "merge: absorb upstream v0.14.0 (44 commits)"` 的两个父是 `1ad631b6`(fork侧) + `fece63b5`(upstream侧) |
| fork 自研总量（vs 上游基线） | **125 个独立 commit，361 文件，+24,339 / -1,122 行** | `git diff fece63b5..master --stat` |
| upstream 新工作量（v0.14.0 之后） | **73 个 commit** | `git log fece63b5..upstream/master --oneline \| wc -l` = 73 |
| **双方都改过的文件（路线 B 的冲突面）** | **85 个文件** | `comm -12 <(git diff fece63b5..master --name-only) <(git diff fece63b5..upstream/master --name-only)` |
| 剔除目标代码体量（纯删除） | ≈ 7,000 行 + i18n 键 ~1,000 行 | §2 各文件 wc -l 汇总 |

注意：`973e4231..master` 只有 55 commit，是因为 file-bridge Phase 1–5、首页视图等更早的自研工作发生在 merge 之前（在 `1ad631b6` 链上）。评估「移植工作量」必须用 `fece63b5..master`（24k 行）这个口径。

---

## 1. 路线对比结论：选 A（基于当前 master 剔除）

### 1.1 两条路线的工作内容

**路线 A：在 master(`9e27849b`) 上剔除用户系统/分享/presence/collab//Mobai**
- 删除 ≈ 30 个自成一体的文件（≈7,000 行），改 ≈15 个混合文件（≈1,000 行级编辑）
- **不需要与 upstream 合并任何东西**。剔除对象几乎全是 Phase A–G 时期新增的独立代码，边界干净。
- 验证手段现成：`bun run check` + `bun run test:unit` + Docker smoke + Playwright E2E 首页/编辑器流程。

**路线 B：在 upstream/master(`4e48420a`) 上重新移植自研功能**
- 要把 **361 文件 / +24,339 行**的自研工作（file-bridge 全套、HomeView、Pexels 增强、MCP relay、稳定性修复批…）重放到一个已经往前走 73 commit 的树上。
- **85 个文件双方都改过**，必须逐个三方合并。最疼的几个恰好是「保留清单」的核心区：

| 冲突文件 | 我们这边（要保留的功能） | upstream 那边（73 commits 里） |
|---|---|---|
| `src/app/document/io/save.ts`、`io/create.ts`、`autosave/create.ts` | autosave 可靠性 / beforeunload flush / journal 水位（保留清单 #4 的核心） | `e7c408a2 perf(app): coalesce overlapping autosaves (#531)` + `f22d2c9b/7b8e5fbf fix(app): harden document recovery lifecycle` + `16b74a20 refactor(app): standardize IndexedDB access` |
| `packages/core/src/canvas/overlays/text-edit.ts` | caret 颜色对比修复（保留清单 #5，`db553225`、`d2296bbc`） | `15bd0ba1 fix(text): align editing overlays with vertical text (#543)` —— **同一个文件** |
| `packages/kiwi/src/fig/parse.ts`、`schema/fig.kiwi` | WindingRule 归一化（保留清单 #5，`c3f9d366`、`191c734a`） | `c7b944d1 fix(kiwi): harden FIG containers and DOM imports` —— **同一区域** |
| `packages/vue/src/i18n/locales/*/dialogs.json`（8 语言 ×2 文件）+ `messages/dialogs.ts` | +201 行自研键（保留的首页/文件夹键 + 要删的用户系统键混在一起） | upstream 也改了 dialogs/menu/panels locale（docs reorg `3ef554ab`、locale gap fixes）—— JSON 双向改动，机械但量大 |
| `src/views/EditorView.vue`、`src/app/editor/session/modules.ts`、`src/components/CodePanel.vue`、LayerTree、properties/* 等 | 首页概念 / TopBar / 只读拦截 / collab 接线（大部分要删） | `29ed07bc refactor(editor): separate canvas view state (#518)` + `7a02ee2c feat(editor): model split canvas panes (#519)` —— upstream 大改编辑器结构，我们的 EditorView 是重灾区 |

- 移植完还要对**全部保留功能**做回归（Pexels 分页/颜色筛选、file-bridge 每个端点、MCP relay + watchdog、Docker 部署、canvas 视觉快照），因为「重放」不等于「等价」。
- 且这是**一次性成本最高的路线**：未来每次追 upstream，85 个冲突文件里的自研部分（24k→剔除后 ~16k 行）都要再合一遍；路线 A 只是把这笔账往后推、并且先把冲突面缩小。

### 1.2 工作量与风险估算

| | 路线 A（master 剔除） | 路线 B（upstream 重移植） |
|---|---|---|
| 编码量 | ≈7,000 行删除 + ≈1,000 行级编辑，≈35–40 文件 | ≈24k 行重放 + 85 个冲突文件三方合并 |
| 估算工期（含验证） | **2.5–4 人日** | **1.5–3 周** |
| 主要风险 | 残留引用 / lint 报错（有 oxlint+tsgo+steiger 兜底，可逐阶段清） | save/autosave 语义冲突合并错 → autosave 可靠性回退；caret/WindingRule 修复被 upstream 改动覆盖；i18n JSON 合错导致中文界面缺字 |
| 验证成本 | 每阶段 `bun run check` + 针对性 E2E，增量可验 | 全量回归（unit + e2e + canvas 视觉快照 + Docker） |
| 对保留清单的威胁面 | 小：只动「剔除」代码的引用边，保留功能文件基本不碰 | 大：保留功能的实现文件本身就在冲突区里 |

### 1.3 推荐

**路线 A。** 理由一句话：要删的东西（≈7k 行）全是自研新增、边界干净；要留的东西（save/autosave/caret/WindingRule/MCP relay）恰好都落在路线 B 的 85 个冲突文件里——B 等于「先把自己最不能坏的地方拆一遍再重装」。upstream 新版的价值是真实但可延迟的：收拢稳定后再做一次聚焦前向移植（见 §3-R5），那时冲突面更小、且可以按功能挑着追。

---

## 2. 文件级剔除清单（路线 A）

图例：🗑 = 整文件删除；✂️ = 手术式修改；✅ = 明确不碰。

### 2.1 file-bridge 服务端（custom/file-bridge/）

| 操作 | 位置 | 说明 / 证据 |
|---|---|---|
| ✂️ | `server.ts:58-74` | 🗑 `parseCollabIceServers()` —— collab ICE 配置解析，人协专用 |
| ✂️ | `server.ts:16,17-20,21-26,41` | 删除 import：`decryptPassword`(crypto)、`AuthStore/isAdminRole/User/UserRole`(auth)、`NotificationStore`、`PresenceStore`、`PermissionStore`、`ShareStore/generateRandomPassword/...`、`deriveRoomId`(room-id)。**保留** design/events/mcp-proxy/mcp/manifest/paths/state 的 import |
| ✂️ | `server.ts:281-287` | `checkAuth()` 保留，但删第 285 行 session 回退分支（`if (authStore && sessionUser(request)) return null`）→ 写接口只认 BRIDGE_TOKEN。影响：AI/浏览器写入的鉴权回到 Phase C 之前的「token 单通道」，行为不变 |
| ✂️ | `server.ts:289-310` | 🗑 `authStore` 全局(290)、`bearerToken`(292)、`sessionUser`(298)、`adminUser`(306) |
| ✂️ | `server.ts:312-362` | 🗑 presence 台账清理/心跳：`sweepExpiredPresence`、`startPresenceSweep`、`reportOnline`、`getOnline` |
| ✂️ | `server.ts:369-371,378-386,404-405` | 🗑 初始化块：`collabRoomSecret`(371)、`presence`(379)、`authStore=new AuthStore`(381)、`permissions`(383)、`notifications`(384)、`shares`(386)、`presenceSweepTimer`(405)。**保留** `state`(376)、`bus`(377)、`manifest`(388)、watcher/reconcile(389-402) |
| ✂️ | `server.ts:412` | `mcpDeps.resolveActiveUserId: () => authStore?.getOwnerUserId() ?? null` → 改 `() => null`（active 维度落到 primary/owner，见 lib/state.ts:95-110 的 keyFor(null)→primary 回落，行为不变） |
| ✂️ | `server.ts:756-759` | 🗑 `activeReadKey()` 里 sessionUser/authStore 引用 → 直接 `return null`（getActive 落到 primary owner 记录） |
| ✂️ | `server.ts:797-1393` | **整段删除**（≈600 行连续块）：login(797)/logout(814)/session(824)/listMembers(832)/createMember(837)/updateMember(864)/deleteMember(894)/uploadAvatar(942)/serveAvatar(1004)/getPermissions(1031)/createPermissionRequest(1046)/listNotifications(1081)/resolveNotificationAction(1093)/markNotificationsRead(1151)/`resolveShareBaseURL`(1159)/getShare(1207)/createShare(1239)/deleteShare(1278)/verifyShare(1299)/serveShareContent(1323)/generateSharePassword(1342)/upsertFilePermission(1350) |
| ✂️ | `server.ts:1408-1431` | `/api/v1/config`：删 1411-1414 的「未登录最小配置」分支和 `sessionUser(request)`，**无条件返回完整配置**（token/pexelsKey/mcp 字段）；同时删除 1421-1426 的 `collab:{...}` 块。详见 §3-R1 |
| ✂️ | `server.ts:1433-1452` | 🗑 `/api/v1/collab/room`（HMAC 房间派生 + permissions.resolvePermission 校验） |
| ✂️ | `server.ts:1687-1818` | dispatch 删除：auth/login\|logout\|session(1689-1702)、members(1704,1724-1738)、avatars(1742-1754)、permissions/permission-request(1756-1766)、notifications×3(1770-1787)、share×4(1791-1818) |
| ✂️ | `server.ts:1851` | shutdown 里删 `clearInterval(presenceSweepTimer)` |
| ✅ | `server.ts:202-235`（writeFileAtomic/withWriteQueue）、1404 health、1455-1492 MCP 反代(/mcp /rpc /health + OPTIONS)、1470 `/ws` upgrade、1478 mcpPath 桥接工具、1494-1685 files/fonts/events(SSE)/active/recent/dirs/pins/trash×3/rename/move/meta/file 全部读写端点、1820+ 静态托管 | **保留清单 #4（原子保存/SSE/journal 兜底）与 #3（MCP relay）的地基，一行不动** |
| 🗑 | `lib/auth.ts`(~? )、`lib/notifications.ts`、`lib/presence.ts`、`lib/permissions.ts`、`lib/share.ts`、`lib/room-id.ts`(26)、`lib/crypto.ts`(51) —— 合计 **1,151 行** | usersys 台账全套。注意 `lib/state.ts`（active/recent，含 activeByUser）**保留不动**：keyFor(null)→primary 天然兼容无账号模式（state.ts:95-110） |
| ✅ | `mcp-proxy.ts`、`mcp.ts`、`index.ts`、`lib/{design,events,manifest,paths,state}.ts` | MCP watchdog(REQ-6, mcp-proxy.ts:140-155)、headless 3s save_file(REQ-7, mcp-proxy.ts:126-138) **零改动** |

### 2.2 App：用户系统（src/）

| 操作 | 位置 | 说明 |
|---|---|---|
| 🗑 | `src/views/LoginView.vue`(119)、`src/app/auth/session.ts`(152)、`src/app/auth/logout-dialog.ts`(12) | 登录页 + session token 全套（保留清单剔除项 #1） |
| ✂️ | `src/router.ts:3,7,8,16,26-32,39-47` | 删 `/login`(16)、`/share/:token(\w{32})`(26)、`/share/:roomId`(28)、`/:shareToken(\w{6,32})`(32) 四条路由 + LoginView/ShareGuestView import；beforeEach(39-47) 登录守卫整体删除（无 session 概念后守卫没有存在意义，未知路径交给 vue-router 默认 404）。**保留** `/`、`/folder/:name`、`/trash`、`/editor`、`/storage→/` redirect、`/demo` |
| ✂️ | `src/App.vue:7,11,31,44` | 删 `restoreSession()` import+调用、`LogoutDialog` import+模板节点 |
| ✂️ | `src/main.ts:5,30-33` | 删启动时 `await restoreSession()`（B2 时序依赖随之消失） |
| 🗑 | `src/app/notifications/index.ts`(1)+`store.ts`(49)、`src/components/workspace/NotifyBell.vue`(227) | 通知中心（剔除项 #1） |
| ✂️ | `src/components/workspace/WorkspaceTopBar.vue:7,116` | 删 NotifyBell import+模板。设置按钮(108-115)去留见 §3-R4 决策点 D2 |
| 🗑 | `src/app/editor/readonly.ts`(15)、`src/components/editor/PermissionRequestDialog.vue`(64) | Phase B 只读拦截 + 权限申请弹窗（剔除项 #1「权限拦截」）。upstream EditorView 完全没有 readOnly 概念（`git show fece63b5:src/views/EditorView.vue \| grep -c readOnly` = 0），整块自研，删得干净 |
| ✂️ | `src/app/editor/session/types.ts:17,38`、`modules.ts:72-73`、`src/app/tabs/index.ts`(readOnly 接线) | 删 editor state 的 `readOnly` 字段及「无编辑权限→只读」打开逻辑。影响：个人模式永远可编辑，这正是收拢目标 |
| 🗑 | `src/components/settings/profile/ProfileSettingsPanel.vue`(273)、`team/TeamSettingsPanel.vue`(465)、「设置四 tab」外壳改造 | 剔除项 #1「设置四tab」。`SettingsDialog.vue`、`StockPhotoKeysSection.vue`、`StorageSettingsPanel.vue`、`VectorizeSettingsSection.vue` **回退到 upstream 版本**（`git checkout fece63b5 -- <files>`），恢复官方 AI/模型设置入口（移动端抽屉的 `openSettingsDialog('ai')` 调用仍可达，见 src/app/settings/dialog.ts:9-10 注释） |
| ✂️ | `src/app/settings/dialog.ts`(26) | 重写为无 tab 状态：删 `settingsDirty/setSettingsDirty`、四 tab section 枚举（profile/team/media/storage），保留官方 AI 设置开关语义；`team-store.ts`(184)、`useAvatarURL.ts`(70) 🗑 |
| ✂️ | `src/views/FolderView.vue:25,321` + 周边权限 UI | 删 AccessDialog（文件夹访问申请，依赖 permissions.json）。**保留** FolderView 本体 + 重命名/移动/新建提示框（首页概念的地面设施） |
| ✂️ | `src/app/shell/menu/schema.ts`(±7)、`app-menu.ts`(±21) | 回退用户系统相关菜单项改动（对照 fece63b5 diff 逐条还原）；连带更新 `tests/engine/app/shell/menu/schema.test.ts` |

### 2.3 App：多人分享外链 + 游客页（剔除项 #2）

| 操作 | 位置 |
|---|---|
| 🗑 | `src/views/ShareGuestView.vue`(405)、`src/app/bridge/share.ts`(274，share link 客户端)、`src/components/workspace/SharePopover.vue`(880) |
| ✂️ | `src/views/EditorView.vue:38,151-174,360`（SharePopover import、`shareAccessible` watch(走 getPermissions)、模板行）；`src/app/bridge/client.ts:323(getPermissions),332(requestPermission)` 及 `BridgePermission` 类型 |
| ✅ | 官方 `CollabPanel/*` **不恢复**（理由见 §3-R3：它的后端是 Trystero P2P，随剔除项 #4 一起没了） |

### 2.4 App：头像上传 + 在线感知（剔除项 #3）

| 操作 | 位置 |
|---|---|
| 🗑 | `src/app/presence/use.ts`(96)（8s 心跳 + SSE online.changed）、server 侧 `/api/v1/online` GET/POST(server.ts:1545-1557) + PresenceStore(§2.1) |
| ✂️ | `src/views/EditorView.vue:23,73-84`（`useDocumentPresence` import、presencePath watch、`provideCollabPanel(onlineUsers)`）；`MobileHud/MobilePresencePopover.vue`(85)+`MobileShareButton.vue`(15) 🗑，`MobileHud/context.ts`+`MobileHud.vue` 的 onlineUsers prop 清理 |
| ✂️ | `src/app/bridge/client.ts:471(reportOnline),488(getOnline)` + `BridgePresenceUser` 类型 |

### 2.5 App：人-人实时协作（剔除项 #4，含官方 P2P 栈）

| 操作 | 位置 |
|---|---|
| 🗑 | `src/app/collab/` **整目录**（awareness/config/local-awareness/room/session/types/use/yjs-sync，合计 1,045 行 = 官方 Trystero/Yjs 栈 + 我们的自动进房/HMAC/broker 改造） |
| 🗑 | `src/components/CollabPanel/` **整目录**（432 行，官方分享面板 UI）、`src/app/editor/canvas/collaboration-awareness.ts`(16) |
| ✂️ | `src/views/EditorView.vue:12-13,36-37,68-69,86-149,359`（useCollab/getCollabConfig import、provide(COLLAB_KEY)、**自动进房 syncCollabRoom 全块(86-149)**、模板 CollabAvatarStack）；`src/components/EditorCanvas.vue:24,26,36,40` + `updateCursor` 引用（远程光标喂给画布 overlay 的入口） |
| ✂️ | `src/constants.ts`：`TRYSTERO_APP_ID`(71)、`ROOM_ID_LENGTH/CHARS`(72-73)、`PEER_COLORS`(~93-105)、`getShareURL()`(76-81) —— 全 repo 仅 collab 代码引用（已 grep 验证），随删 |
| ✂️ | `src/app/collab/config.ts` 读取的 config.collab 字段由 server 侧删除（§2.1，server.ts:1421-1426）；docker-compose 无 COLLAB_* env，无需动 |

### 2.6 /Mobai 外网子路径（剔除项 #5）

| 操作 | 位置 | 说明 |
|---|---|---|
| ✂️ | `vite.config.ts:21-23` | `base: '/Mobai/'` → `'/'`（核心一刀，其余多为自动回落） |
| ✂️ | `vite/pwa.ts` | manifest 去前缀：`navigateFallback:'/index.html'`、`start_url:'/'`、`scope:'/'`、icons `/pwa-*.png` |
| ✅ | `packages/core/src/canvaskit.ts:15-26`、`vite/canvaskit-assets.ts` | **不用改**：两者都是读 `BASE_URL`/`server.config.base` 的通用逻辑，base 回 '/' 后自动无前缀（73b5db05 的 guard 修复保留，对 tsdown npm 发布路径仍有意义） |
| ✅ | `index.html`（%BASE_URL% 占位）、`src/constants.ts:76-81` getShareURL、AppMenu.vue:59 / EditorView.vue:175 图标 BASE_URL 前缀 | %BASE_URL% 自动回落；getShareURL 随 §2.5 删除；图标引用是通用写法不用动 |
| ✂️ | `docker-compose.yml`：删 `PASSWORD_ENC_KEY` env + 注释块（usersys 密码加密专用，ARCH-usersys-pw-disappear §7.2）；`Dockerfile` 不动 | NPM 反代（location /Mobai/ 剥前缀）**外部运维项**：收拢后软路由改回根路径直通容器即可，本报告不操作、仅提示 |

### 2.7 i18n + 测试

| 操作 | 位置 |
|---|---|
| ✂️ | `packages/vue/src/i18n/messages/dialogs.ts`(+201)、`panels.ts`(+6)；8 locale × (`dialogs.json`,`panels.json`)（de/es/fr/it/ja/pl/ru/zh-cn）：删除 login/members/permissions/notifications/share 密码/profile/team 等 usersys+collab 键，**保留** home/folder/trash/newWhiteboard/teamSpace 等首页概念键（676aea3c、2a82090c 加入的）。zh-cn 是主用语言，逐键核对 |
| 🗑 | `tests/engine/app/collab/` 整目录(6 文件：bridge-resolve-room/config/room-id/room-roundtrip/server/session-idb-order)、`tests/engine/app/settings/share-popover-docpath.test.ts`、`team-store.test.ts` |
| ✂️ | `tests/engine/app/shell/menu/schema.test.ts`（菜单项断言随 schema 回退更新）；`tests/e2e/properties/page-section.spec.ts`(M,+55) 若含 usersys 场景则裁剪，否则保留 |
| ✅ | **稳定性批测试全保留**：`tests/engine/io/fig/export/{clone-safe,page-background,winding-rule}.test.ts`、`tests/engine/render/canvas/text-edit-caret.test.ts`、`tests/engine/app/document/io/binding-signal.test.ts`（file-bridge binding 信号，属保留清单 #4） |

### 2.8 AI 协同链路：明确不碰（保留清单 #3）

| ✅ 位置 | 原因 |
|---|---|
| `custom/file-bridge/mcp-proxy.ts` 全部（含 REQ-6 watchdog :140-155、REQ-7 headless 3s save_file :126-138） | 只依赖 MCP_AUTH_TOKEN env，与用户系统零耦合 |
| `packages/mcp/src/node-rpc-backend.ts`（save_file:321/handleSave:~275-294）、`packages/mcp/src/server.ts`(hybridSendRPC)、`browser-rpc.ts` | 官方 headless Node 编辑后端，零改动 |
| `src/app/automation/bridge/*`（server.ts connectAutomation、handlers.ts save_file:39、tool-handlers/apply/replay journal） | 浏览器 register + AI op apply + journal 防丢，零改动（9e27849b 的 graph watch 重试保留） |
| `src/app/bridge/client.ts` 的文件读写/SSE/watchPath/selfWriteMtime 部分、`op-journal.ts`、`document/io/*` autosave+beforeunload flush | 保留清单 #4 地基 |

---

## 3. 五个关键风险点结论

### R1：砍掉登录后 AI 协作链路怎么接 —— **config 直接开放，MCP register 链路保持不动**

**现状证据链：**
- `/api/v1/config` 目前仅登录态下发完整配置（custom/file-bridge/server.ts:1408-1431）：未登录 → `{token:null, pexelsKey:null}`(1412-1414)；登录后才带 `mcpAuthToken/mcpWsPath`(1427-1429)。
- 浏览器取 token：`resolveWebMCPHandle()`（src/app/automation/mcp/spawn.ts:395-421）在 fetch config 时附 `Authorization: Bearer <sessionToken>`(400-402)——这就是 9e27849b 刚加的。
- EditorView onMounted 先 `await restoreSession()` 再 `spawnMCPIfNeeded()`（src/views/EditorView.vue:268-271）。
- register 链路本身：`connectAutomation`(src/app/automation/bridge/server.ts) → ws://同源/ws(server.ts:1470 upgrade) → mcpProxy.pipe(:1830-1835) → MCP server browser-rpc。**这条链路上没有任何一处检查 session token**，MCP 侧只认 MCP_AUTH_TOKEN（mcp-proxy.ts:299 转发时校验 X-MCP-Token/Authorization）。

**结论：config 端点直接开放下发完整配置（回退到 Phase C 之前的语义），不需要保留任何门禁。**
- 大白话影响：以前「先登录，浏览器才能拿到 AI 写盘令牌」。个人版没有账号了，登录这道门拆掉后，打开页面 = 自动拿到 BRIDGE_TOKEN + Pexels key + MCP token。安全性没有实质下降——能打开这个页面的人本来就能通过 UI 读/写所有文件（UI 自己就是拿同一个 config token 在 PUT），MCP token 只是把「AI 从容器外写入」也放进同一信任域。部署边界继续靠 Docker：LAN 8080 + AI 专用 127.0.0.1:8081（docker-compose.yml ports）。若将来暴露到不可信网络，再单独加网关鉴权即可，不属于本次范围。

**最小改动方案（3 处，共 ~15 行）：**
1. `server.ts:1408-1431`：删 1411(`const user = sessionUser(request)`)、1412-1414(未登录分支)、1421-1426(collab 块)；无条件返回 token/pexelsKey/mcp 字段。
2. `spawn.ts:7,390-393,399-402`：删 `getSessionToken` import、Authorization header 拼装与注释（fetch config 不带 header）。**resolveWebMCPHandle 的其余逻辑（5 次重试/超时/null 降级）原样保留。**
3. `EditorView.vue:14,271`：删 restoreSession import + onMounted 里的 await。

**MCP register 链路（spawn.ts resolveWebMCPHandle + EditorView 时序 + connectAutomation + mcpProxy）：保持不动，零逻辑变更。** 验证方式：容器起好 → 浏览器开 /editor → `curl -H "Authorization: Bearer <MCP_AUTH_TOKEN>" localhost:<mcpPort>/health` 应从 no_app 变 ok（register 成功），AI set_fill 后画布实时可见（9e27849b 链路 + REQ-6/REQ-7 兜底不变）。

### R2：server.ts 混合文件 —— 端点归属总表

**必须保留（13 组，全部在 §2.1 ✅）：**
`GET /api/v1/health`(1404) · `GET /api/v1/config`(1408,简化后) · MCP 反代 `/mcp|/rpc|/health`+OPTIONS(1455-1468) · `/ws` upgrade(1470-1476)+Bun.serve websocket pipe(1829-1846) · mcpPath 桥接工具 POST(1478-1492) · `files` GET/POST(1494-1502) + rename/move/trash/meta/file CRUD(1615-1685, **PUT/POST=原子保存 writeFileAtomic+withWriteQueue**) · fonts 列表+下载(1504-1518) · `events` SSE(1520-1523) · active GET/POST(1525-1533) · recent GET/POST(1535-1543) · dirs/pins/trash(+restore/delete)(1559-1613) · 静态托管 serveStatic(1820-1822,134+)

**剔除范围（端点）：**
`/api/v1/collab/room`(1433-1452,HMAC+权限校验) · `/api/v1/online` GET/POST(1545-1557) · auth/login|logout|session(1689-1702) · members + /members/:id PATCH/DELETE(1704-1738) · avatars POST + /avatars/:name GET(1742-1754) · permissions GET/POST + permission-request(1756-1766) · notifications + read-all + :id/action(1770-1787) · share GET/POST/DELETE + verify + password + :token/content(1791-1818)

**剔除范围（非端点逻辑）：** import 行(§2.1)、parseCollabIceServers(58-74)、authStore/sessionUser/adminUser/bearerToken(289-310)、presence sweep 三件套+reportOnline/getOnline(312-362)、初始化块 collabRoomSecret/presence/authStore/permissions/notifications/shares/presenceSweepTimer(369-405)、797-1393 整段 handler（≈600 行）、mcpDeps.resolveActiveUserId(412)→`() => null`、activeReadKey(756-759) 简化、shutdown 里 presenceSweepTimer clearInterval(1851)。

**大白话影响：** server.ts 从 1,870 行缩到 ≈1,100 行。写盘鉴权回到「BRIDGE_TOKEN 单通道」；active/recent 的「按用户记打开文件」退化为「单一 owner 维度」（StateStore.keyFor(null)→primary，lib/state.ts:95-110），首页「最近/正在编辑」展示不受影响（个人版只有一个使用者）。MCP、SSE、原子保存一行不碰。

### R3：SharePopover 官方样式 —— **建议整体隐藏入口，不恢复 CollabPanel，不留空壳**

**事实：** 「官方原始分享」= `src/components/CollabPanel/`（CollabSharePopover/ShareOrJoinRoom/JoinRoomPrompt/ConnectedRoom）——它生成的是 **Trystero P2P 房间链接**（`getShareURL()`→`${origin}${base}share/${roomId}`，src/constants.ts:76-81；路由 `/share/:roomId`(router.ts:28)）。而剔除项 #4 删掉的正是这套东西的传输层（Trystero 信令 + Yjs CRDT + src/app/collab/ 全栈）。

**结论：官方分享弹窗在「人协已剔除」的前提下没有意义——按钮还在、链接能生成，但点开后没有任何房间协议去连接，是个纯装饰的死按钮。**
- **不建议恢复 CollabPanel 原始实现**（等于把剔除项 #4 的 UI 半边捡回来，后端是空的）。
- **不建议留空壳/置灰提示**：个人版「分享」概念本身不存在，多一个死入口只增加困惑。
- **建议**：删掉 EditorView 顶栏那整行（EditorView.vue:356-361 的 CollabAvatarStack + SharePopover），MobileHud 的两个官方组件一并删除（§2.4/2.5）。将来若真需要「局域网两人看一眼」，直接从 git 历史恢复 upstream collab 栈即可（一条 `git checkout fece63b5 -- src/app/collab ...` 的事），现在删不亏。
- 大白话影响：编辑器右上角干净了；所有「分享/密码/权限申请」相关的 UI 与 API 同时消失，和 server.ts 的 share/permissions 端点删除对齐，不留半拉子状态。

### R4：剔除后编译/lint 残留 —— 连带清理位置全表

原则：先删文件、再清引用，`bun run check`（oxlint+tsgo）会把漏网的 unused import / 未用变量全部报出来；Steiger 管架构边界。**按依赖顺序清理**（从叶子到根），每步跑一次 check：

1. **第一刀（纯删除，零引用风险）**：§2.1 lib 7 文件、§2.2 LoginView/auth/notifications/NotifyBell/profile+team 面板、§2.3 ShareGuestView/bridge share.ts/SharePopover、§2.4 presence use.ts/MobilePresencePopover/MobileShareButton、§2.5 collab 整目录/CollabPanel/collaboration-awareness.ts、测试 9 文件。
   - ⚠️ 注意：这些文件**互相引用**（如 ShareGuestView 引用 auth/session + bridge/share；CollabAvatarStack 被 EditorView 引用），所以删除后**必须立刻做第 2 步**，中间态编译不过属预期。
2. **第二刀（清引用，按文件）**：
   - `src/views/EditorView.vue` —— 最重的一个（8 处 import + presence watch + syncCollabRoom 块 + shareAccessible 块 + readOnly 拦截 3 个 watch(178-230) + onMounted restoreSession + 模板 PermissionRequestDialog/readonly banner/CollabAvatarStack+SharePopover 行/MobileHud :online-users）
   - `src/router.ts`（4 路由+守卫）、`src/App.vue`(4 处)、`src/main.ts`(2 处)
   - `src/components/EditorCanvas.vue`(4 处 collab/awareness 引用)
   - `src/app/bridge/client.ts`：删 `authHeader()`(102-106，getSessionToken 依赖)，`authHeaders()`(160-165) 简化为只走 BRIDGE_TOKEN；删 getPermissions/requestPermission/resolveCollabRoom/reportOnline/getOnline + BridgePresenceUser/BridgePermission 类型
   - `src/app/bridge/open-from-param.ts:1,16-18`（restoreSession）
   - `src/app/ai/chat/storage.ts:17,69-85`：删 restoreSession，config fetch 不带 header；**保留** pexelsKey→credential store 逻辑(80-85)（Pexels 服务端 key 兜底走这里）
   - `src/app/automation/mcp/spawn.ts`(§3-R1 第 2 条)
   - `src/views/FolderView.vue:25,321`、`WorkspaceTopBar.vue:7,116`、`MobileHud/context.ts+MobileHud.vue`（onlineUsers prop）
   - `src/app/editor/session/{types,modules}.ts` + `src/app/tabs/index.ts`（readOnly 字段与接线）
   - `src/constants.ts`（TRYSTERO/ROOM_*/PEER_COLORS/getShareURL）
   - `src/app/shell/menu/schema.ts + app-menu.ts`（回退到 fece63b5 版本对照）
3. **第三刀（i18n）**：messages/dialogs.ts+panels.ts 与 8 locale JSON 按 §2.7 逐键删。Steiger 会校验 `packages/vue/src/i18n/messages.ts` 与 locale JSON 的键一致性，漏删/多删都会报——以 check 输出为准收尾。
4. **第四刀（测试）**：§2.7 🗑 9 文件 + schema.test.ts 更新；跑 `bun run test:unit` 全绿。
5. **决策点 D1**：`src/components/workspace/ContextMenuOverlay.vue / MovePrompt / NewProjectPrompt / RenamePrompt` —— 属首页文件夹系统（保留），不删。
6. **决策点 D2**：WorkspaceTopBar 的「设置」按钮(108-115)：四 tab 删除后，建议**保留按钮但指向恢复后的官方 AI/模型设置对话框**（SettingsDialog 回退 upstream 版，§2.2）；若确定个人版完全不走应用内 AI chat 配置（只走 openclaw/MCP），则连按钮一起删。**默认推荐前者**：成本低（dialog.ts 重写时顺带），且官方 AI 入口不失踪。
7. **决策点 D3**：`StorageSettingsPanel.vue`（S3 远端存储配置，upstream 官方件）随 SettingsDialog 回退而保留在官方对话框里；个人版用不到但无害——若嫌多余可在回退后单独隐藏 storage tab，不展开。

### R5：官方最新版价值 —— **值得追，但不是现在追**

`fece63b5..upstream/master` = 73 commits，分类评估（只列与本项目相关的）：

| 类别 | commit（示例） | 对纯本地个人版的价值 |
|---|---|---|
| **保存/恢复可靠性**（直接强化保留清单 #4） | `e7c408a2` autosave coalesce(#531)、`37912d92/f22d2c9b/7b8e5fbf` document recovery 生命周期、`631fc25e` unsaved tabs recovery(#505)、`16b74a20` IDB 标准化 | **高**——官方在修我们也在修的同一类问题（autosave 覆盖/崩溃恢复），追了能少踩坑；但必须与我们的 journal/op-journal + bridge binding 语义合并验证，不能盲合 |
| **SVG 导入修复**（强化保留清单 #5） | `742522a6/cbf361f4` SVG clip path 保留/嵌套裁剪(#508) | 中高——我们已有「SVG 粘贴导入」(3dc931e4)，官方修的是 .fig/SVG 文件导入的 clipPath，互补不冲突 |
| **编辑器大改**（追平成本最高的部分） | `29ed07bc` canvas view state 分离(#518)、`7a02ee2c` split panes(#519)、`6193b6da` live JSX/HTML/CSS editing(#525)、`b93ffea0` Figma variants/component libraries(#512) | 中——功能诱人（分屏画布、组件库），但 #518/#519 重构的正是我们改得最重的 EditorView/canvas 区，**这是路线 B 成本高的主因**；个人版非刚需，可缓 |
| **Kiwi/FIG 加固** | `c7b944d1` FIG containers/DOM import 加固、`6bd31988` export 内存优化 | 中高——与我们 WindingRule 修复同区（packages/kiwi parse.ts），追的时候要小心别覆盖我们的归一化逻辑（先跑 winding-rule.test.ts） |
| **AI/MCP** | `a29f609d` MCP connections 与 models 分离(#522)、`39bc4d2e` 可复用 MCP connections(#516)、`9e93884e/3a2c8afc` AI silent failures 诊断、视觉参考附件系列 | 中——官方 AI chat 设置与我们「AI 走 openclaw/MCP」的定位重叠；MCP connection 管理若将来给个人版多 agent 用得上再追 |
| **杂项修复** | `4e48420a` Open 对话框多选(#552)、`15bd0ba1` 竖排文本 overlay(#543, 与 caret 同文件!)、`d7613f34` hit test 加速、`97bc86fa` fetch adapter type | 低-中——都是小改，追平时顺手带上即可 |

**成本结论：** 现在追 = §1.1 路线 B 的完整代价（85 冲突文件）。**建议把「追 upstream」拆成收拢之后的独立项目**：先按本报告完成 A 线剔除（自研面从 24k→~16k 行，冲突文件随之减少），稳定运行 1–2 周后做一次聚焦前向移植，优先级 = 保存/恢复可靠性 > SVG/kiwi 加固 > AI/MCP 设置 > 编辑器大改。每次追完跑全量质量门（check/test:unit/e2e + canvas 视觉快照）。

---

## 4. 保留功能完整性核对表（剔除后逐项确认）

| # | 保留项 | 依赖的关键代码 | 是否受剔除影响 | 验证点 |
|---|---|---|---|---|
| 1 | 首页概念：HomeView 落地页 + /editor 路由 | `src/views/HomeView.vue`(299)、`FolderView/TrashView`、router `/`,`/folder/:name`,`/trash`,`/editor`(保留路由 §2.2)；server dirs/pins/trash/recent 端点(§2.1 ✅) | **不受影响**。仅 WorkspaceTopBar 少一个 NotifyBell、FolderView 少 AccessDialog；「设置」按钮按 D2 处理。注意：HomeView 的文件夹/回收站 UI 依赖 manifest 白名单台账(server.ts:387-402, lib/manifest.ts)——保留 | `bun run check` + E2E：打开 / → 见首页网格；新建白板→进 /editor；重命名/移动/删到回收站/恢复全通 |
| 2 | Pexels 图片搜索（分页/颜色筛选/真实宽高比/服务端 key 兜底） | `packages/core/src/tools/stock-photo/providers.ts` + 分页/方向过滤(afedacb4、3f4bb8bb)——**不在剔除清单内，零改动**；key 链路：config.pexelsKey → src/app/ai/chat/storage.ts:80-85 → credential store（R1 开放 config 后自动生效） | **不受影响**。唯一接触面是 storage.ts 删 restoreSession(§2.7)，pexelsKey→credential 逻辑保留 | E2E：assets 面板搜图、翻页、颜色筛选；容器配 PEXELS_API_KEY 时前端无 key 输入框也能出图（服务端兜底） |
| 3 | AI 实时协作：MCP 工具集 + headless NodeEditSession + browserRPC register + REQ-7 3s save_file + watchdog | mcp-proxy.ts(REQ-6 :140-155, REQ-7 :126-138)、/mcp//rpc//ws 反代(server.ts:1455-1476 ✅)、node-rpc-backend(save_file:321)、connectAutomation+bridge handlers(§2.8 ✅) | **不受影响**，仅 R1 的 3 处 ~15 行改动（config 开放 + spawn.ts 去 header + EditorView 去 await）。register 链路本身零变更 | 容器起 MCP_AUTH_TOKEN → /editor 打开 → MCP server /health: no_app→ok；AI set_fill 画布实时可见；杀 MCP 进程 → watchdog ≤30s 自动拉起（REQ-6）；无浏览器时 AI 编辑 3s 内落盘（REQ-7, curl 看文件 mtime） |
| 4 | 本地/云保存语义：file-bridge 存储、原子保存、autosave 可靠性、SSE 自动刷新、journal 兜底、beforeunload flush | writeFileAtomic+withWriteQueue(server.ts:202-235 ✅)、events SSE(1520-1523 ✅)、FileWatcher+reconcile(389-402 ✅)、src/app/bridge/client.ts watchPath/selfWriteMtime(§2.8 ✅)、op-journal.ts(✅)、autosave beforeunload(src/app/document/autosave/create.ts + client.ts ✅) | **不受影响**。checkAuth 去掉 session 分支后写路径仍是 BRIDGE_TOKEN（client.authHeaders() 简化后行为等价）；active/recent 退化为 owner 单维度（首页展示不变） | E2E：编辑→关标签页(beforeunload flush)→重开内容在；外部改文件→SSE 自动 reload；断网/半写场景 journal 恢复；并发 autosave 不互相覆盖 |
| 5 | 稳定性修复批：caret 对比、页面背景持久化、原生下载导出、SVG 粘贴导入、WindingRule 归一化、中文支持(字体/i18n)、8位hex、按钮坐标存储、批量不屏闪 reload 守卫 | 全部在 packages/core|kiwi + src/app/editor/clipboard/system.ts —— **剔除清单完全不碰这些文件**（§2.7 ✅ 测试保留） | **基本不受影响**。唯一接触面：i18n locale JSON 双向编辑（usersys 键删除 vs 中文稳定性键保留）——按 §3-R4 第 3 刀逐键处理，zh-cn 重点核对；`vite.config base` 回 '/' 后 favicon/资源路径自动回落(index.html %BASE_URL%) | `bun run test:unit`(caret/page-background/winding-rule/clone-safe 四个专项测试全绿) + canvas 视觉快照对比（renderer-visuals.spec.ts）+ 中文界面抽查 |
| 6 | Docker 部署 | `Dockerfile`(不动)、`docker-compose.yml`(仅删 PASSWORD_ENC_KEY env, §2.6)；healthcheck 打 /api/v1/health(保留端点) | **不受影响**。MCP_AUTH_TOKEN/BRIDGE_TOKEN/DESIGN_ROOT/STATE_DIR env 语义全部不变 | `docker compose up -d --build` → health ok；8081 AI 端口 curl MCP 通；数据卷读写正常 |

---

## 5. 分阶段实施建议（每阶段独立可验证、可回滚）

> 前置：从 master 开分支 `streamline/personal-local`；先跑一遍基线 `bun run check && bun run test:unit` 留底。每个阶段 = 一个 commit + 一次质量门，失败即 revert 该 commit，不影响后续阶段。

**Phase 0 — 基线与快照（0.5h）**
- 记录当前 check/test:unit/e2e 状态；确认 Docker smoke 通过（compose up + health + 开首页）。
- 验证标准：基线全绿或已知失败清单留档。

**Phase 1 — 服务端剔除（file-bridge，§2.1）**
- server.ts 按 §3-R2 总表删端点/逻辑；删 lib 7 文件；config 开放(R1)。
- 验证：`bun run check`(custom/ 在 lint 范围) + 手工 curl 矩阵：health/config(无 token 应返回完整配置)/files CRUD/SSE/MCP /health；Docker smoke。MCP register 链路此时浏览器端还没改，但容器侧已就绪（旧前端带 session header 也能拿到配置——sessionUser 删除后该 header 被忽略，兼容）。

**Phase 2 — 用户系统剔除（§2.2 + §2.7 i18n 第一遍）**
- 删 LoginView/auth/notifications/settings profile+team/readonly/AccessDialog；router/App/main/FolderView/menus/i18n 清理。
- 验证：`bun run check` + `test:unit` + E2E 首页全流程（无登录直接进 HomeView；新建→编辑→保存）。此时 /editor 还带着 collab/presence 引用边——所以 Phase 3 紧跟，中间态允许 EditorView 编译不过**仅限本阶段 commit 内**（建议 Phase 2/3 合成一个 PR 但两个 commit）。

**Phase 3 — 分享/presence/collab 剔除（§2.3-2.5）**
- 删 ShareGuestView/SharePopover/bridge share.ts/CollabPanel/MobileHud presence+share；EditorView 大手术(presence/syncCollabRoom/shareAccessible/readOnly 四块 + 模板)；collab 整目录 + constants。
- 验证：`bun run check`(unused import 清零) + `test:unit`(删 collab 测试后全绿) + E2E /editor 打开无头像堆叠、无分享按钮、无 readonly banner；MCP register 链路复验(R1 验证点)。

**Phase 4 — /Mobai 子路径回退 + Docker env（§2.6）**
- vite base '/'、pwa manifest 去前缀、compose 删 PASSWORD_ENC_KEY。
- 验证：`bun run build` → dist/index.html 引用 `/assets/*`(无前缀)；Docker smoke 复跑；canvaskit.wasm 加载成功(浏览器 console 无 wasm 404)。NPM 侧提示运维改回根路径（外部，不操作）。

**Phase 5 — i18n/测试收尾 + 全量回归**
- i18n 逐键清理(R4 第 3 刀)、menu schema.test 更新、`test:dupes`(删了大块代码后克隆数应下降)。
- 验证：完整质量门 `bun run check && bun run format && bun run test:dupes && bun run test:tools && bun run test:unit && bun run test` + canvas 视觉快照对比(保留清单 #5) + §4 核对表逐项打勾。

**Phase 6（收拢稳定后，独立立项）— 聚焦追 upstream（§3-R5）**
- 优先级：保存/恢复可靠性(e7c408a2 等) > SVG/kiwi 加固(#508, c7b944d1) > AI/MCP 设置(#522/#516) > 编辑器大改(#518/#519，评估后再定)。
- 每次追平单独 PR + 全量回归；winding-rule/caret 专项测试作为前置护栏。

---

## 附：本报告引用的关键 commit（fork 侧）

| commit | 内容 | 归属 |
|---|---|---|
| `973e4231` | merge: absorb upstream v0.14.0 (44 commits) | 基线锚点 |
| `f8306112` | file-bridge web deployment Phase 1–5 | 保留(#4) |
| `777530fb/2bec5af0/4178e90f/fa3bf44a/92c01721...8b9e24e9` (usersys Phase A–G) | 用户系统全套 | 剔除(#1/#2) |
| `bb8404b6/37e6e4c1/8be685ab/9e27849b` | collab P0 + AI register 链路 | 人协部分剔除；**9e27849b 的 register 机制保留**(R1) |
| `1b09eed3/73b5db05` | presence avatars + /Mobai 子路径 | 剔除(#3/#5) |
| `afedacb4..d6a6f1df`(④-⑧号稳定性批)、`c3f9d366/191c734a`(WindingRule)、`604c45ab`(team-space home + /editor) | 稳定性修复 + 首页概念 | 保留(#1/#5) |
