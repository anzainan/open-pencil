import type { EditorState } from '@open-pencil/core/editor'
import { dialogMessages } from '@open-pencil/vue'

import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { journalDocPathForFilePath, journalDocPathForSource, withAIOpsLock } from '@/app/bridge/op-journal'
import { rememberWorkspaceFile } from '@/app/bridge/restore'
import { resolveUniqueWorkspacePath, sanitizeWorkspaceFileName } from '@/app/bridge/workspace-name'
import { downloadBlob } from '@/app/document/io/browser'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentWriter } from '@/app/document/io/write'
import { toast } from '@/app/shell/ui'
import { IS_TAURI } from '@/constants'

type SaveDocumentState = EditorState & {
  documentName: string
  autosaveEnabled?: boolean
}

function saveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type SaveActionsOptions = Omit<DocumentSourceAccess, 'getSavedVersion'> & {
  state: SaveDocumentState
  buildFigFile: () => Uint8Array | Promise<Uint8Array>
  startWatchingFile: () => void
}

export function createSaveActions({
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
  startWatchingFile
}: SaveActionsOptions) {
  const writeFile = createDocumentWriter({
    state,
    getFilePath,
    getFileHandle,
    getStorageBinding,
    setSavedVersion,
    setLastWriteTime
  })

  async function saveFigFile() {
    try {
      const filePath = getFilePath()
      const fileHandle = getFileHandle()
      const storageBinding = getStorageBinding()
      if (storageBinding || filePath || fileHandle) {
        // 一旦确认有可写源（storageBinding || filePath || fileHandle）就打开 autosave，
        // 覆盖 MCP new_document/save_file、UI 新建、Tauri 打开等全部写路径。
        state.autosaveEnabled = true
        const docPath = await journalDocPathForSource(storageBinding, filePath)
        const wrote = await withAIOpsLock(docPath, async () => writeFile(await buildFigFile()))
        if (wrote && !storageBinding) setSourceIdentity({ handle: fileHandle, path: filePath })
        if (wrote) toast.info('文件已保存到云端')
      } else {
        // 无可写源（浏览器手动打开、无 handle/path/binding）：优先写工作区。
        // downloadName 只应在用户显式「另存/下载」时作为目标，不在此作为保存路径，
        // 避免「打开一个文件」这个动作把后续保存都钉成下载。
        await saveUntitledToWorkspace()
      }
    } catch (error) {
      // 保存链路（序列化/落盘）失败绝不能静默——否则磁盘停在旧版，刷新即丢数据。
      // 手动保存路径 toast 提示；MCP save_file 路径重新抛出以让工具返回错误。
      toast.error(`保存失败：${saveErrorMessage(error)}`)
      throw error
    }
  }

  /**
   * 未命名画布「保存」：输入文件名 → 直接存到工作区根目录（file-bridge 写盘，不弹路径选择）。
   * 工作区不可达时回退到原 saveFigFileAs 行为（Tauri 原生 / 浏览器下载）。
   */
  async function saveUntitledToWorkspace() {
    const requested = promptForWorkspaceFileName()
    const base = sanitizeWorkspaceFileName(requested)

    let path: string
    try {
      path = await resolveUniqueWorkspacePath(`${base}.fig`)
    } catch (reason) {
      console.warn('[bridge] 工作区不可达，回退到另存为', reason)
      await saveFigFileAs()
      return
    }

    setStorageBinding({ providerId: BRIDGE_PROVIDER_ID, documentId: path })
    state.documentName = documentNameFromFigPath(path)
    setDownloadName(path)
    setSourceIdentity({ handle: null, path: null })
    state.autosaveEnabled = true
    const wrote = await withAIOpsLock(path, async () => writeFile(await buildFigFile()))
    if (wrote) {
      startWatchingFile()
      void bridgeClient.reportRecent(path)
      void bridgeClient.reportActive(path)
      rememberWorkspaceFile(path)
      toast.info('文件已保存到云端')
    }
  }

  function promptForWorkspaceFileName(): string {
    const defaultName = state.documentName === 'Untitled' ? 'Untitled' : state.documentName
    try {
      // Some embedded browsers deliberately disable synchronous dialogs.  A
      // failed naming prompt must not prevent the normal Save action from
      // writing the document to the workspace.
      return window.prompt('保存到工作区根目录，请输入文件名：', defaultName) || defaultName
    } catch {
      return defaultName
    }
  }

  /** 另存为/导出的快照序列化：失败统一提示「导出失败」并抛出（与落盘「保存失败」区分）。 */
  async function buildExportData(): Promise<Uint8Array> {
    try {
      return await buildFigFile()
    } catch (error) {
      toast.error(`导出失败：${saveErrorMessage(error)}`)
      throw error
    }
  }

  async function saveFigFileAs() {
    // 另存为 = 一次性导出副本，不应改变文档的持久保存目标。执行前快照当前可写源，
    // 导出写盘后按「是否原有无源」决定是否恢复，避免绑定被销毁/downloadName 固化
    // 导致后续保存全变下载；仅当文档原本无任何可写源时才允许另存为建立新目标。
    // documentName 同样参与快照恢复：另存为只是导出副本，画布标题应保持原文件名字，
    // 直到刷新重载后才从磁盘文件取新名（a416ff16「另存为=一次性导出不切换目标」语义）。
    const prev = {
      binding: getStorageBinding(),
      path: getFilePath(),
      handle: getFileHandle(),
      name: getDownloadName(),
      documentName: state.documentName
    }
    const hadWritableSource = Boolean(prev.binding || prev.path || prev.handle)
    const restorePrevSource = () => {
      setStorageBinding(prev.binding)
      setFilePath(prev.path)
      setFileHandle(prev.handle)
      setDownloadName(prev.name)
      state.documentName = prev.documentName
    }

    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path) return
      setStorageBinding(null)
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      state.autosaveEnabled = true
      const docPath = await journalDocPathForFilePath(path)
      try {
        const wrote = await withAIOpsLock(docPath, async () => writeFile(await buildExportData()))
        if (wrote) setSourceIdentity({ handle: null, path })
      } catch (error) {
        toast.error(`保存失败：${saveErrorMessage(error)}`)
        throw error
      }
      startWatchingFile()
      return
    }

    const defaultFilename = getDownloadName() ?? 'Untitled.fig'
    let filename = defaultFilename
    try {
      filename = prompt(dialogMessages.get().saveAsPrompt, defaultFilename) || defaultFilename
    } catch {
      // Keep Save As usable in the same embedded-browser environment as Save.
    }
    setStorageBinding(null)
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
    downloadBlob(new Uint8Array(await buildExportData()), filename, 'application/octet-stream')
    if (hadWritableSource) restorePrevSource()
  }

  return { saveFigFile, saveFigFileAs, writeFile }
}
