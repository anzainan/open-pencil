import { createRouter, createWebHistory } from 'vue-router'

import EditorView from './views/EditorView.vue'
import FolderView from './views/FolderView.vue'
import HomeView from './views/HomeView.vue'
import TrashView from './views/TrashView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/folder/:name', component: FolderView },
    { path: '/trash', component: TrashView },
    { path: '/editor', component: EditorView },
    { path: '/storage', redirect: '/' },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    { path: '/share/:roomId', component: EditorView }
  ]
})

export default router
