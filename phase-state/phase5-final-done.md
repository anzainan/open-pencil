# phase5-final 完成报告

分支 streamline/personal-local，基于 HEAD abf4305d（Phase 1-4 已完成）。共改 40 文件（+38/-1620），已本地 commit。

## A. i18n 键清理（R4 第三刀）

从 `packages/vue/src/i18n/messages/dialogs.ts` + 8 locale JSON
（de/es/fr/it/ja/pl/ru/zh-cn，实际路径 `packages/vue/src/i18n/locales/<loc>/dialogs.json`）
删除 **149 键**，全部先 grep 确认零代码引用（含 `dialogs.x` / `dialogs.value.x` / 字符串字面量三种模式）。

- login.* (8) / logout.* (6)：登录登出
- perm.* (9)：权限申请
- share.* (40)：自研分享三件套 + 成员管理 + 密码
- team.* (33) / role.* (3) / profile.* (12)：团队/角色/Profile 面板
- notify.* (10) / unsaved.* (6) / access.* (7，'access.view' 等文件夹权限弹窗)
- accessButton/accessDialogTitle/Subtitle/accessTeamOption/accessCollabOption (5)、allRead、noNotifications、accepted、settingsProfile、settingsTeam、saveChanges、settingsSaved

**保留键（判定为官方基线内容或仍被代码引用）**：
- `notifications` —— 官方 AppToast.vue:68 viewport label（fece63b5 就有）
- `rememberCredentials` —— 官方 SettingsDialog.vue:120-125 引用（白名单外文件，不能动代码故保留键；与任务书「若有引用先修代码」规则冲突时以不破坏基线功能为准）
- `permissionRequest/Title` —— 官方 AI 工具权限弹窗（ACPPermissionDialog.vue），非 usersys
- home/folder/trash/newWhiteboard/teamSpace + move/rename/restore/deleteForever/cloudWorkspace/vectorizeKeyOptional/pexelsServerConfigured —— 本地工作区首页与文件稳定/AI 设置线，逐一确认 `dialogs.value.x` 引用存在

`bun run check:i18n` → All locale files are in sync ✓
panels.ts 无 usersys 残留（对照基线核实，无需改动）。

## B. readOnly 字段清理（E2）

判定方法：`git show fece63b5:<file> | grep -c readOnly` —— **全部 28 个文件官方计数为 0**，
即所有 readOnly 引用均为我们 Phase 1-2 所加 → 全删，组件行为回到基线。

| 位置 | 处理 |
|---|---|
| src/app/editor/session/types.ts | 删 `readOnly: false` 初始值 + `readOnly: boolean` 类型及注释（grep 0 ✓） |
| LayerTree.vue | 删 watch guard、onRenameStart 包装函数，恢复 `@rename-start="rename.start"` |
| Toolbar.vue | 删 EDITOR_TOOLS/EditorToolDef import、readonlyTools/visibleEditActions/visibleArrangeActions computed、`:tools` 覆盖；恢复基线单行 ToolbarRoot + editActions/arrangeActions 直传 |
| CodePanel.vue | 删 readOnly computed、import toggle 的 `v-if="!readOnly"`、两个 textarea 的 disabled + disabled:* class，恢复 `v-if="showImporter || !jsxCode"` |
| PagesPanel.vue | 删 store/readOnly（store 无其他用途）、startRename guard、add 按钮还原单行、rename ContextMenuItem 去 disabled、delete 恢复 `pages.length <= 1` |
| SelectionActionsControl.vue | 删新增 import/store/computed，恢复 `:disabled="!maskCommand.enabled.value"` 与 BooleanOperationsControl 无参形态 |
| properties/* 20 文件（LayoutSection 全家 + Fill/Stroke/Effects/Appearance/Mask/Page/Position/Typography/Variables/ComponentProperties/Constraints/FramePresetSelect） | 删各自新增的 computed/useEditorStore import、store const、readOnly computed、全部 `:disabled="readOnly"`（独立行 + 行内两种形态） |

注意：FlexControls/StrokeSection 官方原有 `import { ref } from 'vue'` 曾被我们替换为
`computed, ref`，删整行后恢复官方 `ref` import（否则 vue-tsc 报 Cannot find name 'ref'）。

## C. /Mobai 过期注释清理

- src/components/Shell/AppMenu.vue:59 → 「图标走 BASE_URL 前缀（根路径 /…）」
- src/constants.ts getShareURL → 「浏览器端分享链接基于当前 origin + BASE_URL（根路径 /）…」
- src/router.ts:9 → 「router base 跟随 import.meta.env.BASE_URL（根路径 /）…」
- **src/views/EditorView.vue:62 按任务书跳过未动**

## D. 全量回归结果

| 检查 | 结果 | 判定 |
|---|---|---|
| vue-tsc -p tsconfig.json | 0 error TS | ✓ |
| bun run lint（structure + type-aware） | 1 warning 0 errors（core/layout.ts max-lines，存量） | ✓ |
| check:i18n | All locale files are in sync | ✓ |
| check:packages / deps(knip) / audit | pass | ✓ |
| check:secrets(gitleaks) | FAIL —— gitleaks/go 二进制未安装（环境性，HEAD 同样失败） | 环境问题 |
| check:monorepo(sherif) | No issues found | ✓ |
| check:arch(steiger) | **7E/6W**，命中文件（use-workspace-grid/AvatarImage/FolderView/HomeView/TrashView）均非本次改动 = HEAD 基线 | ✓ 零新增 |
| test:type-shapes | 2 duplicates（automation/bridge/apply.ts、mcp/node-rpc-backend.ts 等未改文件，存量） | 存量 |
| test:tools | 4 pass / 0 fail | ✓ |
| test:dupes(jscpd) | 4 clones 全部在未改动文件（op-journal/fonts/headless-session/apply/snapshot），存量；本次删码后克隆数未增 | 存量 |
| **test:unit** | **2520 pass / 89 fail = HEAD 基线 89，零新增失败**（LFS fixture 指针 + headless 字体环境性） | ✓ |

format：`bun run format` 会顺带重排 HEAD 既有漂移的 57 个无关文件，已全部 `git checkout --` 还原，
最终 diff 恰好 = 本任务 40 文件。

## 待部署验证点（部署后人工/自动化确认）

1. zh-cn 界面：首页/文件夹/回收站、属性面板各 Section（Fill/Stroke/Layout/Grid/Typography…）、
   Pages/LayerTree/Toolbar/CodePanel 操作全部可用（readOnly 判断已删，行为=官方基线）。
2. Settings → General 的 "Remember credentials" 复选框文案正常（保留键未动）。
3. AI 聊天工具权限弹窗「{tool} is requesting permission」文案正常（保留键未动）。
4. Toast viewport（F8）aria label 正常。
5. 分享房间链接 /share/:roomId、路由根路径 / 行为不变（仅注释更新，无逻辑改动）。
