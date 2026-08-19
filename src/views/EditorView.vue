<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useEventListener, useUrlSearchParams } from '@vueuse/core'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'

import { useViewportKind, formatShortcut, useI18n } from '@open-pencil/vue'
import { useKeyboard } from '@/app/shell/keyboard/use'
import { loadEditorLayout, saveEditorLayout } from '@/app/shell/layout-storage'
import { openFileFromPath, useEditorMenu } from '@/app/shell/menu/use'
import { useCollab, COLLAB_KEY } from '@/app/collab/use'
import { getCollabConfig } from '@/app/collab/config'
import { connectAutomation } from '@/app/automation/bridge/server'
import { spawnMCPIfNeeded } from '@/app/automation/mcp/spawn'
import { isTauri } from '@/app/tauri/env'
import { appMenuShortcut } from '@/app/shell/menu/shortcut'
import { createDemoShapes } from '@/app/demo/document'
import { useEditorStore } from '@/app/editor/active-store'
import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { useDocumentPresence } from '@/app/presence/use'
import { createTab, activeTab, getActiveStore, tabCount } from '@/app/tabs'

import EditorCanvas from '@/components/EditorCanvas.vue'
import LayersPanel from '@/components/LayersPanel.vue'
import MobileDrawer from '@/components/MobileDrawer.vue'
import MobileHud from '@/components/MobileHud/MobileHud.vue'
import PropertiesPanel from '@/components/PropertiesPanel.vue'
import RenameSelectionDialog from '@/components/selection/RenameSelectionDialog.vue'
import TabBar from '@/components/TabBar.vue'
import Tip from '@/components/ui/Tip.vue'
import Toolbar from '@/components/Toolbar/Toolbar.vue'
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'

const route = useRoute()
const params = useUrlSearchParams('history')
const showChrome = !('no-chrome' in params)

const createdInitialTab = tabCount() === 0
const firstTab = createdInitialTab ? createTab() : (activeTab.value ?? createTab())
const store = useEditorStore()
const { dialogs } = useI18n()
const { isMobile } = useViewportKind()

if (createdInitialTab && route.meta.demo && !('test' in params)) {
  void createDemoShapes(firstTab.store)
}

// tab 标题同步 documentName：demo 路由固定「Demo」，其余跟随 activeTab 文档名，
// undefined（空文档 / Untitled）回落 App.vue 的 titleTemplate 兜底「OpenPencil」。
useHead({
  title: computed(() => {
    if (route.meta.demo) return 'Demo'
    const name = activeTab.value?.store.state.documentName
    return name && name !== 'Untitled' ? name : undefined
  })
})
useKeyboard()
useEditorMenu()

const collab = useCollab(getActiveStore)
provide(COLLAB_KEY, collab)
// 编辑器头部多人头像堆叠（官方 CollabAvatarStack）需要 CollabPanel 的 provide 树。
// C-live：bridge 文档打开（storage binding.documentId 生效）才启用在在线感知；
// 游客 / 空画布 / demo 无 binding → 不启用心跳（游客不启用，避免无鉴权上报）。
const presencePath = ref<string | null>(null)
watch(
  [() => activeTab.value, () => activeTab.value?.store.getBindingDocumentId()?.value],
  () => {
    const binding = activeTab.value?.store.getStorageBinding()
    presencePath.value =
      binding?.providerId === BRIDGE_PROVIDER_ID && binding.documentId ? binding.documentId : null
  },
  { immediate: true }
)
const { onlineUsers } = useDocumentPresence(presencePath)
provideCollabPanel(onlineUsers)

// P0 官方实时协作自动进房：可编辑用户打开 bridge 存储文档 → 服务端派生房间号 →
// connect + 立即全量灌入 Yjs（并列 presence 判定，同一 binding 源，避免多余请求）。
// 只读 / 游客 / 空画布 / 非 bridge 文档 → 不 connect（头像已由 presence 展示）。
// 触发信号用「binding 就绪」的真反应式 ref（getBindingDocumentId），不再依赖
// documentName 的「值不变陷阱」：先置 documentName 后设 binding 的时序下，binding
// 从 null→有值必然触发本 watch（tabs/openStorageDocumentInNewTab 也在改 documentName
// 之前/之后都同步刷新该信号）。
const collabRoomPath = ref<string | null>(null)
let collabConnectSeq = 0
function connectSyncCollabRoom(): void {
  void syncCollabRoom()
}
async function syncCollabRoom(attempt = 0): Promise<boolean> {
  const seq = ++collabConnectSeq
  const tab = activeTab.value
  const binding = tab?.store.getStorageBinding()
  const documentId =
    binding?.providerId === BRIDGE_PROVIDER_ID && binding.documentId ? binding.documentId : null
  const shouldConnect = !!documentId && !store.state.readOnly
  if (!shouldConnect) {
    if (collabRoomPath.value) collab.disconnect()
    collabRoomPath.value = null
    // 首开 bridge 文件时序兜底：binding 可能恰在此次触发前尚未就绪（先置 documentName、
    // 后设 binding），但该触发已经消费了本次 deps 变化；若 binding 稍后就绪，getBindingDocumentId
    // 信号会再触发一次。为收敛「绑定尚空但 bridge 前台打开中」的残余窗口，这里按位递交一次
    // rAF 重试（不轮询，最多 1 次），保证任何路径首次打开都进房。
    const isBridgeForegroundOpen =
      !!tab?.store.state.documentName && tab.store.state.autosaveEnabled && !store.state.loading
    if (attempt === 0 && isBridgeForegroundOpen && !documentId) {
      requestAnimationFrame(() => {
        if (seq !== collabConnectSeq) return
        void syncCollabRoom(attempt + 1)
      })
    }
    return false
  }
  if (collabRoomPath.value) {
    if (collabRoomPath.value === documentId) return true
    collab.disconnect()
    collabRoomPath.value = null
  }
  // 先取传输配置（room.ts 同步读缓存；失败回退官方默认），再解析房间号。
  await getCollabConfig()
  const roomId = await bridgeClient.resolveCollabRoom(documentId)
  if (!roomId) return false
  if (seq !== collabConnectSeq) return false
  collab.disconnect()
  collabRoomPath.value = documentId
  collab.connect(roomId)
  collab.syncAllNodesToYjs()
  return true
}
watch(
  [
    () => activeTab.value,
    () => activeTab.value?.store.getBindingDocumentId()?.value,
    () => store.state.readOnly
  ],
  () => {
    connectSyncCollabRoom()
  },
  { immediate: true }
)

// H 子路径：图标走 BASE_URL 前缀（/Mobai/favicon-32.png）。
const faviconSrc = import.meta.env.BASE_URL + 'favicon-32.png'

useEventListener(
  document,
  'wheel',
  (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault()
  },
  { passive: false }
)

const automationCleanup = ref<(() => void) | null>(null)
const mcpCleanup = ref<(() => void) | null>(null)
const fileAssociationCleanup = ref<(() => void) | null>(null)
const initialEditorLayout = loadEditorLayout()

type PendingOpenFile = {
  path: string
}

async function openPendingAssociatedFiles() {
  const { invoke } = await import('@tauri-apps/api/core')
  const files = await invoke<PendingOpenFile[]>('take_pending_open')
  for (const file of files) {
    await openFileFromPath(file.path)
  }
}

async function bindAssociatedFileOpen() {
  if (!isTauri()) return
  const { listen } = await import('@tauri-apps/api/event')
  fileAssociationCleanup.value = await listen('open-associated-files', () => {
    void openPendingAssociatedFiles().catch((e) => console.error('[Open With]', e))
  })
  await openPendingAssociatedFiles()
}

onMounted(async () => {
  try {
    const mcp = await spawnMCPIfNeeded()
    mcpCleanup.value = mcp?.disconnect ?? null
    const tauri = isTauri()
    // Desktop/dev always connect automation; web production connects only when the
    // container advertises a same-origin MCP relay (wsPath present).
    if (import.meta.env.DEV || tauri || mcp?.wsPath) {
      automationCleanup.value = connectAutomation(
        getActiveStore,
        mcp?.authToken ?? null,
        mcp?.wsPath ? { wsPath: mcp.wsPath } : undefined
      ).disconnect
    }
  } catch (e) {
    console.warn('[MCP]', e)
  }

  try {
    await bindAssociatedFileOpen()
  } catch (e) {
    console.error('[Open With]', e)
  }
})

onUnmounted(() => {
  mcpCleanup.value?.()
  automationCleanup.value?.()
  fileAssociationCleanup.value?.()
})
</script>

<template>
  <div data-test-id="editor-root" class="relative flex h-screen w-screen flex-col">
    <RenameSelectionDialog />
    <TabBar />

    <!-- Desktop layout -->
    <SplitterGroup
      v-if="!isMobile && showChrome && store.state.showUI"
      :key="activeTab?.id"
      direction="horizontal"
      class="flex-1 overflow-hidden"
      @layout="saveEditorLayout"
    >
      <SplitterPanel
        id="layers"
        :default-size="initialEditorLayout[0]"
        :min-size="10"
        :max-size="30"
        class="flex"
      >
        <LayersPanel />
      </SplitterPanel>
      <SplitterResizeHandle
        data-test-id="left-splitter-handle"
        class="group relative z-10 -mx-1 w-2 cursor-col-resize"
      >
        <div class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
      </SplitterResizeHandle>
      <SplitterPanel id="canvas" :default-size="initialEditorLayout[1]" :min-size="30" class="flex">
        <div class="relative flex min-w-0 flex-1">
          <EditorCanvas />
          <Toolbar />
        </div>
      </SplitterPanel>
      <SplitterResizeHandle class="group relative z-10 -mx-1 w-2 cursor-col-resize">
        <div class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
      </SplitterResizeHandle>
      <SplitterPanel
        id="properties"
        :default-size="initialEditorLayout[2]"
        :min-size="10"
        :max-size="30"
        class="flex flex-col"
      >
        <div
          class="flex shrink-0 items-center justify-between border-b border-border px-1.5 py-1.5"
        >
          <CollabAvatarStack v-if="!store.state.readOnly" />
        </div>
        <PropertiesPanel />
      </SplitterPanel>
    </SplitterGroup>

    <!-- Mobile layout -->
    <div
      v-else-if="isMobile && showChrome && store.state.showUI"
      :key="'mobile-' + activeTab?.id"
      class="flex flex-1 overflow-hidden"
    >
      <div class="relative flex min-w-0 flex-1">
        <EditorCanvas />
        <MobileHud :online-users="onlineUsers" />
        <Toolbar />
      </div>
      <MobileDrawer />
    </div>

    <!-- Collapsed UI (showUI=false) -->
    <div
      v-else-if="showChrome"
      :key="'collapsed-' + activeTab?.id"
      class="flex flex-1 overflow-hidden"
    >
      <div class="relative flex min-w-0 flex-1">
        <EditorCanvas />
        <div
          v-if="!isMobile"
          class="absolute top-7 left-7 z-10 flex items-center gap-2 rounded-lg border border-border bg-panel px-2 py-1 shadow-sm"
        >
          <img :src="faviconSrc" class="size-4" alt="OpenPencil" />
          <span data-test-id="editor-document-name" class="text-xs text-surface">{{
            store.state.documentName
          }}</span>
          <Tip
            :label="
              dialogs.showUI({ shortcut: formatShortcut(appMenuShortcut('toggle-ui')) ?? '' })
            "
          >
            <button
              data-test-id="editor-show-ui"
              class="ml-1 flex size-6 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-hover hover:text-surface"
              @click="store.state.showUI = true"
            >
              <icon-lucide-sidebar class="size-3.5" />
            </button>
          </Tip>
        </div>
      </div>
    </div>

    <!-- Bare canvas (no chrome, e.g. ?no-chrome) -->
    <div v-else :key="'bare-' + activeTab?.id" class="flex flex-1 overflow-hidden">
      <div class="relative flex min-w-0 flex-1">
        <EditorCanvas />
      </div>
    </div>
  </div>
</template>
