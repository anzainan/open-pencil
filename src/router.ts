import { createRouter, createWebHistory } from 'vue-router'

import BridgeFilesView from './views/BridgeFilesView.vue'
import EditorView from './views/EditorView.vue'
import StorageView from './views/StorageView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: EditorView },
    { path: '/storage', component: StorageView },
    { path: '/bridge', component: BridgeFilesView },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    { path: '/share/:roomId', component: EditorView }
  ]
})

export default router
