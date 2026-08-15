<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@open-pencil/vue'

import { activeStorageProviderID, BRIDGE_STORAGE_PROVIDER } from '@/app/integrations/storage'
import { openSettingsDialog } from '@/app/settings/dialog'
import { bridgeClient, type BridgeFileEvent, type BridgeTrashEntry } from '@/app/bridge/client'
import { stripFileExtension } from '@/app/bridge/storage-adapter'
import { useWorkspaceFileOps } from '@/app/bridge/workspace-ops'
import { activeTab, createUntitledTab } from '@/app/tabs'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'
import NewProjectPrompt from '@/components/workspace/NewProjectPrompt.vue'
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar.vue'

const { dialogs } = useI18n()
const router = useRouter()
const configured = ref(false)
const trashFiles = ref<BridgeTrashEntry[]>([])
const loading = ref(true)
const errorMessage = ref<string | null>(null)
const newProjectOpen = ref(false)

async function onNewProjectConfirm(name: string): Promise<void> {
  await ops.createProject(name)
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

async function loadTrash(): Promise<void> {
  if (activeStorageProviderID.value !== BRIDGE_STORAGE_PROVIDER.id) return
  loading.value = true
  try {
    trashFiles.value = await bridgeClient.listTrash()
    configured.value = true
    errorMessage.value = null
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

const ops = useWorkspaceFileOps({ refresh: loadTrash })

let sseUnsubscribe: (() => void) | null = null
let sseRefreshTimer: ReturnType<typeof setTimeout> | null = null

function onBridgeFileEvent(event: BridgeFileEvent): void {
  if (activeStorageProviderID.value !== BRIDGE_STORAGE_PROVIDER.id) return
  if (event.type !== 'file.created' && event.type !== 'file.deleted') return
  if (sseRefreshTimer) return
  sseRefreshTimer = setTimeout(() => {
    sseRefreshTimer = null
    void loadTrash()
  }, 200)
}

watch(activeStorageProviderID, () => {
  void loadTrash()
})

onMounted(() => {
  void loadTrash()
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
  <main class="flex min-h-screen flex-col bg-canvas text-surface" data-test-id="trash-workspace">
    <WorkspaceTopBar
      mode="trash"
      :title="dialogs.trash"
      :new-disabled="!configured"
      @new-project="newProjectOpen = true"
      @new-document="createDocument"
    />

    <section class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col p-6">
      <p v-if="errorMessage && configured" class="mb-4 shrink-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>

      <div class="mb-4 flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2">
        <icon-lucide-info class="size-3 text-muted" />
        <span class="text-[11px] text-muted">{{ dialogs.trashNotice }}</span>
      </div>

      <div v-if="trashFiles.length" class="flex flex-col gap-2">
        <div
          v-for="entry in trashFiles"
          :key="entry.path"
          class="flex items-center gap-3 rounded-lg border border-border bg-panel p-3"
          :data-test-id="'trash-item-' + entry.path"
        >
          <div class="flex size-8 shrink-0 items-center justify-center rounded bg-panel-field">
            <icon-lucide-folder v-if="entry.type === 'dir'" class="size-4 text-muted/60" />
            <icon-lucide-file-image v-else class="size-4 text-muted/60" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium">{{ stripFileExtension(entry.name) }}</p>
            <p class="mt-0.5 truncate text-[10px] text-muted">
              {{ stripFileExtension(entry.path) }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface"
              data-test-id="trash-restore"
              @click="ops.restoreEntry(entry.path)"
            >
              {{ dialogs.restore }}
            </button>
            <button
              type="button"
              class="rounded border border-danger/30 px-2 py-1 text-[10px] text-danger hover:bg-danger/10"
              data-test-id="trash-delete"
              @click="ops.deleteEntry(entry.path)"
            >
              {{ dialogs.deleteForever }}
            </button>
          </div>
        </div>
      </div>

      <AppPlaceholder v-else-if="loading" :label="dialogs.loadingDocuments" size="page">
        <template #icon>
          <icon-lucide-loader-circle class="size-5 animate-spin" />
        </template>
      </AppPlaceholder>

      <AppPlaceholder v-else-if="configured" :label="dialogs.emptyTrash" size="page">
        <template #icon>
          <icon-lucide-trash-2 class="size-5" />
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
