import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { watchBrowserFile, watchTauriFile } from '@/app/document/io/watch-targets'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { IS_TAURI } from '@/constants'

type FileWatchOptions = {
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  getStorageBinding: () => StorageDocumentBinding | null
  getLastWriteTime: () => number
  reloadFromDisk: () => void
}

export function createFileWatcher({
  getFilePath,
  getFileHandle,
  getStorageBinding,
  getLastWriteTime,
  reloadFromDisk
}: FileWatchOptions) {
  let unwatchFile: (() => void) | null = null

  function stopWatchingFile() {
    if (unwatchFile) {
      unwatchFile()
      unwatchFile = null
    }
  }

  async function startWatchingFile() {
    stopWatchingFile()
    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    const storageBinding = getStorageBinding()

    if (storageBinding?.providerId === BRIDGE_PROVIDER_ID && storageBinding.documentId) {
      unwatchFile = bridgeClient.watchPath(
        storageBinding.documentId,
        getLastWriteTime,
        reloadFromDisk
      )
    } else if (filePath && IS_TAURI) {
      unwatchFile = await watchTauriFile(filePath, getLastWriteTime, reloadFromDisk)
    } else if (fileHandle) {
      unwatchFile = await watchBrowserFile(
        fileHandle,
        getFileHandle,
        getLastWriteTime,
        reloadFromDisk,
        stopWatchingFile
      )
    }
  }

  return { startWatchingFile, stopWatchingFile }
}
