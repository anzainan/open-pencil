# phase3-collab 完成报告

分支 `streamline/personal-local`，官方基线 = `fece63b5`。目标：剔除加在官方多人协作上的自研改造（presence 台账 / 自动进房 / HMAC 房间派生 / 头像叠加 / P0 光标修正），官方 P2P collab 回到 upstream 行为；顺带修复 `?file=` 刷新恢复链路（去 session 化）。

## A. presence 在线感知剔除
- 🗑 `src/app/presence/use.ts` 删除（8s 心跳 + SSE online.changed），presence 目录整体消失。
- ✂️ `EditorView.vue`：删 `useDocumentPresence` import、`presencePath` watch、`provideCollabPanel(onlineUsers)`；模板 `<MobileHud :online-users>` → `<MobileHud />`（官方形态）。
- ✂️ `client.ts`：确认 `reportOnline` / `getOnline` 方法已删干净（grep 0 命中，Phase 1 主体 + 本阶段核对）。
- 🔄 `src/components/MobileHud/*`（4 文件）：全部还原为官方基线形态——`MobilePresencePopover.vue`、`context.ts`、`MobileHud.vue`、`MobileShareButton.vue` 与 `fece63b5` **逐字节一致**（git hash-object 验证）。presence popover 现为官方 collab peers 展示（initials+色块，无 AvatarImage/bridge presence）；分享按钮走官方 Trystero room link。

## B. collab 改造还原
- 🗑 `src/app/collab/config.ts` 删除（自研传输配置 fetcher，与服务端 `config.collab` 块成对消失）。
- 🔄 `awareness.ts` / `local-awareness.ts` / `room.ts` / `session.ts` / `use.ts`：还原官方基线——删 avatarImage/avatarBg 注入、自建 broker/ICE 配置化、RC-B IDB 回灌抑制块（whenSynced+syncAllNodesToYjs）、`requestRepaint→requestRender`。逐文件与 `fece63b5` hash 比对：**5 个全部 MATCH-BASELINE**。
- ⚠️ `types.ts`：唯一非基线文件——保留 `avatarImage?/avatarBg?` 两个可选字段并加注释（官方 awareness 不再下发，仅白名单文件 CollabPanel context 读取，恒为 undefined）。原因：CollabPanel 整目录在「不要动」清单内且引用该类型形状。
- ✅ 未动：`collab/context.ts`、`yjs-sync.ts`、`src/components/CollabPanel/`（官方地基 + 白名单保留）。

## C. EditorView 手术
- 删自研块：`syncCollabRoom()` 自动进房全函数 + rAF 重试兜底、`getCollabConfig` import、binding/readOnly 三个 watch、presence 块（见 A）、模板 `CollabAvatarStack v-if=readOnly` → `<CollabPanel />`。
- 保留官方接线：`useCollab(getActiveStore)` + `provide(COLLAB_KEY, collab)`、`<CollabPanel />`、`<SafariBanner />`——与基线模板接线一致（行号偏移因 Phase 1/2 保留块）。
- 保留 Phase 1/2 成果：autosave / MCP spawn / connectAutomation 等未回退。

## D. R4 引用清理
- `client.ts`：删 `authHeader()`；`authHeaders()` 简化为仅 BRIDGE_TOKEN（单用户本地模式）；`resolveCollabRoom`/权限相关确认无残留引用。
- `src/app/ai/chat/storage.ts`：config fetch 去 `restoreSession` + session header，改无条件直取 `/api/v1/config`；pexelsKey→credential store 兜底逻辑保留。
- `useAvatarURL.ts`（Phase 2 惰性留存文件，被 AvatarImage.vue 引用）：**删 `authHeader` import/调用 → 无头 fetch**。口径 = Phase 2 报告 E3：avatar 上传服务端已在 Phase 1 删除、运行时不走该链路；fetch 失败返回 null 由字符头像 fallback 接管。client.ts 的 authHeader 保持删除状态未回加。
- `src/constants.ts`：TRYSTERO_APP_ID / ROOM_ID / PEER_COLORS / getShareURL 保留（官方 collab 栈在用，无 unused）。

## E. ?file= 刷新恢复链路修复
- `open-from-param.ts`：删 `restoreSession()` + `hasSession()` 门（Phase 2 后恒 false → 功能死链）；改为直接信任 `?file=<相对路径>` → getFileMeta + 本地缓存/工作区文件恢复，不依赖任何登录态。
- 保留优雅降级：401（bridge token 未配置/不匹配）或网络错误 → console.warn、不清 URL 参数，刷新可重试；文件不存在按基线走空白画布。

## 归属判定表（ours vs official @ fece63b5）
| 项 | 判定 | 处理 |
|---|---|---|
| presence/use.ts、collab/config.ts、syncCollabRoom 自动进房、HMAC resolveCollabRoom、avatarImage/awareness 注入、RC-B IDB 抑制块 | ours（自研） | 删除/还原基线 |
| MobilePresencePopover / MobileShareButton / CollabPanel / yjs-sync / collab context.ts | official | 保留（MobileHud 4 文件逐字节回基线；CollabPanel 白名单不动） |
| BridgePresenceUser interface（client.ts:68） | ours 类型，但被白名单 CollabPanel/context.ts `import type` 引用 | **保留**（删则 vue-tsc 破且违反白名单约束）；无运行时逻辑残留 |
| types.ts avatarImage/avatarBg 字段 | ours 兼容字段 | 保留 + 注释说明恒 undefined |

## 自测结果
- `bunx vue-tsc --noEmit -p tsconfig.json` → **0 errors**（上次遗留的 useAvatarURL authHeader TS 错误已消除）
- `bun run lint:structure` → **0 errors**（1 warning，既有）
- `bun run check:arch` → **7E/6W = 与 HEAD 基线完全一致，零新增**（全部为 views/{Folder,Home,Trash}View.vue 的 no-native-title 既有条目，与本阶段文件无关）
- `bun run check:i18n` → All locale files are in sync
- 残留 grep：`syncCollabRoom/getCollabConfig/useDocumentPresence/reportOnline/getOnline` **0 命中**；`BridgePresenceUser/MobilePresencePopover/MobileShareButton` 命中均为上表已解释的白名单/官方基线文件
- `bun run test:unit`（427 files / 2610 tests）：**89 fail = 与 HEAD 纯净基线 worktree 全量跑出的失败集合一致**（LFS .fig fixture 未拉取 + headless 字体/visual 环境性失败，含 3 个 collab yjs-sync `window is not defined`——HEAD 上同样失败，属既有问题）；phase3 **零新增失败**。room-roundtrip.test.ts 全过。

## 待部署验证点
1. **P2P 分享链接**：桌面顶栏 Share → 生成 Trystero room link（无自动进房、无 HMAC 派生），第二端输房间号加入，光标/选择/节点编辑双向同步正常；断网回落官方默认 relay。
2. **?file= 刷新恢复**：带 `?file=<relpath>` 刷新页面 → 直接走本地缓存/工作区恢复打开（无登录跳转）；文件已删除 → 空白画布 + 参数保留可重试；401/token 不匹配不清参数。
3. **MCP register 复验**：单用户本地模式下 MCP session token 注册链路不受 authHeader 删除影响，`eval`/AI 编辑照常工作（Phase 2 既有行为回归确认）。
