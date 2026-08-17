import { ref } from 'vue'

import type { DocumentSourceIdentity } from '@/app/document/io/types'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

export function createDocumentSourceState() {
  let fileHandle: FileSystemFileHandle | null = null
  let filePath: string | null = null
  let downloadName: string | null = null
  let sourceIdentity: DocumentSourceIdentity = { handle: null, path: null }
  let storageBinding: StorageDocumentBinding | null = null
  // P0 协作：binding 就绪的真实反应式信号（EditorView 自动进房 watch 依赖它）。
  // documentName 存在「值不变陷阱」（同值二次赋值不触发），binding 从 null → 有值
  // 才是可验证的「可进房」事件；所有 setStorageBinding 调用都会同步刷新该信号。
  const bindingDocumentId = ref<string | null>(null)
  let savedVersion = 0
  let lastWriteTime = 0

  return {
    getFileHandle: () => fileHandle,
    setFileHandle: (handle: FileSystemFileHandle | null) => {
      fileHandle = handle
    },
    getFilePath: () => filePath,
    setFilePath: (path: string | null) => {
      filePath = path
    },
    getDownloadName: () => downloadName,
    setDownloadName: (name: string | null) => {
      downloadName = name
    },
    getSourceIdentity: () => sourceIdentity,
    setSourceIdentity: (identity: DocumentSourceIdentity) => {
      sourceIdentity = identity
    },
    getStorageBinding: () => storageBinding,
    setStorageBinding: (binding: StorageDocumentBinding | null) => {
      storageBinding = binding
      bindingDocumentId.value = binding?.documentId ?? null
    },
    /** P0 协作：binding 就绪反应式信号（EditorView 自动进房 watch 依赖）。 */
    getBindingDocumentId: () => bindingDocumentId,
    getSavedVersion: () => savedVersion,
    setSavedVersion: (version: number) => {
      savedVersion = version
    },
    getLastWriteTime: () => lastWriteTime,
    setLastWriteTime: (time: number) => {
      lastWriteTime = time
    }
  }
}
