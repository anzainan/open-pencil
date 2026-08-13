import { BRIDGE_PROVIDER_ID, bridgeClient } from './client'
import { rememberWorkspaceFile } from './restore'
import { getTabsSnapshot } from '@/app/tabs'
import type { EditorStore } from '@/app/editor/active-store'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

/**
 * 工作区 rename/move 联动：路径变化后同步所有已打开 editor tab 的 storage binding，
 * 否则打开的旧路径 tab 会在 autosave 时把旧文件「复活」回磁盘。
 * （文件在 tab 体系内同一 id 最多打开一个 tab，遍历全 tab 即可。）
 */
export function rebindOpenTabsAfterPathChange(
  oldPath: string,
  newPath: string,
  newName: string
): void {
  for (const tab of getTabsSnapshot()) {
    const binding = tab.store.getStorageBinding()
    if (!binding || binding.providerId !== BRIDGE_PROVIDER_ID || binding.documentId !== oldPath) {
      continue
    }
    tab.store.setStorageDocumentSource(
      { providerId: binding.providerId, documentId: newPath } satisfies StorageDocumentBinding,
      newName
    )
  }
}

/**
 * 通用工作区重命名（首页/文件夹页右键菜单用）：调用端点写回磁盘 + 联动打开 tab。
 * 返回新相对路径；失败抛出（由调用方 toast）。
 */
export async function renameWorkspaceEntry(oldPath: string, newName: string): Promise<string> {
  const newPath = await bridgeClient.renameFile(oldPath, newName)
  rebindOpenTabsAfterPathChange(oldPath, newPath, newName)
  return newPath
}

/**
 * 画布内改名写回存储（Task 6）：当前文档有 bridge storage binding 时，
 * 调 rename 端点 + 更新 binding + 同步 `?file=` URL。失败时回滚内存名并抛错。
 */
export async function renameWorkspaceDocument(store: EditorStore, newName: string): Promise<void> {
  const binding = store.getStorageBinding()
  if (!binding || binding.providerId !== BRIDGE_PROVIDER_ID || !binding.documentId) return
  const oldName = store.state.documentName
  try {
    const newPath = await bridgeClient.renameFile(binding.documentId, newName)
    store.setStorageDocumentSource(
      { providerId: binding.providerId, documentId: newPath } satisfies StorageDocumentBinding,
      newName
    )
    rememberWorkspaceFile(newPath)
  } catch (error) {
    store.state.documentName = oldName
    throw error
  }
}

/**
 * 通用工作区移动（首页/文件夹页右键菜单用）：调用端点写回磁盘 + 联动打开 tab。
 * 返回新相对路径；失败抛出（由调用方 toast）。
 */
export async function moveWorkspaceEntry(oldPath: string, to: string): Promise<string> {
  const newPath = await bridgeClient.moveFile(oldPath, to)
  const newName = newPath.split('/').pop() ?? newPath
  rebindOpenTabsAfterPathChange(oldPath, newPath, newName)
  return newPath
}

/**
 * 移至回收站（首页/文件夹页右键菜单用）：软删 + 联动打开 tab（打开中的该文档停止写回，
 * 因为文件已离开工作区列表，保存会 PUT 到一个不存在的路径导致「复活」）。
 */
export async function trashWorkspaceEntry(path: string): Promise<void> {
  await bridgeClient.trashFile(path)
  for (const tab of getTabsSnapshot()) {
    const binding = tab.store.getStorageBinding()
    if (
      binding &&
      binding.providerId === BRIDGE_PROVIDER_ID &&
      binding.documentId === path
    ) {
      tab.store.setStorageDocumentSource(
        { providerId: binding.providerId, documentId: path } satisfies StorageDocumentBinding,
        tab.store.state.documentName,
        { stale: true }
      )
    }
  }
}
