/**
 * Anti-loss journal for remote AI canvas operations.
 *
 * Every mutating AI tool call applied in the browser is appended here BEFORE the
 * periodic `.fig` autosave persists it to disk. On a successful bridge PUT the
 * journal for that document is cleared; if the tab is refreshed/closed/crashes
 * before the next PUT, the journal is replayed when the document reopens
 * (see `replayPendingAIOps` in tabs). This is the IndexedDB half of the
 * "double insurance" against losing AI work.
 *
 * Keyed by the bridge document path (e.g. `PixelMob/login.fig`). Documents bound
 * only to a writable web filePath are keyed by its workspace-relative equivalent
 * (same derivation the writer uses to PUT); other non-bridge documents are not
 * journaled (their save semantics differ).
 *
 * Serialization (anti-race): all journal mutations — append, clear, and the
 * single-op range remove on undo — are mutually exclusive per document through a
 * FIFO lock (`withAIOpsLock`). The apply path holds the lock across "mutate +
 * append", and the save path holds the same lock across "serialize + PUT +
 * clear". This guarantees:
 *   - A write can never clear the journal while an op is still being appended
 *     (no "append after the covering write" → replay double-apply).
 *   - The journal can never drop an op whose effect was not captured by the
 *     covering write (no silent loss of mid-write appends).
 *   - Undo removes the undone op's journal range and redo re-appends it, so
 *     replay can never resurrect an undone op.
 */
import { openIdb, reqToPromise, txDone } from '@/app/storage/idb-util'
import type { EditorStore } from '@/app/editor/active-store'
import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client'
import { webFilePathToWorkspaceRel } from '@/app/bridge/workspace-path'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

const DB_NAME = 'open-pencil-collab-journal'
const DB_VERSION = 1
const STORE = 'ops'
const INDEX_DOC = 'byDoc'
/** Cap journal entries per document to bound IndexedDB usage (ux-live-collab §11-9). */
const MAX_OPS_PER_DOC = 500

export interface AIOpRecord {
  /** `${docPath}\u0000${seq}` — unique across documents. */
  id: string
  docPath: string
  seq: number
  tool: string
  args: Record<string, unknown>
  at: number
}

/** Per-document FIFO lock serializing journal mutations against autosave writes. */
const lockTails = new Map<string, Promise<void>>()

/**
 * Run `fn` exclusively for a document. Concurrent callers for the same document
 * (another `withAIOpsLock`, or any journal mutation performed inside one) queue
 * FIFO and run only after the current holder finishes. `fn` must not acquire the
 * same document lock again (no nesting); journal helpers are lock-free on
 * purpose and rely on their caller to hold the lock.
 */
export async function withAIOpsLock<T>(
  docPath: string | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!docPath) return fn()
  const previous = lockTails.get(docPath) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chain = previous.catch(() => undefined).then(() => gate)
  lockTails.set(docPath, chain)
  await previous.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (lockTails.get(docPath) === chain) lockTails.delete(docPath)
  }
}

function openDb(): Promise<IDBDatabase> {
  return openIdb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex(INDEX_DOC, 'docPath')
    }
  })
}

/** Journal key for a storage binding: its bridge path, or null when not bridge-bound. */
export function journalDocPathForBinding(binding: StorageDocumentBinding | null): string | null {
  if (!binding || binding.providerId !== BRIDGE_PROVIDER_ID || !binding.documentId) return null
  return binding.documentId
}

/** Journal key for a writable web filePath, converted to a workspace-relative bridge
 *  path (same derivation the writer uses to PUT). Null when not convertible. */
export async function journalDocPathForFilePath(
  filePath: string | null
): Promise<string | null> {
  if (!filePath) return null
  const designRoot = await bridgeClient.getDesignRoot()
  return webFilePathToWorkspaceRel(filePath, designRoot)
}

/** Journal key for a writable source: bridge binding first, then filePath fallback. */
export async function journalDocPathForSource(
  binding: StorageDocumentBinding | null,
  filePath: string | null
): Promise<string | null> {
  const bound = journalDocPathForBinding(binding)
  if (bound) return bound
  return journalDocPathForFilePath(filePath)
}

/** Journal key for a store: its bridge document path, or the workspace-relative
 *  path derived from its filePath; null when there is no writable bridge target. */
export async function journalDocPath(store: EditorStore): Promise<string | null> {
  return journalDocPathForSource(store.getStorageBinding(), store.getDocumentFilePath())
}

function recordId(docPath: string, seq: number): string {
  return `${docPath}\u0000${seq}`
}

async function docEntries(docPath: string): Promise<AIOpRecord[]> {
  const database = await openDb()
  const tx = database.transaction(STORE, 'readonly')
  const rows = (await reqToPromise(tx.objectStore(STORE).index(INDEX_DOC).getAll(docPath))) as AIOpRecord[]
  await txDone(tx)
  return rows.sort((a, b) => a.seq - b.seq)
}

/**
 * Append one applied AI op to the journal for the given store. No-op when the
 * store has no journalable target (no bridge binding and no convertible filePath).
 *
 * Must be called while holding the document lock (inside `withAIOpsLock`) so the
 * append cannot interleave with the covering autosave write. Returns the seq
 * assigned to the record; the caller syncs the journal on undo/redo through it.
 */
export async function journalAppendAIOp(
  store: EditorStore,
  tool: string,
  args: Record<string, unknown>
): Promise<number> {
  const docPath = await journalDocPath(store)
  if (!docPath) return 0
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
  return nextSeq
}

/** Highest seq currently journaled for a document (0 when empty). */
export async function journalMaxSeq(docPath: string): Promise<number> {
  if (!docPath) return 0
  const rows = await docEntries(docPath)
  return rows.length === 0 ? 0 : rows[rows.length - 1].seq
}

/** Pending (not-yet-persisted) AI ops for a document, sorted by seq. */
export async function getPendingAIOps(docPath: string): Promise<AIOpRecord[]> {
  if (!docPath) return []
  return docEntries(docPath)
}

/**
 * Clear the journal for a document after its state has been persisted to disk.
 * When `persistedThrough` is given, only records with seq <= that watermark are
 * removed, so an op appended outside the lock after the covering write is never
 * dropped by a stale clear.
 */
export async function clearAIOps(docPath: string, persistedThrough?: number): Promise<void> {
  if (!docPath) return
  const database = await openDb()
  const tx = database.transaction(STORE, 'readwrite')
  const objectStore = tx.objectStore(STORE)
  const index = objectStore.index(INDEX_DOC)
  const rows = (await reqToPromise(index.getAll(IDBKeyRange.only(docPath)))) as AIOpRecord[]
  for (const row of rows) {
    if (persistedThrough === undefined || row.seq <= persistedThrough) {
      objectStore.delete(row.id)
    }
  }
  await txDone(tx)
}

/**
 * Remove every journal record with seq >= `fromSeq` for a document. Used when an
 * AI op is undone so replay cannot resurrect it (LIFO undo guarantees all ops
 * with a higher seq were already undone/removed, so this only affects this op
 * and any stragglers a racing redo re-appended). Must be called while holding
 * the document lock.
 */
export async function removeAIOpsFrom(docPath: string, fromSeq: number): Promise<void> {
  if (!docPath) return
  const database = await openDb()
  const tx = database.transaction(STORE, 'readwrite')
  const objectStore = tx.objectStore(STORE)
  const index = objectStore.index(INDEX_DOC)
  const rows = (await reqToPromise(index.getAll(IDBKeyRange.only(docPath)))) as AIOpRecord[]
  for (const row of rows) {
    if (row.seq >= fromSeq) objectStore.delete(row.id)
  }
  await txDone(tx)
}
