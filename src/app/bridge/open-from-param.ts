import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { activeStorageProviderID, type StorageDocument } from '@/app/integrations/storage'
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
    const document: StorageDocument = {
      id: relPath,
      name: name.replace(/\.(fig|pen)$/i, ''),
      updatedAt: meta?.updatedAt ?? new Date().toISOString(),
      metadataAuthoritative: true
    }
    await openStorageDocumentInNewTab(document)
  })().catch((error) => {
    console.warn('[open-from-param]', error)
  })
}
