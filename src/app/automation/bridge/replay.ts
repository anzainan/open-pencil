/**
 * Recovery replay for the anti-loss journal.
 *
 * When a bridge document reopens and its journal is non-empty, the recorded AI
 * ops have not yet been persisted to disk (a refresh/close/crash happened before
 * the next autosave PUT). Replay them against the freshly-loaded in-memory graph
 * so no AI work is lost, then let the normal autosave pipeline persist the result.
 *
 * Replay applies ops without re-journaling and without pushing undo entries
 * (recovery is transparent; the undo stack stays clean for post-recovery edits).
 */
import { applyAutomationTool } from '@/app/automation/bridge/apply'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { getPendingAiOps } from '@/app/bridge/op-journal'
import type { EditorStore } from '@/app/editor/active-store'

export async function replayPendingAiOps(
  store: EditorStore,
  tabId: string,
  docPath: string
): Promise<number> {
  const ops = await getPendingAiOps(docPath)
  if (ops.length === 0) return 0
  const pageId = store.state.currentPageId
  const pageName = store.graph.getNode(pageId)?.name ?? ''
  const target = {
    store,
    documentId: tabId,
    documentName: store.state.documentName,
    path: docPath,
    pageId,
    pageName
  }
  for (const op of ops) {
    const result = await applyAutomationTool(makeFigmaFromStore, target, op.tool, op.args, {
      journal: false,
      undo: false
    })
    if (!result.ok) {
      console.warn('[collab-replay] failed to replay op', op.tool, result.error)
    }
  }
  return ops.length
}
