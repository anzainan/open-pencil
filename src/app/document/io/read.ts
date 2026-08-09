import type { Editor, EditorState } from '@open-pencil/core/editor'
import { readFigFile } from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'

import { yieldToUI } from '@/app/document/io/browser'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { readReloadSource } from '@/app/document/io/reload-source'
import { captureReloadState, restoreReloadState } from '@/app/document/io/reload-state'
import { getPendingAiOps, journalDocPathForBinding, withAiOpsLock } from '@/app/bridge/op-journal'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { toast } from '@/app/shell/ui'

type OpenDocumentState = EditorState & {
  documentName: string
  loading: boolean
}

type ReloadDocumentState = EditorState & { documentName: string }

type OpenFigFileOptions = {
  editor: Editor
  state: OpenDocumentState
  setDocumentSource: (
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) => void
  fitCurrentPageToViewport: () => Promise<void>
}

type ReloadActionsOptions = {
  editor: Editor
  state: ReloadDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  getStorageBinding: () => StorageDocumentBinding | null
  setSavedVersion: (version: number) => void
}

export function createOpenActions({
  editor,
  state,
  setDocumentSource,
  fitCurrentPageToViewport
}: OpenFigFileOptions) {
  async function openFigFile(file: File, handle?: FileSystemFileHandle, path?: string) {
    try {
      state.loading = true
      await yieldToUI()
      const imported = await readFigFile(file, { populate: 'first-page' })
      await yieldToUI()
      await applyImportedDocument(editor, imported)
      state.documentName = file.name.replace(/\.fig$/i, '')
      setDocumentSource(file.name, 'fig', handle, path)
      await fitCurrentPageToViewport()
      editor.requestRender()
    } catch (e) {
      console.error('Failed to open .fig file:', e)
      toast.error(`Failed to open file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      state.loading = false
    }
  }

  return { openFigFile }
}

export function createReloadActions({
  editor,
  state,
  getFilePath,
  getFileHandle,
  getStorageBinding,
  setSavedVersion
}: ReloadActionsOptions) {
  async function reloadFromDisk() {
    const storageBinding = getStorageBinding()
    const docPath = journalDocPathForBinding(storageBinding)
    // 重建期间与 AI 操作共用同一文档级 FIFO 锁：AI 操作在途时等待其完成，
    // 重建期间新到的 AI 操作也会排队，杜绝「重建 + 操作」交错导致 id 错乱。
    await withAiOpsLock(docPath, async () => {
      // 有未落盘的 AI 操作（journal 非空）时跳过磁盘重载——磁盘是旧状态，
      // 重载会覆盖内存里更新的 AI 结果（SKILL §4.13 的文档重建根因）。
      if (docPath) {
        const pending = await getPendingAiOps(docPath)
        if (pending.length > 0) return
      }
      await reloadFromDiskLocked()
    })
  }

  async function reloadFromDiskLocked() {
    const snapshot = captureReloadState(state)
    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    const storageBinding = getStorageBinding()

    const imported = await readReloadSource({
      documentName: state.documentName,
      filePath,
      fileHandle,
      storageBinding
    })
    if (!imported) return
    const pageId = imported.getNode(snapshot.pageId) ? snapshot.pageId : imported.getPages()[0]?.id
    if (pageId) computeAllLayouts(imported, pageId)
    editor.replaceGraph(imported)

    editor.undo.clear()
    restoreReloadState(editor, state, snapshot)
    editor.requestRender()
    setSavedVersion(state.sceneVersion)
    toast.info('文档已从磁盘重新加载，节点 id 可能已更新')
  }

  return { reloadFromDisk }
}
