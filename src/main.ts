import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import { openFileFromQueryParam } from '@/app/bridge/open-from-param'
import { preloadFonts } from '@/app/editor/fonts'
import {
  activeStorageProviderID,
  BRIDGE_STORAGE_PROVIDER,
  S3_STORAGE_PROVIDER,
  storagePreferencesComplete
} from '@/app/integrations/storage'
import { IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

// 本地工作区（file-bridge）接管存储：遗留的 s3-compatible 若从未配置则切回 bridge-fs。
if (
  activeStorageProviderID.value === S3_STORAGE_PROVIDER.id &&
  !storagePreferencesComplete(S3_STORAGE_PROVIDER.id)
) {
  activeStorageProviderID.value = BRIDGE_STORAGE_PROVIDER.id
}

preloadFonts()
const head = createHead()
createApp(App).use(router).use(head).mount('#app')
void openFileFromQueryParam()

if (!IS_TAURI) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
    // 部署后旧 SW 会继续服务预缓存的旧页面；controllerchange 是新 SW 接管当前页面的信号，
    // 触发一次刷新即可切换到新版（autoUpdate 静默升级 + 本刷新 = 后台换版 + 自动刷新一次）。
    // 单次刷新语义：新 SW 首次控制本页面才触发，刷新后控制器已固定，不会循环刷新。
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload()
      })
    }
    return undefined
  })
}
