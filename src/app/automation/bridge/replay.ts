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
import { getPendingAiOps, withAiOpsLock } from '@/app/bridge/op-journal'
import type { EditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

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
  // 重放期间持锁：autosave 落盘不会插进重放中途清空 journal（已记录的待重放
  // 操作在重放完成并落盘前必须保留）。重放本身 journal:false，不会二次加锁。
  let failed = 0
  await withAiOpsLock(docPath, async () => {
    for (const op of ops) {
      const result = await applyAutomationTool(makeFigmaFromStore, target, op.tool, op.args, {
        journal: false,
        undo: false
      })
      if (!result.ok) {
        failed += 1
        console.warn('[collab-replay] failed to replay op', op.tool, result.error)
      }
    }
  })
  // 重放是尽力而为：引用了旧会话 node id 的操作（update_node/set_fill/…）在新图里
  // 会 Node not found。失败可见，用户据此决定是否手动补做，而非静默丢操作。
  if (failed > 0) {
    toast.warning(`部分操作因 id 变化未能恢复（${failed}/${ops.length} 条）`)
  }
  return ops.length
}
