import {
  resolveAutomationTarget,
  responseWithTarget,
  type AutomationTarget
} from '@/app/automation/bridge/target'
import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { resolveWorkspaceRelPath } from '@/app/bridge/workspace-path'
import { activeStorageProviderID, type StorageDocument } from '@/app/integrations/storage'
import { openFileFromPath } from '@/app/shell/menu/use'
import { createTab, getActiveStore, openStorageDocumentInNewTab } from '@/app/tabs'
import { isTauri } from '@/app/tauri/env'

export async function handleSaveFile(target: AutomationTarget, args: unknown): Promise<unknown> {
  const store = target.store
  const path = (args as { path?: string }).path
  if (path) {
    store.setPlannedFilePath(path)
    await ensureTauriParentDirectory(path)
  }
  await store.saveFigFile()
  if (path) store.startWatchingCurrentFile()
  return { ok: true }
}

export async function ensureTauriParentDirectory(path: string): Promise<void> {
  if (!isTauri()) return
  const [{ dirname }, { mkdir }] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs')
  ])
  const dir = await dirname(path)
  if (dir === path) return
  await mkdir(dir, { recursive: true })
}

export async function handleNewDocument(
  _target: AutomationTarget,
  args: unknown
): Promise<unknown> {
  const path = (args as { path?: string }).path
  const tab = createTab()
  if (path) {
    tab.store.setPlannedFilePath(path)
    await ensureTauriParentDirectory(path)
    await tab.store.saveFigFile()
    tab.store.startWatchingCurrentFile()
  }
  const target = resolveAutomationTarget(tab.store, { document_id: tab.id })
  return responseWithTarget({ ok: true, result: { created: true } }, target)
}

export async function handleOpenFile(_target: AutomationTarget, args: unknown): Promise<unknown> {
  const path = (args as { path?: string }).path
  if (!path) throw new Error('Missing "path" in args')
  if (isTauri()) {
    await openFileFromPath(path)
  } else {
    // web 版打开工作区文件：走 storage binding 管线（绑定 bridge-fs 文档 id），
    // 保存时直接覆盖写回原文件，而不是只留一个不可写的 filePath。
    const rel = await resolveWorkspaceRelPath(path)
    const meta = await bridgeClient.getFileMeta(rel).catch(() => null)
    const document: StorageDocument = {
      id: rel,
      name: (meta?.name ?? rel.split('/').pop() ?? 'file').replace(/\.(fig|pen)$/i, ''),
      updatedAt: meta?.updatedAt ?? new Date().toISOString(),
      metadataAuthoritative: true
    }
    activeStorageProviderID.value = BRIDGE_PROVIDER_ID
    await openStorageDocumentInNewTab(document)
  }
  const target = resolveAutomationTarget(getActiveStore(), undefined)
  return responseWithTarget({ ok: true, result: { opened: true } }, target)
}
