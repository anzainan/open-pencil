import type { StorageDocument } from '@/app/integrations/storage'
import type { LocalCanvasMeta } from '@/app/storage/local-store'

export type StorageReconciliation = {
  documents: StorageDocument[]
  remoteDocumentsToSeed: StorageDocument[]
  localIdsToPurge: string[]
}

/** Merge a successful remote listing with pending local work without reviving tombstones. */
export function reconcileStorageDocuments(
  local: LocalCanvasMeta[],
  remote: StorageDocument[]
): StorageReconciliation {
  const localById = new Map(local.map((metadata) => [metadata.id, metadata]))
  const tombstonedIds = new Set(
    local.filter((metadata) => metadata.tombstoned).map((metadata) => metadata.id)
  )
  const remoteIds = new Set(remote.map((document) => document.id))
  const merged = new Map(
    remote
      .filter((document) => !tombstonedIds.has(document.id))
      .map((document) => [document.id, document])
  )

  for (const metadata of local) {
    if (metadata.tombstoned) continue
    // A synced row missing from the remote listing means the remote file was
    // deleted on the storage side (e.g. NAS). It must not be revived as local
    // work — only non-synced rows carry durable pending changes.
    if (metadata.syncStatus === 'synced') continue
    merged.set(metadata.id, {
      id: metadata.id,
      name: metadata.name,
      updatedAt: metadata.updatedAt,
      metadataAuthoritative: true
    })
  }

  return {
    documents: [...merged.values()].sort((first, second) =>
      second.updatedAt.localeCompare(first.updatedAt)
    ),
    remoteDocumentsToSeed: remote.filter((document) => !localById.has(document.id)),
    localIdsToPurge: local
      .filter(
        (metadata) =>
          !remoteIds.has(metadata.id) &&
          (metadata.tombstoned || metadata.syncStatus === 'synced')
      )
      .map((metadata) => metadata.id)
  }
}
