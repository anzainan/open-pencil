import { createRouter, createWebHistory } from 'vue-router'

import EditorView from './views/EditorView.vue'
import FolderView from './views/FolderView.vue'
import HomeView from './views/HomeView.vue'
import TrashView from './views/TrashView.vue'

const router = createRouter({
  // H 子路径（ARCH-mobai-subpath.md 方案 A）：router base 跟随构建 base（/Mobai/），
  // 否则页面 URL 落在 /Mobai/... 时路由全失配。
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: HomeView },
    { path: '/folder/:name', component: FolderView },
    { path: '/trash', component: TrashView },
    { path: '/editor', component: EditorView },
    { path: '/storage', redirect: '/' },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    // Yjs 协作房间（官方基线路由，8 位房间号）。
    { path: '/share/:roomId', component: EditorView }
  ]
})

export default router
