import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { journalDocPathForSource, withAiOpsLock } from '@/app/bridge/op-journal'
import { createAutosave } from '@/app/document/autosave'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

type DocumentSourceOptions = DocumentSourceAccess & {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getRenderer: () => Editor['renderer']
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer
}: DocumentSourceOptions) {
  function buildFigFile() {
    return exportFigFile(editor.graph, undefined, getRenderer() ?? undefined, state.currentPageId)
  }

  const { saveFigFile, saveFigFileAs, writeFile } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    getStorageBinding,
    setStorageBinding,
    setSourceIdentity,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    }
  })

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    saveCurrentDocument: async () => {
      // 序列化 + PUT + 清空 journal 全程持有该文档的互斥锁（withAiOpsLock），
      // 与「应用 AI 操作 + 追加 journal」互斥，杜绝「清空晚于覆盖它的追加」竞态。
      const docPath = await journalDocPathForSource(getStorageBinding(), getFilePath())
      await withAiOpsLock(docPath, async () => {
        await writeFile(await buildFigFile())
      })
    }
  })

  function setDocumentSource(
    _fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    setStorageBinding(null)
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    // 打开动作不设 downloadName：仅「另存/下载」时才把保存目标钉到下载路径，
    // 避免浏览器手动打开（无 handle/path）后 saveFigFile 被 downloadName 遮蔽成下载。
    setSourceIdentity({ handle: handle ?? null, path: path ?? null })
    setSavedVersion(state.sceneVersion)
    // 已建立文档源（fig 且有 handle/path 时为可写源；无可写源时 flushIfDirty 的
    // hasWritableSource 闸会拦下保存，开关开着无害），与 setStorageDocumentSource 对齐。
    state.autosaveEnabled = true
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setStorageDocumentSource(
    binding: StorageDocumentBinding,
    documentName: string,
    opts?: { stale?: boolean }
  ) {
    const stale = opts?.stale === true
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(null)
    setSourceIdentity({ handle: null, path: null })
    // stale 打开（远端已删）：只读缓存快照，不建立 storage binding，
    // 否则任何写路径（autosave/手动保存）都可能 PUT 写回把已删文件复活。
    if (!stale) setStorageBinding(binding)
    state.documentName = documentName
    // stale 时保持 autosave 关闭（不置 true），杜绝自动写回。
    state.autosaveEnabled = !stale
    setSavedVersion(state.sceneVersion)
    if (stale) return
    if (binding.providerId === BRIDGE_PROVIDER_ID && binding.documentId) {
      void bridgeClient.reportRecent(binding.documentId)
      void bridgeClient.reportActive(binding.documentId)
      void startWatchingFile()
    }
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(path)
    state.documentName = documentNameFromFigPath(path)
    // 计划落盘目标已建立（MCP new_document/save_file 路径）→ 打开 autosave，
    // 否则连续 AI 操作期间 3s debounce 与 60s 看门狗都会被 autosaveEnabled 闸死。
    state.autosaveEnabled = true
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    stopWatchingFile()
    disposeAutosave()
  }

  return {
    setDocumentSource,
    setStorageDocumentSource,
    setPlannedFilePath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile,
    saveFigFileAs,
    getStorageBinding
  }
}
