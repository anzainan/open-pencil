import { createRouter, createWebHistory } from 'vue-router'

import { hasSession, restoreSession } from './app/auth/session'
import EditorView from './views/EditorView.vue'
import FolderView from './views/FolderView.vue'
import HomeView from './views/HomeView.vue'
import LoginView from './views/LoginView.vue'
import TrashView from './views/TrashView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/', component: HomeView },
    { path: '/folder/:name', component: FolderView },
    { path: '/trash', component: TrashView },
    { path: '/editor', component: EditorView },
    { path: '/storage', redirect: '/' },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    // Yjs 协作房间保留；游客落地页 /share/:token 属 Phase C，本轮不加。
    { path: '/share/:roomId', component: EditorView }
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
