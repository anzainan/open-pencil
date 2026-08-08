import type { EditorState } from '@open-pencil/core/editor'

import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { resolveUniqueWorkspacePath, sanitizeWorkspaceFileName } from '@/app/bridge/workspace-name'
import { downloadBlob } from '@/app/document/io/browser'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { chooseBrowserFigSaveHandle, chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentWriter } from '@/app/document/io/write'
import { IS_TAURI } from '@/constants'

type SaveDocumentState = EditorState & {
  documentName: string
  autosaveEnabled?: boolean
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
    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    const storageBinding = getStorageBinding()
    const downloadName = getDownloadName()
    if (storageBinding || filePath || fileHandle) {
      const wrote = await writeFile(await buildFigFile())
      if (wrote && !storageBinding) setSourceIdentity({ handle: fileHandle, path: filePath })
    } else if (downloadName) {
      downloadBlob(new Uint8Array(await buildFigFile()), downloadName, 'application/octet-stream')
    } else {
      await saveUntitledToWorkspace()
    }
  }

  /**
   * 未命名画布「保存」：输入文件名 → 直接存到工作区根目录（file-bridge 写盘，不弹路径选择）。
   * 工作区不可达时回退到原 saveFigFileAs 行为（Tauri 原生 / 浏览器下载）。
   */
  async function saveUntitledToWorkspace() {
    const token = await bridgeClient.getToken()
    if (!token) {
      await saveFigFileAs()
      return
    }

    const requested = promptForWorkspaceFileName()
    if (requested === null) return
    const base = sanitizeWorkspaceFileName(requested)
    if (!base) return

    const data = await buildFigFile()
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
    setSavedVersion(state.sceneVersion)
    const wrote = await writeFile(data)
    if (wrote) {
      startWatchingFile()
      void bridgeClient.reportRecent(path)
      void bridgeClient.reportActive(path)
    }
  }

  function promptForWorkspaceFileName(): string | null {
    const defaultName = state.documentName === 'Untitled' ? '' : state.documentName
    return window.prompt('保存到工作区根目录，请输入文件名：', defaultName)
  }

  async function saveFigFileAs() {
    const data = await buildFigFile()

    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path) return
      setStorageBinding(null)
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      if (await writeFile(data)) setSourceIdentity({ handle: null, path })
      startWatchingFile()
      return
    }

    if (window.showSaveFilePicker) {
      const handle = await chooseBrowserFigSaveHandle()
      if (!handle) return
      setStorageBinding(null)
      setFileHandle(handle)
      setFilePath(null)
      state.documentName = documentNameFromFigPath(handle.name)
      if (await writeFile(data)) setSourceIdentity({ handle, path: null })
      startWatchingFile()
      return
    }

    const filename = prompt('Save as:', getDownloadName() ?? 'Untitled.fig')
    if (!filename) return
    setStorageBinding(null)
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
    downloadBlob(new Uint8Array(data), filename, 'application/octet-stream')
  }

  return { saveFigFile, saveFigFileAs, writeFile }
}
