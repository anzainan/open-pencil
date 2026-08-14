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
import { connectAutomation } from '@/app/automation/bridge/server'
import { spawnMCPIfNeeded } from '@/app/automation/mcp/spawn'
import { isTauri } from '@/app/tauri/env'
import { appMenuShortcut } from '@/app/shell/menu/shortcut'
import { createDemoShapes } from '@/app/demo/document'
import { useEditorStore } from '@/app/editor/active-store'
import { openPermissionRequest } from '@/app/editor/readonly'
import { createTab, activeTab, getActiveStore, tabCount } from '@/app/tabs'

import EditorCanvas from '@/components/EditorCanvas.vue'
import PermissionRequestDialog from '@/components/editor/PermissionRequestDialog.vue'
import LayersPanel from '@/components/LayersPanel.vue'
import MobileDrawer from '@/components/MobileDrawer.vue'
import MobileHud from '@/components/MobileHud/MobileHud.vue'
import PropertiesPanel from '@/components/PropertiesPanel.vue'
import RenameSelectionDialog from '@/components/selection/RenameSelectionDialog.vue'
import TabBar from '@/components/TabBar.vue'
import Tip from '@/components/ui/Tip.vue'
import Toolbar from '@/components/Toolbar/Toolbar.vue'
import SharePopover from '@/components/workspace/SharePopover.vue'

import type { Tool } from '@open-pencil/core/editor'

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

// ── 只读模式拦截（Phase B：无编辑权限只读打开）──
// 1) 只读时若切到编辑工具（键盘快捷键等）→ 弹权限申请 + 复位回选择工具；
// 2) 只读时发生图变更（delete/拖拽/粘贴/属性面板等）→ 弹权限申请 + 尝试 undo 回滚
//    （磁盘不受影响：autosave 已强制关闭）。loadings 归零后才武装，避免打开过程误触发。
function isViewTool(tool: Tool): boolean {
  return tool === 'SELECT' || tool === 'HAND'
}

let sceneBaseline: number | null = null
let lastInterceptedVersion = -1

watch(
  [() => store.state.readOnly, () => store.state.loading],
  ([readOnly, loading]) => {
    if (readOnly && !loading) {
      sceneBaseline = store.state.sceneVersion
      lastInterceptedVersion = -1
      if (!isViewTool(store.state.activeTool)) store.setTool('SELECT')
    } else if (!readOnly) {
      sceneBaseline = null
      lastInterceptedVersion = -1
    }
  },
  { immediate: true }
)

watch(
  () => store.state.activeTool,
  (tool) => {
    if (!store.state.readOnly) return
    if (isViewTool(tool)) return
    openPermissionRequest()
    store.setTool('SELECT')
  }
)

watch(
  () => store.state.sceneVersion,
  (version) => {
    if (!store.state.readOnly || sceneBaseline === null) return
    if (version === sceneBaseline || version === lastInterceptedVersion) return
    lastInterceptedVersion = version
    openPermissionRequest()
    // 回滚只读态内存改动（undo 栈在打开时已清空，此处只会回退只读期间自己的改动）。
    if (store.undo.canUndo) store.undo.undo()
    sceneBaseline = store.state.sceneVersion
  }
)

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
    <PermissionRequestDialog />
    <TabBar />

    <!-- 只读提示条（无编辑权限时固定显示） -->
    <div
      v-if="store.state.readOnly"
      data-test-id="readonly-banner"
      class="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-md bg-[#2A2A2A] px-3 py-1.5 text-[11px] font-medium text-white shadow-md ring-1 ring-white/10"
    >
      {{ dialogs['perm.readOnly'] }}
    </div>

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
          <SharePopover v-if="!store.state.readOnly" />
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
        <MobileHud />
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
          <img src="/favicon-32.png" class="size-4" alt="OpenPencil" />
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
