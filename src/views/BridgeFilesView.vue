<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { BRIDGE_PROVIDER_ID, bridgeClient, type BridgeFileEvent } from '@/app/bridge/client'
import { resolveUniqueWorkspacePath } from '@/app/bridge/workspace-name'
import { activeStorageProviderID, type StorageDocument } from '@/app/integrations/storage'
import { activeTab, createTab, openStorageDocumentInNewTab } from '@/app/tabs'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'

interface RecentRecord {
  path: string
  openedAt: string
  exists: boolean
  ext: string | null
  updatedAt: string | null
}

const router = useRouter()
const recents = ref<RecentRecord[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const showCreate = ref(false)
const createPath = ref('')
const createBusy = ref(false)

function fileNameOf(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] ?? path
}

function displayNameOf(path: string): string {
  return fileNameOf(path).replace(/\.(fig|pen)$/i, '')
}

const sortedRecents = computed(() =>
  recents.value.slice().sort((a, b) => b.openedAt.localeCompare(a.openedAt))
)

async function loadRecents(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const entries = await bridgeClient.getRecent()
    const batches: { path: string; openedAt: string }[][] = []
    for (let offset = 0; offset < entries.length; offset += 8) {
      batches.push(entries.slice(offset, offset + 8))
    }
    const checked: RecentRecord[][] = []
    for (const batch of batches) {
      checked.push(
        await Promise.all(
          batch.map(async (entry) => {
            const meta = await bridgeClient.getFileMeta(entry.path).catch(() => null)
            return {
              path: entry.path,
              openedAt: entry.openedAt,
              exists: meta !== null,
              ext: meta?.ext ?? null,
              updatedAt: meta?.updatedAt ?? null
            }
          })
        )
      )
    }
    recents.value = checked.flat()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

function toStorageDocument(record: RecentRecord): StorageDocument {
  return {
    id: record.path,
    name: displayNameOf(record.path),
    updatedAt: record.updatedAt ?? record.openedAt,
    metadataAuthoritative: true
  }
}

function canOpen(record: RecentRecord): boolean {
  return record.exists && (record.ext === 'fig' || record.ext === null)
}

async function openRecord(record: RecentRecord): Promise<void> {
  if (!canOpen(record)) return
  activeStorageProviderID.value = BRIDGE_PROVIDER_ID
  await router.push('/')
  await nextTick()
  await openStorageDocumentInNewTab(toStorageDocument(record))
}

function normalizeNewPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\/+/, '')
  if (!trimmed || trimmed.includes('..') || trimmed.startsWith('\\')) return null
  return /\.(fig|pen)$/i.test(trimmed) ? trimmed : `${trimmed}.fig`
}

async function createDocument(): Promise<void> {
  const path = normalizeNewPath(createPath.value)
  if (!path || createBusy.value) return
  createBusy.value = true
  error.value = null
  try {
    const finalPath = await resolveUniqueWorkspacePath(path)
    activeStorageProviderID.value = BRIDGE_PROVIDER_ID
    await router.push('/')
    await nextTick()
    const current = activeTab.value
    const store =
      current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
        ? current.store
        : createTab().store
    store.setStorageDocumentSource(
      { providerId: BRIDGE_PROVIDER_ID, documentId: finalPath },
      displayNameOf(finalPath)
    )
    await store.saveFigFile()
    showCreate.value = false
    createPath.value = ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    createBusy.value = false
  }
}

function formatOpened(openedAt: string): string {
  return new Date(openedAt).toLocaleString()
}

let unsubscribe: (() => void) | null = null

function handleBridgeEvent(event: BridgeFileEvent): void {
  if (
    event.type === 'file.created' ||
    event.type === 'file.deleted' ||
    event.type === 'active.changed'
  ) {
    void loadRecents()
  }
}

onMounted(() => {
  activeStorageProviderID.value = BRIDGE_PROVIDER_ID
  unsubscribe = bridgeClient.subscribe(handleBridgeEvent)
  void loadRecents()
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<template>
  <main class="flex min-h-screen flex-col bg-app text-surface" data-test-id="bridge-workspace">
    <header class="flex h-14 items-center border-b border-border px-6">
      <div>
        <h1 class="text-sm font-semibold">最近打开</h1>
        <p class="text-[10px] text-muted">file-bridge · 打开过的设计文件（历史记录，不扫描目录）</p>
      </div>
      <div class="ml-auto flex gap-2">
        <button
          type="button"
          class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
          @click="loadRecents"
        >
          刷新
        </button>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
          data-test-id="bridge-new-document"
          @click="showCreate = !showCreate"
        >
          {{ showCreate ? '取消' : '新建画布' }}
        </button>
      </div>
    </header>

    <section class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col p-6">
      <p v-if="error" class="mb-4 text-xs text-danger" role="alert">
        {{ error }}
      </p>

      <div
        v-if="showCreate"
        class="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-panel p-4 sm:flex-row sm:items-end"
      >
        <label class="flex flex-1 flex-col gap-1 text-[10px] text-muted">
          项目文件夹/文件名（自动补 .fig）
          <input
            v-model="createPath"
            class="h-6 min-w-0 rounded border border-transparent bg-panel-field px-2 text-[11px] text-surface outline-none hover:bg-panel-field-hover focus:border-panel-focus focus:bg-panel-field-hover"
            placeholder="如 扫地机器人/首页"
            data-test-id="bridge-create-path"
            @keydown.enter="createDocument"
          />
        </label>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="createBusy || !createPath.trim()"
          data-test-id="bridge-create-submit"
          @click="createDocument"
        >
          创建并打开
        </button>
      </div>

      <section v-if="sortedRecents.length">
        <h2 class="mb-3 text-xs font-semibold text-muted">最近打开</h2>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          <button
            v-for="record in sortedRecents"
            :key="record.path"
            type="button"
            :disabled="!canOpen(record)"
            class="group overflow-hidden rounded-lg border border-border bg-panel text-left hover:border-panel-focus hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
            :data-document-id="record.path"
            @click="openRecord(record)"
          >
            <div class="aspect-[4/3] bg-panel-field" />
            <div class="border-t border-border p-3">
              <p class="truncate text-xs font-medium">{{ displayNameOf(record.path) }}</p>
              <p class="mt-1 truncate text-[10px] text-muted">{{ record.path }}</p>
              <p class="mt-1 text-[10px] text-muted">
                <span
                  v-if="record.exists && record.ext !== 'fig'"
                  class="mr-1 text-amber-400"
                  >(只读 .pen)</span
                >
                <span v-if="!record.exists" class="mr-1 text-danger">文件不存在</span>
                {{ formatOpened(record.openedAt) }}
              </p>
            </div>
          </button>
        </div>
      </section>

      <AppPlaceholder v-if="loading && !recents.length" label="正在加载历史记录…" size="page">
        <template #icon>
          <icon-lucide-loader-circle class="size-5 animate-spin" />
        </template>
      </AppPlaceholder>

      <AppPlaceholder
        v-else-if="!loading && !recents.length && !error"
        label="还没有打开过的文件"
        description="打开过、或新建保存过的设计文件会出现在这里（类似 PS 的「最近打开」）。"
        size="page"
      >
        <template #icon>
          <icon-lucide-history class="size-5" />
        </template>
        <template #action>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            @click="showCreate = true"
          >
            新建画布
          </button>
        </template>
      </AppPlaceholder>
    </section>
  </main>
</template>
