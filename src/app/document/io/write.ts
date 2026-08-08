import type { EditorState } from '@open-pencil/core/editor'

import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { clearAiOps, journalMaxSeq } from '@/app/bridge/op-journal'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { persistStorageCanvasLocally } from '@/app/storage/sync/persist'
import { isTauri } from '@/app/tauri/env'
import { IS_BROWSER } from '@/constants'

type WriteDocumentState = EditorState & { documentName: string }

type DocumentWriterOptions = {
  state: WriteDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  getStorageBinding: () => StorageDocumentBinding | null
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
}

export function createDocumentWriter({
  state,
  getFilePath,
  getFileHandle,
  getStorageBinding,
  setSavedVersion,
  setLastWriteTime
}: DocumentWriterOptions) {
  return async function writeFile(data: Uint8Array): Promise<boolean> {
    setLastWriteTime(Date.now())
    const storage = getStorageBinding()
    if (storage) {
      if (storage.providerId === BRIDGE_PROVIDER_ID) {
        await bridgeClient.putFile(storage.documentId, data)
        setLastWriteTime(Date.now())
        setSavedVersion(state.sceneVersion)
        // 落盘成功 = 磁盘已含全部已应用 AI 操作 → 有序清空防丢失日志。
        // 调用方在 withAiOpsLock 内执行本函数，序列化/PUT/清空与 journal 追加互斥；
        // 此处同步等待清空完成（而非 fire-and-forget），并用本次写盘时刻的最大
        // seq 作水位，只删已被该次写盘覆盖的记录。
        const persistedThrough = await journalMaxSeq(storage.documentId)
        await clearAiOps(storage.documentId, persistedThrough)
        return true
      }
      await persistStorageCanvasLocally({
        providerId: storage.providerId,
        canvasId: storage.documentId,
        name: state.documentName || 'Untitled',
        figBytes: data
      })
      setSavedVersion(state.sceneVersion)
      return true
    }

    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    if (filePath && isTauri()) {
      const { writeFile: tauriWrite } = await import('@tauri-apps/plugin-fs')
      await tauriWrite(filePath, data)
      setSavedVersion(state.sceneVersion)
      return true
    }
    if (fileHandle) {
      const writable = await fileHandle.createWritable()
      await writable.write(new Uint8Array(data))
      await writable.close()
      setSavedVersion(state.sceneVersion)
      return true
    }
    // web 兜底：仅持有 filePath 的工作区文件（同源浏览器 URL 或 designRoot 绝对路径），
    // 直接 PUT 写回工作区。覆盖「打开时 binding 未建立 / 被重置」的遗留标签页，
    // 确保打开已有文件后保存=覆盖。
    if (IS_BROWSER && filePath) {
      const designRoot = await bridgeClient.getDesignRoot()
      const rel = webFilePathToWorkspaceRel(filePath, designRoot)
      if (rel) {
        await bridgeClient.putFile(rel, data)
        setSavedVersion(state.sceneVersion)
        return true
      }
    }
    return false
  }
}

/** 把 web 版存下的 filePath 换算成工作区相对路径：designRoot 绝对路径或同源 URL（如 http://host:8082/PixelMob/login.fig）。 */
function webFilePathToWorkspaceRel(filePath: string, designRoot: string | null): string | null {
  if (!filePath || filePath.startsWith('blob:') || filePath.startsWith('data:')) return null
  let rel = filePath
  if (designRoot) {
    const normalizedRoot = designRoot.replace(/[\\/]+$/, '')
    if (rel.startsWith(normalizedRoot)) rel = rel.slice(normalizedRoot.length)
  }
  if (rel.startsWith('http://') || rel.startsWith('https://')) {
    let url: URL
    try {
      url = new URL(rel)
    } catch {
      return null
    }
    if (url.origin !== window.location.origin) return null
    rel = url.pathname
  }
  rel = rel.replace(/^[\\/]+/, '')
  if (!/\.(fig|pen)$/i.test(rel)) return null
  if (!rel || rel === '..' || rel.startsWith('../') || rel.includes('/../')) return null
  return rel
}
