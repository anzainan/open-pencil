import type { Editor, EditorState } from '@open-pencil/core/editor'
import { readFigFile } from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'

import { bridgeClient } from '@/app/bridge/client'
import { getPendingAiOps, journalDocPathForSource, withAiOpsLock } from '@/app/bridge/op-journal'
import { isAutomationRpcActive } from '@/app/automation/bridge/apply'
import { yieldToUI } from '@/app/document/io/browser'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { readReloadSource } from '@/app/document/io/reload-source'
import { captureReloadState, restoreReloadState } from '@/app/document/io/reload-state'
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
  getSavedVersion: () => number
  setSavedVersion: (version: number) => void
}

/** reloadFromDisk 在跳过各守卫后传给 reloadFromDiskLocked 的诊断快照。 */
type ReloadDiagnostics = {
  path: string | null
  /** reloadFromDisk 内 isSelfWriteEcho 的判定结果（true 时早已 return，故此处恒 false）。 */
  selfWriteEcho: boolean
  /** reloadFromDisk 内 journal 是否为空（非空时早已 return）。 */
  journalEmpty: boolean
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
  getSavedVersion,
  setSavedVersion
}: ReloadActionsOptions) {
  async function reloadFromDisk() {
    const storageBinding = getStorageBinding()
    const docPath = await journalDocPathForSource(storageBinding, getFilePath())
    // 重建期间与 AI 操作共用同一文档级 FIFO 锁：AI 操作在途时等待其完成，
    // 重建期间新到的 AI 操作也会排队，杜绝「重建 + 操作」交错导致 id 错乱。
    await withAiOpsLock(docPath, async () => {
      let journalEmpty = true
      // 有未落盘的 AI 操作（journal 非空）时跳过磁盘重载——磁盘是旧状态，
      // 重载会覆盖内存里更新的 AI 结果（SKILL §4.13 的文档重建根因）。
      if (docPath) {
        const pending = await getPendingAiOps(docPath)
        journalEmpty = pending.length === 0
        if (pending.length > 0) return
      }
      // 自写水印（P0-1 方案 c）：磁盘 mtime 与本会话最近一次 PUT 落盘一致 →
      // 该「文件已变更」事件是本会话自己的写回 echo，直接忽略，绝不重建。
      if (docPath && (await bridgeClient.isSelfWriteEcho(docPath))) return
      await reloadFromDiskLocked({
        path: getFilePath(),
        selfWriteEcho: false,
        journalEmpty
      })
    })
  }

  async function reloadFromDiskLocked(diagnostics?: ReloadDiagnostics) {
    // 诊断日志（B1）：区分「自写 echo / 外部写 / 水印失效」三类触发来源，
    // 并暴露 AI 活跃窗口状态与 saved/scene 版本差，便于定位窄竞态屏闪。
    const savedVersion = getSavedVersion()
    const aiActive = isAutomationRpcActive()
    console.warn(
      `[reload] triggered path=${diagnostics?.path ?? 'n/a'} ` +
        `selfWriteEcho=${diagnostics?.selfWriteEcho ?? 'n/a'} ` +
        `journalEmpty=${diagnostics?.journalEmpty ?? 'n/a'} ` +
        `savedVsScene=${savedVersion}:${state.sceneVersion} aiActive=${aiActive}`
    )
    // 内存有未落盘改动（sceneVersion 高于上次已保存版本，或 journal 非空）时
    // 跳过磁盘重载——磁盘是旧状态，重载会用旧内容覆盖新内存导致内容丢失（P0-2）。
    if (savedVersion < state.sceneVersion) return
    // AI 活跃窗口内挂起 reload（B2）：AI 批量操作 + autosave 回写 echo 的窄竞态
    // 会触发少量真实 reload → 画布反复空白恢复。窗口内直接跳过，不重建不广播。
    if (aiActive) {
      console.warn('[reload] skipped: AI active window')
      return
    }

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
