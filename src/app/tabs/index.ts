import { shallowRef, computed, triggerRef } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { readFigFile } from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { clearRememberedWorkspaceFile, rememberWorkspaceFile } from '@/app/bridge/restore'
import { setOpenPencilStore } from '@/app/browser-bridge'
import { replayPendingAIOps } from '@/app/automation/bridge/replay'
import type { DocumentSourceIdentity } from '@/app/document/io/types'
import { setActiveEditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import {
  activeStorageProviderID,
  createActiveStorageAdapter,
  type StorageAdapter,
  type StorageDocument
} from '@/app/integrations/storage'
import { toast } from '@/app/shell/ui'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { seedStorageCanvasFromRemote } from '@/app/storage/sync/persist'
import { createFileOpenCoordinator } from '@/app/tabs/open/coordinator'
import { findTabByFileIdentity } from '@/app/tabs/open/identity'

export interface Tab {
  id: string
  store: EditorStore
}

const io = new IORegistry(BUILTIN_IO_FORMATS)
const fileOpenCoordinator = createFileOpenCoordinator()

let nextTabId = 1

function generateTabId(): string {
  return `tab-${nextTabId++}`
}

const tabsRef = shallowRef<Tab[]>([])
const activeTabId = shallowRef('')

export const activeTab = computed(() => tabsRef.value.find((t) => t.id === activeTabId.value))

export const allTabs = computed(() =>
  tabsRef.value.map((t) => ({
    id: t.id,
    name: t.store.state.documentName,
    isActive: t.id === activeTabId.value
  }))
)

export function getActiveStore(): EditorStore {
  const tab = tabsRef.value.find((t) => t.id === activeTabId.value)
  if (!tab) throw new Error('No active tab')
  return tab.store
}

export function getActiveTabId(): string {
  return activeTabId.value
}

export function getTabById(tabId: string): Tab | undefined {
  return tabsRef.value.find((tab) => tab.id === tabId)
}

export function getTabForStore(store: EditorStore): Tab | undefined {
  return tabsRef.value.find((tab) => tab.store === store)
}

export function getTabsSnapshot(): Tab[] {
  return [...tabsRef.value]
}

export function createTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const s = store ?? createEditorStore(initialGraph)
  const tab: Tab = { id: generateTabId(), store: s }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

/** 用户主动新建空白画布：清除「刷新恢复」记忆的 URL 文件参数。 */
export function createUntitledTab(): Tab {
  clearRememberedWorkspaceFile()
  return createTab()
}

function activateTab(tab: Tab) {
  activeTabId.value = tab.id
  setActiveEditorStore(tab.store)
  triggerRef(tabsRef)
  setOpenPencilStore(tab.store)
  const binding = tab.store.getStorageBinding()
  if (binding?.providerId === BRIDGE_PROVIDER_ID && binding.documentId) {
    void bridgeClient.reportActive(binding.documentId)
  }
}

export function switchTab(tabId: string) {
  const tab = tabsRef.value.find((t) => t.id === tabId)
  if (!tab) return
  activateTab(tab)
}

export function closeTab(tabId: string) {
  const idx = tabsRef.value.findIndex((t) => t.id === tabId)
  if (idx === -1) return

  const closingTab = tabsRef.value[idx]
  const wasActive = activeTabId.value === tabId
  tabsRef.value = tabsRef.value.filter((t) => t.id !== tabId)

  if (tabsRef.value.length === 0) {
    createTab()
    closingTab.store.dispose()
    return
  }

  if (wasActive) {
    const newIdx = Math.min(idx, tabsRef.value.length - 1)
    activateTab(tabsRef.value[newIdx])
  }

  closingTab.store.dispose()
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function isDOMImportFile(file: File): boolean {
  return /\.(html?|xhtml)$/i.test(file.name)
}

function reusableTabStore(): EditorStore {
  const current = activeTab.value
  const isUntouched =
    current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
  return isUntouched ? current.store : createTab().store
}

function findStorageTab(providerId: string, documentId: string): Tab | undefined {
  return tabsRef.value.find((tab) => {
    const binding = tab.store.getStorageBinding()
    return binding?.providerId === providerId && binding.documentId === documentId
  })
}

/**
 * 打开前校验远端文件是否仍存在（NAS/工作区是真相源）。bridge provider 用
 * getFileMeta；S3 等 adapter 提供 getDocumentMetadata 时做等价存在性校验。
 * 返回 true 表示远端已删（或校验失败），该文档只能作 stale 快照打开。
 */
async function isStorageDocumentStale(
  providerId: string,
  adapter: StorageAdapter,
  documentId: string
): Promise<boolean> {
  if (providerId === BRIDGE_PROVIDER_ID) {
    const meta = await bridgeClient.getFileMeta(documentId).catch(() => null)
    return meta === null
  }
  if (typeof adapter.getDocumentMetadata === 'function') {
    const meta = await adapter.getDocumentMetadata(documentId).catch(() => null)
    return meta === null
  }
  return false
}

export async function openStorageDocumentInNewTab(document: StorageDocument): Promise<void> {
  const providerId = activeStorageProviderID.value
  const existing = findStorageTab(providerId, document.id)
  if (existing) {
    switchTab(existing.id)
    return
  }

  const store = reusableTabStore()
  store.state.loading = true
  try {
    const resolved = await resolveStorageDocumentBytes(
      providerId,
      createActiveStorageAdapter(providerId),
      document
    )
    if (!resolved) {
      toast.error(`文件已被删除且本地无缓存：${document.name}`)
      return
    }
    const { bytes, stale } = resolved

    store.state.documentName = document.name
    const fileBytes = new Uint8Array(bytes.byteLength)
    fileBytes.set(bytes)
    const file = new File([fileBytes.buffer], `${document.name}.fig`, {
      type: 'application/octet-stream'
    })
    const imported = await readFigFile(file, { populate: 'first-page' })
    const firstPageId = imported.getPages()[0]?.id
    if (firstPageId) computeAllLayouts(imported, firstPageId)
    store.replaceGraph(imported)
    store.undo.clear()
    store.setStorageDocumentSource(
      { providerId, documentId: document.id },
      document.name,
      stale ? { stale: true } : undefined
    )
    store.clearSelection()
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
    await store.switchPage(pageId)
    if (stale) {
      toast.warning('该文件已在工作区被删除，已作为副本打开（不会自动保存回云端，可另存为或下载）')
    } else if (providerId === BRIDGE_PROVIDER_ID) {
      await restoreBridgeWorkspaceSession(store, document.id)
    }
    await store.fitCurrentPageToViewport()
  } finally {
    store.state.loading = false
  }
}

type ResolvedStorageOpen = {
  bytes: Uint8Array
  stale: boolean
}

/** 解析待打开文档的字节：先校验远端存在性，再按 stale/活文件两条路径取字节。 */
async function resolveStorageDocumentBytes(
  providerId: string,
  adapter: StorageAdapter,
  document: StorageDocument
): Promise<ResolvedStorageOpen | null> {
  const local = getLocalCanvasStore()
  const localMetadata = await local.getMeta(document.id)
  const localBytes = localMetadata?.hasFig ? await local.readFig(document.id) : null

  // 远端已删（NAS 侧删除）→ 不得当活文件打开，也不得让 autosave 写回复活。
  const stale = await isStorageDocumentStale(providerId, adapter, document.id)
  if (stale) {
    if (!localBytes) return null
    // stale 打开：只读本地缓存快照，不设 binding、不启 autosave，绝不写回远端。
    return { bytes: localBytes, stale }
  }

  const localIsAuthoritative =
    localMetadata?.syncStatus !== 'synced' ||
    !document.metadataAuthoritative ||
    localMetadata.updatedAt >= document.updatedAt
  let bytes = localBytes && localIsAuthoritative ? localBytes : null
  if (!bytes) {
    bytes = await adapter.getDocument(document.id)
    await seedStorageCanvasFromRemote({
      providerId,
      canvasId: document.id,
      name: document.name,
      updatedAt: document.updatedAt,
      figBytes: bytes
    })
  }
  return { bytes, stale }
}

/** bridge 工作区刷新恢复：记 URL + 重放上次未落盘的 AI 操作。 */
async function restoreBridgeWorkspaceSession(store: EditorStore, documentId: string): Promise<void> {
  // 刷新恢复：把工作区文件记进 URL，重开后自动重新打开。
  rememberWorkspaceFile(documentId)
  // 防丢失重放：上次关闭/刷新时尚未落盘的 AI 操作，从本地日志重放到内存图。
  const tab = getTabForStore(store)
  if (!tab) return
  const replayed = await replayPendingAIOps(store, tab.id, documentId)
  if (replayed > 0) {
    store.requestRender()
    toast.info(`已从本地暂存恢复 ${replayed} 条 AI 操作`)
  }
}

export async function openFileInNewTab(
  file: File,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<void> {
  const identity: DocumentSourceIdentity = {
    handle: handle ?? null,
    path: path ?? null
  }
  const decision = await fileOpenCoordinator.decide(async () => {
    const pending = await fileOpenCoordinator.findPending(identity)
    if (pending) {
      const tab = getTabForStore(pending.store)
      if (tab) switchTab(tab.id)
      return { kind: 'pending' as const, completion: pending.completion }
    }

    const existing = await findTabByFileIdentity(tabsRef.value, identity)
    if (existing) {
      switchTab(existing.id)
      return { kind: 'existing' as const }
    }

    const store = reusableTabStore()
    store.state.documentName = file.name.replace(/\.[^.]+$/i, '')
    store.state.loading = true

    const completion = Promise.withResolvers<undefined>()
    void completion.promise.catch(() => undefined)
    const pendingOpen = { completion: completion.promise, identity, store }
    fileOpenCoordinator.add(pendingOpen)
    return { kind: 'owner' as const, completion, pendingOpen, store }
  })

  if (decision.kind === 'existing') return
  if (decision.kind === 'pending') {
    await decision.completion
    return
  }

  const { completion, pendingOpen, store } = decision
  try {
    if (isDOMImportFile(file)) {
      await store.openDOMFile(file, { handle, path })
      completion.resolve(undefined)
      return
    }

    await yieldToUI()
    const isFig = file.name.toLowerCase().endsWith('.fig')
    const { graph: imported, sourceFormat } = isFig
      ? { graph: await readFigFile(file, { populate: 'first-page' }), sourceFormat: 'fig' }
      : await io.readDocument({
          name: file.name,
          mimeType: file.type || undefined,
          data: new Uint8Array(await file.arrayBuffer())
        })

    const firstPageId = imported.getPages()[0]?.id
    if (firstPageId) computeAllLayouts(imported, firstPageId)
    store.replaceGraph(imported)
    store.undo.clear()
    store.setDocumentSource(file.name, sourceFormat, handle, path)
    store.clearSelection()
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
    await store.switchPage(pageId)
    await store.fitCurrentPageToViewport()
    completion.resolve(undefined)
  } catch (error) {
    completion.reject(error)
    throw error
  } finally {
    store.state.loading = false
    fileOpenCoordinator.remove(pendingOpen)
  }
}

export function tabCount(): number {
  return tabsRef.value.length
}

export function useTabsStore() {
  return {
    tabs: allTabs,
    activeTabId,
    createTab,
    createUntitledTab,
    switchTab,
    closeTab,
    getActiveTabId,
    getTabById,
    getTabForStore,
    getTabsSnapshot,
    openFileInNewTab,
    openStorageDocumentInNewTab,
    getActiveStore,
    tabCount
  }
}
