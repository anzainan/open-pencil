import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { clearRememberedWorkspaceFile } from '@/app/bridge/restore'
import { activeStorageProviderID, type StorageDocument } from '@/app/integrations/storage'
import { toast } from '@/app/shell/ui'
import { openStorageDocumentInNewTab } from '@/app/tabs'
import { IS_BROWSER } from '@/constants'

export function openFileFromQueryParam(): void {
  if (!IS_BROWSER) return

  const params = new URLSearchParams(window.location.search)
  const relPath = params.get('file')
  if (!relPath || relPath.trim() === '') return

  activeStorageProviderID.value = BRIDGE_PROVIDER_ID
  const name = relPath.split(/[\\/]/).pop() ?? 'file.fig'
  void (async () => {
    const meta = await bridgeClient.getFileMeta(relPath).catch(() => null)
    if (!meta) {
      // 刷新恢复指向的工作区文件已在远端（NAS）删除：绝不打开本地缓存复活，
      // 清掉 URL 恢复参数并停留在当前页。
      toast.error(`工作区文件已被删除：${name}`)
      clearRememberedWorkspaceFile()
      return
    }
    const document: StorageDocument = {
      id: relPath,
      name: name.replace(/\.(fig|pen)$/i, ''),
      updatedAt: meta.updatedAt,
      metadataAuthoritative: true
    }
    await openStorageDocumentInNewTab(document)
    // 刷新恢复：确保回到编辑器视图展示该文件（打开失败时停留在当前页/空白画布即可）。
    if (window.location.pathname !== '/editor') {
      const { default: router } = await import('@/router')
      await router.replace('/editor')
    }
  })().catch((error) => {
    console.warn('[open-from-param]', error)
  })
}
