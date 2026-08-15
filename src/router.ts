import { createRouter, createWebHistory } from 'vue-router'

import { hasSession, restoreSession } from './app/auth/session'
import EditorView from './views/EditorView.vue'
import FolderView from './views/FolderView.vue'
import HomeView from './views/HomeView.vue'
import LoginView from './views/LoginView.vue'
import ShareGuestView from './views/ShareGuestView.vue'
import TrashView from './views/TrashView.vue'

const router = createRouter({
  // H 子路径（ARCH-mobai-subpath.md 方案 A）：router base 跟随构建 base（/Mobai/），
  // 否则页面 URL 落在 /Mobai/... 时路由全失配。
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/', component: HomeView },
    { path: '/folder/:name', component: FolderView },
    { path: '/trash', component: TrashView },
    { path: '/editor', component: EditorView },
    { path: '/storage', redirect: '/' },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    // 游客外链落地页 /share/:token（meta.public 不走登录守卫）。
    // token = randomBytes(16).hex 恰好 32 位 [0-9a-f]；用 \w{32} 与 Yjs 房间号
    // （8 位 [a-z0-9]，ROOM_ID_LENGTH）区分：先匹配外链，其余长度回落到协作房间。
    { path: '/share/:token(\\w{32})', component: ShareGuestView, meta: { public: true } },
    // Yjs 协作房间保留（8 位房间号），与 /share/:token 共存。
    { path: '/share/:roomId', component: EditorView },
    // H 外链短码顶层路由：/Mobai/{token}（NPM 剥前缀后落到 /{token}）。
    // 放在静态段路由之后（/login /editor /folder /trash /storage /demo /share 优先命中）。
    // token 为 8~12 位 base62 短码（\w{6,32} 兼容旧 32hex 遗留外链），参数名 shareToken。
    { path: '/:shareToken(\\w{6,32})', component: ShareGuestView, meta: { public: true } }
  ]
})

// 路由守卫（Phase A）：meta.public（登录页）放行；无 session → 重定向 /login；
// 有 session → 放行。已登录访问 /login → 回首页。
// 守卫先等启动恢复完成（restoreSession 幂等），保证「记住登录」刷新后直接回首页。
router.beforeEach(async (to) => {
  await restoreSession()
  if (to.meta.public) {
    if (to.path === '/login' && hasSession()) return { path: '/' }
    return true
  }
  if (!hasSession()) return { path: '/login' }
  return true
})

export default router
