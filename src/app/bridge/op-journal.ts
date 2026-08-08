/**
 * Anti-loss journal for remote AI canvas operations.
 *
 * Every mutating AI tool call applied in the browser is appended here BEFORE the
 * periodic `.fig` autosave persists it to disk. On a successful bridge PUT the
 * journal for that document is cleared; if the tab is refreshed/closed/crashes
 * before the next PUT, the journal is replayed when the document reopens
 * (see `replayPendingAiOps` in tabs). This is the IndexedDB half of the
 * "double insurance" against losing AI work.
 *
 * Keyed by the bridge document path (e.g. `PixelMob/login.fig`); non-bridge
 * documents are not journaled (their save semantics differ).
 */
import { openIdb, reqToPromise, txDone } from '@/app/storage/idb-util'
import type { EditorStore } from '@/app/editor/active-store'
import { BRIDGE_PROVIDER_ID } from '@/app/bridge/client'

const DB_NAME = 'open-pencil-collab-journal'
const DB_VERSION = 1
const STORE = 'ops'
const INDEX_DOC = 'byDoc'
/** Cap journal entries per document to bound IndexedDB usage (ux-live-collab §11-9). */
const MAX_OPS_PER_DOC = 200

export interface AiOpRecord {
  /** `${docPath}\u0000${seq}` — unique across documents. */
  id: string
  docPath: string
  seq: number
  tool: string
  args: Record<string, unknown>
  at: number
}

function openDb(): Promise<IDBDatabase> {
  return openIdb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex(INDEX_DOC, 'docPath')
    }
  })
}

/** Journal key for a store: its bridge document path, or null when not bridge-bound. */
export function journalDocPath(store: EditorStore): string | null {
  const binding = store.getStorageBinding()
  if (!binding || binding.providerId !== BRIDGE_PROVIDER_ID || !binding.documentId) return null
  return binding.documentId
}

function recordId(docPath: string, seq: number): string {
  return `${docPath}\u0000${seq}`
}

async function docEntries(docPath: string): Promise<AiOpRecord[]> {
  const database = await openDb()
  const tx = database.transaction(STORE, 'readonly')
  const rows = (await reqToPromise(tx.objectStore(STORE).index(INDEX_DOC).getAll(docPath))) as AiOpRecord[]
  await txDone(tx)
  return rows.sort((a, b) => a.seq - b.seq)
}

/**
 * Append one applied AI op to the journal for the given store.
 * No-op when the store is not bound to a bridge document.
 */
export async function journalAppendAiOp(
  store: EditorStore,
  tool: string,
  args: Record<string, unknown>
): Promise<void> {
  const docPath = journalDocPath(store)
  if (!docPath) return
  const database = await openDb()
  const tx = database.transaction(STORE, 'readwrite')
  const objectStore = tx.objectStore(STORE)
  const existing = await docEntries(docPath)
  const nextSeq = existing.length === 0 ? 1 : existing[existing.length - 1].seq + 1
  objectStore.put({
    id: recordId(docPath, nextSeq),
    docPath,
    seq: nextSeq,
    tool,
    args,
    at: Date.now()
  })
  // Drop oldest entries beyond the cap.
  if (existing.length >= MAX_OPS_PER_DOC) {
    const dropCount = existing.length - MAX_OPS_PER_DOC + 1
    for (const row of existing.slice(0, dropCount)) {
      objectStore.delete(row.id)
    }
  }
  await txDone(tx)
}

/** Pending (not-yet-persisted) AI ops for a document, sorted by seq. */
export async function getPendingAiOps(docPath: string): Promise<AiOpRecord[]> {
  if (!docPath) return []
  return docEntries(docPath)
}

/** Clear the journal for a document after its state has been persisted to disk. */
export async function clearAiOps(docPath: string): Promise<void> {
  if (!docPath) return
  const database = await openDb()
  const tx = database.transaction(STORE, 'readwrite')
  const objectStore = tx.objectStore(STORE)
  const index = objectStore.index(INDEX_DOC)
  const keys = await reqToPromise(index.getAllKeys(IDBKeyRange.only(docPath)))
  for (const key of keys) {
    objectStore.delete(key)
  }
  await txDone(tx)
}
