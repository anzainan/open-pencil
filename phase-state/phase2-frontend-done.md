# phase2-frontend 完成报告

分支 streamline/personal-local，HEAD da42199c（phase1-server 已落地），官方基线 fece63b5。目标：前端删用户系统（登录/认证/通知/只读拦截/权限 UI + 自制分享）+ 设置区恢复官方三 Tab。合计 49 文件，+75 / -4229。

## 改动清单

### A. 删除文件（git rm，任务书 13 件 + 补删 4 件 = 17 源文件 + 2 测试）
LoginView.vue(119) / ShareGuestView.vue(405) / auth/logout-dialog.ts(12) / notifications/{index,store}.ts(50) / NotifyBell.vue(227) / editor/readonly.ts(15) / PermissionRequestDialog.vue(64) / ProfileSettingsPanel.vue(273) / TeamSettingsPanel.vue(465) / settings/team-store.ts(184) / bridge/share.ts(274) / SharePopover.vue(880)。
**清单外补删（被删模块的引用方，不删则编译/测试崩）**：LogoutDialog.vue(83)、AccessDialog.vue(319)、tests/engine/app/settings/share-popover-docpath.test.ts(161，从磁盘读 SharePopover.vue 会崩)、tests/engine/app/settings/team-store.test.ts(222，import 已删 team-store——自测时发现)。

### B. 各文件接线拆除
- `src/router.ts`(±29)：删 /login、/:shareToken(\w{6,32}) 路由 + beforeEach 登录守卫；按基线恢复 `/share/:roomId`→EditorView（官方就有该路由）；保留 BASE_URL history 与 /、/folder/:name、/trash、/editor、/storage→/、/demo
- `src/App.vue`(-5)：删 restoreSession 调用 + LogoutDialog import/模板节点
- `src/main.ts`(±8)：删 restoreSession async 包装，改直调 `void openFileFromQueryParam()`
- `WorkspaceTopBar.vue`(±4)：NotifyBell import+节点删除；设置按钮 'storage'→**'ai'**（D2）
- `FolderView.vue`(-17)：AccessDialog 四处解线（import/ref/按钮/节点）
- `EditorView.vue`(±103)：删 currentUser/openPermissionRequest/SharePopover import + shareAccessible 块 + 只读拦截整块（isViewTool/sceneBaseline/lastInterceptedVersion/3 个 watch）+ readonly banner div；collab 连接条件去掉 `&& !!currentUser.value`、watch 依赖去 currentUser（**collab wiring 原样保留，phase3 处理**）
- `bridge/client.ts`(-29)：BridgePermission 接口 + getPermissions/requestPermission 删除；AuthError/getSessionToken 保留（session.ts 留存，见 E1）
- `tabs/index.ts`(±67)：B3 只读权限轮询整块（READONLY_PERMISSION_POLL_MS/timers/start-stop）、canEdit 打开检查、closeTab stopReadonlyPermissionWatch×2、dialogMessages import 全删
- `modules.ts`(±21)：readonlyBlocked + saveFigFile/saveFigFileAs 两个包装 → 直引 documentIO；未用 import 清理

### C. 设置区恢复官方（fece63b5）
| 文件 | 处理 | 结果 |
|---|---|---|
| `src/app/settings/dialog.ts` | 重写为基线三 Tab（'ai'\|'media'\|'storage'，默认 'ai'） | 官方形态 ✓ |
| `src/components/settings/SettingsDialog.vue` | 整体恢复基线（-170 行左右） | 官方形态 ✓ |
| StockPhotoKeysSection / StorageSettingsPanel / VectorizeSettingsSection | **零 diff**（git status 确认未动） | ✓ |

### D. 菜单恢复官方
`schema.ts`(±7) / `app-menu.ts`(±21) / `tests/.../schema.test.ts`(±12) 整体回退 fece63b5：Save/Save As… 文案、autosave 条目等。任务书给的 ±7/±21 行数与全量回退精确吻合 → 确认全回（未做部分保留）。

### E. i18n 键恢复（whitelist 外，被 C/D 强制）
fork 删过基线文件引用的两个键：`messages/menu.ts` `autosave: 'Auto-save to local file'`、`messages/dialogs.ts` `settingsAIAndAgents: 'AI & agents'`。已按 fece63b5 译文恢复至 messages/*.ts + 8 locale（de/es/fr/it/ja/pl/ru/zh-cn 的 menu.json/dialogs.json，各 +1 行）；`check:i18n` 通过。

## 决策 / 偏离记录
- **D2**：顶栏设置按钮入口 → 'ai' Tab（用户拍板）。
- **E1 留存 `src/app/auth/session.ts`**（任务书 A.2 要求删）：whitelist 外 7 个文件 import 它，其中 2 个在禁区（collab/local-awareness.ts、CollabPanel/context.ts），另 MobileHud/context、presence/use、ai/chat/storage、bridge/open-from-param、bridge/client。删除必然触发 🚨 禁区改动或大量 vue-tsc 错误；保留后为惰性文件——phase1 已删服务端登录端点，restoreSession/hasSession 运行时恒空操作。
- **E2 留存 `editor/session/types.ts` 的 readOnly 字段**（A.8）：约 38 个非 whitelist 组件读 `store.state.readOnly`（properties/*、Toolbar、LayerTree、CodePanel、PagesPanel）。全部写侧 + 拦截逻辑已删，字段恒 false → 行为等价于删除，避免几十个 vue-tsc 错误。
- **E3 留存 `settings/useAvatarURL.ts`**（A.6）：被 `src/components/ui/AvatarImage.vue` 引用，后者又被保留的 CollabAvatarStack / MobilePresencePopover 使用；check:arch 对应告警为既有项（与 HEAD 逐项相同）。

## 自测结果
| 检查 | 命令 | 结果 |
|---|---|---|
| vue-tsc | `bunx vue-tsc --noEmit -p tsconfig.json` | **4 → 1**：仅剩 EditorView.vue(275,21) TS2739 BridgePresenceUser[] vs Ref——phase3 预期残留 ✓（DoD ≤1） |
| lint:structure | `bun run lint:structure` | **0 errors**（2 max-lines warning 既有；client.ts 反从 669→640 行变短）✓ |
| check:arch | `bun run check:arch` | 7E/6W，用 worktree 对 HEAD 逐项 diff：**完全相同**，零新增 ✓ |
| i18n | `bun run check:i18n` | All locale files are in sync ✓ |
| 残留 grep | LoginView\|restoreSession\|NotifyBell\|PermissionRequestDialog\|ShareGuestView\|SharePopover\|ProfileSettingsPanel\|TeamSettingsPanel\|team-store\|useAvatarURL | 仅剩无害引用：session.ts 定义 + open-from-param/ai-chat-storage 调用（E1）、AvatarImage/useAvatarURL（E3）、CollabPanel/CollabSharePopover.vue（禁区同名异文件，非本次删的 SharePopover）；`settingsDirty` **0 命中** ✓ |
| 单测（改动域） | `bun test tests/engine/app/{settings,shell/menu,tabs,editor,ai}` | settings+menu 18/18 pass；tabs/editor/ai 仅既有失败 setPlannedFilePath×3（git stash 验证 HEAD 同样挂，与本轮无关）✓ |
| 单测（全量） | `bun run test:unit` | 2535 pass / 98 fail：fail 全部为 .fig fixture 是 Git LFS 指针文件未拉取（"invalid zip data"），环境性、与本轮无关 ✓ |

## 待部署验证点
1. `bridge/open-from-param.ts` 的 `hasSession()` 门现在恒 false → **?file= 云端文件恢复链路运行时已死**；若该功能需要保留，phase3/4 改为不经 session 直接读本地缓存。
2. Playwright E2E 需起应用环境，本轮未跑——部署后重点：登录页消失、`/share/:roomId` collab 房间链接仍可达、设置对话框三 Tab + AI Tab 内容完整、菜单 Save/Save As… 行为正常。
3. 菜单文案回官方口径（'Save'=云保存 / 'Download to local…'）——用户可见变化；若 fork 原意是区分云端/本地语义，此处为需确认的回调点。
4. E1 session.ts、E2 readOnly 字段属"惰性留存"，phase3/5 收尾时一并清理（届时禁区 collab wiring 已重构）。
