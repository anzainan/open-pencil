import { createRouter, createWebHistory } from 'vue-router'

import EditorView from './views/EditorView.vue'
import FolderView from './views/FolderView.vue'
import HomeView from './views/HomeView.vue'
import TrashView from './views/TrashView.vue'

const router = createRouter({
  // router base 跟随 import.meta.env.BASE_URL（根路径 /），保证部署子路径变化时路由不失配。
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
