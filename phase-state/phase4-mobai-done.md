# phase4-mobai 完成报告

## 改动清单（仅白名单 3 文件）
| 文件 | 改动 |
|---|---|
| `vite.config.ts:21-22` | `base: '/Mobai/'` → `base: '/'`，注释同步改为"纯本地部署根路径"说明 |
| `vite/pwa.ts:10-11,19-27` | `navigateFallback: '/index.html'`；manifest `start_url:'/'`、`scope:'/'`；icons 去前缀 `/pwa-*.png`（3 个） |
| `docker-compose.yml:26-28` | 删除 `PASSWORD_ENC_KEY` env 行 + 上方 2 行相关注释（usersys 密码加密专用，用户系统已删）；Dockerfile 未动 |

## D 清单确认未动
- `packages/core/src/canvaskit.ts`、`vite/canvaskit-assets.ts`：未动（BASE_URL 通用逻辑自动回落）
- `index.html`（%BASE_URL%）、`AppMenu.vue:59`、`EditorView.vue:175` 图标前缀：未动，自动回落
- `src/constants.ts` getShareURL()：未动

## 验证结果（dev 自测）
- `bun run build` → exit 0（日志 /tmp/opencode/phase4-build.log）
- `dist/index.html` 资源引用均为 `/assets/...`，无 /Mobai 前缀；`grep -c Mobai dist/index.html` = **0**；`dist/sw.js`、manifest 亦 0 命中
- `dist/manifest.webmanifest`：start_url=`/`、scope=`/`、icons=`/pwa-*.png` ✓
- 全仓 Mobai 扫描（src/vite/packages/index.html/docker-compose.yml）：**5 处命中，全部为注释**，无代码引用：
  - `src/views/EditorView.vue:62` — 白名单外且 Phase 3 禁改文件 → **未动**，仅注释无害
  - `src/components/Shell/AppMenu.vue:59`、`src/constants.ts:74`、`src/router.ts:9-10` — 均为子路径时代的过期注释；代码本身走 BASE_URL 自动回落（router base 现在 = '/'），功能无影响。白名单外文件按规则不擅动，列为可选后续清理
- `bunx vue-tsc --noEmit -p tsconfig.json` → **0 errors**
- `bun run lint:structure` → **0 errors**（1 warning：某 src 文件 >600 行超长，改动前已存在，与本次无关）

## 待部署验证点（软路由实机）
1. 访问入口改为根路径 `http://<LAN IP>:8080/`（不再需要 /Mobai/），页面正常加载、刷新深链不 404（SPA fallback → /index.html）
2. PWA：图标 `/pwa-*.png` 可加载、可安装、standalone 打开正常；SW precache 生效
3. file-bridge 接口（/api/v1/*、写接口 BRIDGE_TOKEN）、MCP 反代（/mcp /rpc /health /ws）在根路径下仍可用
4. 部署侧 NPM/nginx 若仍有 `location /Mobai/` 剥前缀配置，可删除（仓库外操作）；软路由 .env 中残留的 PASSWORD_ENC_KEY 变量可清理
5. 上述 4 处过期注释（AppMenu/constants/router + EditorView）如后续统一清理再处理

## DoD
- [x] A-C 完成，D 清单未动
- [x] build 成功且产物无 /Mobai；全仓扫描仅无害注释
- [x] vue-tsc 0 errors；lint:structure 0 errors
- [x] done 文件补全（本文件）
- [x] git commit（message 含 phase4），本地提交未 push
