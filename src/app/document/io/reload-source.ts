import { readFigFile } from '@open-pencil/core/io/formats/fig'

import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { isTauri } from '@/app/tauri/env'

export type ReloadSourceOptions = {
  documentName: string
  filePath: string | null
  fileHandle: FileSystemFileHandle | null
  storageBinding?: StorageDocumentBinding | null
}

export async function readReloadSource({
  documentName,
  filePath,
  fileHandle,
  storageBinding
}: ReloadSourceOptions) {
  if (storageBinding?.providerId === BRIDGE_PROVIDER_ID) {
    const bytes = await bridgeClient.getFile(storageBinding.documentId)
    const payload = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    const file = new File([payload], `${documentName}.fig`)
    return readFigFile(file, { populate: 'first-page' })
  }

  if (filePath && isTauri()) {
    const { readFile: tauriRead } = await import('@tauri-apps/plugin-fs')
    const bytes = await tauriRead(filePath)
    const blob = new Blob([bytes])
    const file = new File([blob], `${documentName}.fig`)
    return readFigFile(file, { populate: 'first-page' })
  }

  if (fileHandle) {
    const file = await fileHandle.getFile()
    return readFigFile(file, { populate: 'first-page' })
  }

  return null
}
