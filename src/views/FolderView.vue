<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDocumentWorkspace, useI18n } from '@open-pencil/vue'

import {
  activeStorageProviderID,
  BRIDGE_STORAGE_PROVIDER,
  storageProviderRegistry,
  type StorageDocument
} from '@/app/integrations/storage'
import { openSettingsDialog, settingsDialogOpen } from '@/app/settings/dialog'
import { loadWorkspaceFonts } from '@/app/editor/fonts'
import { bridgeClient, type BridgeFileEvent } from '@/app/bridge/client'
import { useWorkspaceGrid } from '@/app/bridge/use-workspace-grid'
import { createStorageWorkspaceSource } from '@/app/storage/workspace/source'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'
import Tip from '@/components/ui/Tip.vue'
import ContextMenuOverlay from '@/components/workspace/ContextMenuOverlay.vue'
import MovePrompt from '@/components/workspace/MovePrompt.vue'
import NewProjectPrompt from '@/components/workspace/NewProjectPrompt.vue'
import NotifyBell from '@/components/workspace/NotifyBell.vue'
import RenamePrompt from '@/components/workspace/RenamePrompt.vue'
import { activeTab, createUntitledTab, openStorageDocumentInNewTab } from '@/app/tabs'

const { dialogs } = useI18n()
const router = useRouter()
const route = useRoute()
const folderName = computed(() => String(route.params.name ?? ''))
const provider = computed(() => storageProviderRegistry.get(activeStorageProviderID.value))
const workspaceLabel = computed(() =>
  provider.value.id === BRIDGE_STORAGE_PROVIDER.id ? '本地工作区 · file-bridge' : provider.value.label
)
const configured = ref(false)
const workspace = useDocumentWorkspace({
  source: createStorageWorkspaceSource((snapshot) => {
    configured.value = snapshot.configured
  }),
  refreshInterval: 60_000,
  previewConcurrency: 6
})
const documents = workspace.documents
const loading = workspace.loading
const errorMessage = computed(() => {
  const reason = workspace.error.value
  if (reason == null) return null
  return reason instanceof Error ? reason.message : String(reason)
})
const refresh = workspace.refresh
const invalidate = workspace.invalidate
const clearPreviews = workspace.clearPreviews
const previewURL = workspace.previewURL
const vWorkspacePreview = workspace.previewDirective

const grid = useWorkspaceGrid({ documents, refresh, currentFolder: folderName })
const {
  folderFiles,
  folders,
  loadDirs,
  ctxMenu,
  renameState,
  moveState,
  newProjectOpen,
  onCardContextMenu,
  closeMenu,
  onRename,
  onMove,
  onTrash,
  onRenameConfirm,
  onMoveConfirm,
  onNewProjectConfirm
} = grid

watch(folderName, () => {
  void refresh()
  void loadDirs()
})

async function openDocument(document: StorageDocument): Promise<void> {
  await router.push('/editor')
  await nextTick()
  await openStorageDocumentInNewTab(document)
}

async function createDocument(): Promise<void> {
  if (!configured.value) return
  await router.push('/editor')
  await nextTick()
  const current = activeTab.value
  const isUntouched =
    current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
  if (!isUntouched) createUntitledTab()
}

watch(activeStorageProviderID, () => {
  clearPreviews()
  void invalidate()
  void loadDirs()
})

let sseUnsubscribe: (() => void) | null = null
let sseRefreshTimer: ReturnType<typeof setTimeout> | null = null

function onBridgeFileEvent(event: BridgeFileEvent): void {
  if (activeStorageProviderID.value !== BRIDGE_STORAGE_PROVIDER.id) return
  if (event.type !== 'file.created' && event.type !== 'file.deleted') return
  if (sseRefreshTimer) return
  sseRefreshTimer = setTimeout(() => {
    sseRefreshTimer = null
    void refresh()
    void loadDirs()
  }, 200)
}

watch(settingsDialogOpen, (open, wasOpen) => {
  if (wasOpen && !open) void invalidate()
})

onMounted(() => {
  void loadWorkspaceFonts()
  void loadDirs()
  sseUnsubscribe = bridgeClient.subscribe(onBridgeFileEvent)
})

onUnmounted(() => {
  sseUnsubscribe?.()
  sseUnsubscribe = null
  if (sseRefreshTimer) {
    clearTimeout(sseRefreshTimer)
    sseRefreshTimer = null
  }
})
</script>

<template>
  <main class="flex min-h-screen flex-col bg-canvas text-surface" data-test-id="folder-workspace">
    <header class="flex h-14 shrink-0 items-center border-b border-border px-6">
      <Tip :label="dialogs.back">
        <button
          type="button"
          data-test-id="folder-back"
          :aria-label="dialogs.back"
          class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
          @click="router.push('/')"
        >
          <icon-lucide-arrow-left class="size-3.5" />
        </button>
      </Tip>
      <div class="ml-3 flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="cursor-pointer truncate text-xs text-muted hover:text-surface"
          @click="router.push('/')"
        >
          {{ dialogs.teamSpace }}
        </button>
        <icon-lucide-chevron-right class="size-3 shrink-0 text-muted" />
        <span class="truncate text-xs font-medium text-surface">{{ folderName }}</span>
      </div>

      <div class="mx-auto flex items-center gap-2">
        <button
          type="button"
          data-test-id="folder-new-project"
          class="rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
          @click="newProjectOpen = true"
        >
          {{ dialogs.newProject }}
        </button>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!configured"
          data-test-id="folder-new-document"
          @click="createDocument"
        >
          {{ dialogs.new }}
        </button>
      </div>

      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="rounded px-2 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
          @click="openSettingsDialog('storage')"
        >
          {{ dialogs.settings }}
        </button>
        <NotifyBell />
        <Tip :label="dialogs.trash">
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            :aria-label="dialogs.trash"
            @click="router.push('/trash')"
          >
            <icon-lucide-trash-2 class="size-3.5" />
          </button>
        </Tip>
      </div>
    </header>

    <section class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col p-6">
      <p v-if="errorMessage && configured" class="mb-4 shrink-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>

      <div v-if="folderFiles.length">
        <h2 class="mb-3 text-xs text-muted">{{ dialogs.folderFiles }}</h2>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
          <button
            v-for="document in folderFiles"
            :key="document.id"
            type="button"
            class="group overflow-hidden rounded-lg border border-border bg-panel text-left hover:border-panel-focus hover:bg-hover"
            :data-document-id="document.id"
            @click="openDocument(document)"
            @contextmenu.prevent="
              onCardContextMenu($event, {
                kind: 'file',
                path: document.id,
                name: document.name
              })
            "
          >
            <div
              v-workspace-preview="document.id"
              class="flex aspect-[4/3] items-center justify-center bg-panel-field"
            >
              <img
                v-if="previewURL(document.id)"
                :src="previewURL(document.id) ?? undefined"
                alt=""
                class="size-full object-cover"
              />
              <icon-lucide-file-image v-else class="size-6 text-muted/50" />
            </div>
            <div class="border-t border-border p-3">
              <p class="truncate text-xs font-medium">{{ document.name }}</p>
              <p class="mt-1 text-[10px] text-muted">
                {{ new Date(document.updatedAt).toLocaleString() }}
              </p>
            </div>
          </button>
        </div>
      </div>

      <AppPlaceholder v-else-if="loading" :label="dialogs.loadingDocuments" size="page">
        <template #icon>
          <icon-lucide-loader-circle class="size-5 animate-spin" />
        </template>
      </AppPlaceholder>

      <AppPlaceholder v-else-if="configured" :label="dialogs.folderEmpty" size="page">
        <template #icon>
          <icon-lucide-folder-open class="size-5" />
        </template>
      </AppPlaceholder>

      <AppPlaceholder v-else :label="dialogs.storageNotConfigured" size="page">
        <template #icon>
          <icon-lucide-cloud class="size-5" />
        </template>
        <template #action>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            @click="openSettingsDialog('storage')"
          >
            {{ dialogs.settings }}
          </button>
        </template>
      </AppPlaceholder>
    </section>

    <ContextMenuOverlay
      :position="ctxMenu?.position ?? null"
      :rename-label="dialogs.rename"
      :move-label="dialogs.move"
      :trash-label="dialogs.moveToTrash"
      @rename="onRename"
      @move="onMove"
      @trash="onTrash"
      @close="closeMenu"
    />

    <RenamePrompt
      :open="renameState.open"
      :current-name="renameState.target?.name ?? ''"
      :title="dialogs.rename"
      :placeholder="dialogs.renamePlaceholder"
      :confirm-label="dialogs.rename"
      :cancel-label="dialogs.cancel"
      @update:open="renameState.open = $event"
      @confirm="onRenameConfirm"
    />

    <MovePrompt
      :open="moveState.open"
      :current-path="moveState.target?.path ?? ''"
      :dirs="folders"
      :title="dialogs.moveTitle"
      :root-label="dialogs.root"
      :new-folder-label="dialogs.newFolder"
      :new-folder-placeholder="dialogs.newFolderPlaceholder"
      :move-label="dialogs.confirmMove"
      :cancel-label="dialogs.cancel"
      @update:open="moveState.open = $event"
      @confirm="onMoveConfirm"
    />

    <NewProjectPrompt
      :open="newProjectOpen"
      :title="dialogs.newProject"
      :description="dialogs.newProjectDescription"
      :placeholder="dialogs.projectNamePlaceholder"
      :confirm-label="dialogs.create"
      :cancel-label="dialogs.cancel"
      @update:open="newProjectOpen = $event"
      @confirm="onNewProjectConfirm"
    />
  </main>
</template>
