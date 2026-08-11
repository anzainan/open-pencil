/**
 * Shared application layer for remote AI tool calls against the in-memory canvas.
 *
 * Unifies the two invocation paths used by the automation bridge:
 *   - `render` with a `tree` argument (design-jsx renderTreeNode, legacy/CLI shape)
 *   - any registered `ALL_TOOLS` ToolDef (including `render` with `jsx`)
 *
 * Every mutating call mirrors the browser AI chat recipe (createAITools):
 * snapshot → execute → fonts → computeAllLayouts → requestRender → flash,
 * plus optional undo-entry push (snapshot undo) and optional anti-loss journal.
 */
import { renderTreeNode } from '@open-pencil/core/design-jsx'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { ALL_TOOLS, appendPostComputeWarnings } from '@open-pencil/core/tools'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import {
  journalAppendAiOp,
  journalDocPath,
  removeAiOpsFrom,
  withAiOpsLock
} from '@/app/bridge/op-journal'
import { ensureGraphFonts } from '@/app/editor/fonts'
import type { AutomationTarget } from '@/app/automation/bridge/target'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

export interface ApplyToolOptions {
  /** Record the op in the anti-loss IndexedDB journal (bridge documents). */
  journal?: boolean
  /** Push a snapshot undo entry for this op (label "AI: <tool>"). */
  undo?: boolean
}

/**
 * AI 活跃窗口：最近一次 automation RPC 调用发生在多久以内视为「AI 在干活」。
 * 期间挂起磁盘 reload（见 document/io/read.ts reloadFromDiskLocked），
 * 避免 AI 批量操作 + autosave 回写 echo 的窄竞态触发画布重建屏闪。
 */
const AI_ACTIVE_WINDOW_MS = 10_000
let lastAutomationRpcAt = 0

/** 记录一次 automation RPC 调用（工具应用 / WS 请求）。 */
export function markAutomationRpc(): void {
  lastAutomationRpcAt = Date.now()
}

/** 当前是否处于 AI 活跃窗口（最近 windowMs 内有过 automation RPC 调用）。 */
export function isAutomationRpcActive(windowMs: number = AI_ACTIVE_WINDOW_MS): boolean {
  return Date.now() - lastAutomationRpcAt <= windowMs
}

export interface ApplyToolResult {
  ok: boolean
  result?: unknown
  error?: string
}

function extractNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as JsonObject
  if (typeof obj.deleted === 'string') return []
  const ids: string[] = []
  if (typeof obj.id === 'string') ids.push(obj.id)
  if (Array.isArray(obj.results)) {
    for (const item of obj.results) {
      if (item && typeof item === 'object' && typeof (item as JsonObject).id === 'string')
        ids.push((item as JsonObject).id as string)
    }
  }
  return ids
}

async function finishMutating(
  store: AutomationTarget['store'],
  pageId: string,
  figma: FigmaAPI,
  result: unknown,
  name: string,
  toolArgs: Record<string, unknown>,
  options: ApplyToolOptions,
  beforeSnapshot: ReturnType<typeof store.snapshotPage> | null,
  docPath: string | null
): Promise<unknown> {
  const pageNode = store.graph.getNode(pageId)
  if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds, store.renderer)
  computeAllLayouts(store.graph, pageId)
  store.requestRender()
  store.flashNodes(extractNodeIds(result))

  // 布局重算可能把 resize 回写回 Yoga 计算值（flex HUG）→ 回读 diff 并追加 warning。
  const verified = appendPostComputeWarnings(figma, name, toolArgs, result)

  // Append to the journal first (the caller holds the document lock, so this
  // cannot race the covering autosave write). The assigned seq is carried on the
  // undo entry: undoing removes that journal range, redoing re-appends it.
  let journalSeq: number | null = null
  if (options.journal && docPath) {
    try {
      journalSeq = await journalAppendAiOp(store, name, toolArgs)
    } catch (e) {
      console.warn('[collab] failed to journal op', name, e instanceof Error ? e.message : e)
    }
  }

  if (options.undo && beforeSnapshot) {
    const after = store.snapshotPage()
    store.pushUndoEntry({
      label: `AI: ${name}`,
      forward: () => {
        store.restorePageFromSnapshot(after)
        if (docPath && journalSeq != null) {
          // Redo restores the op to the graph → make it loss-protected again.
          void withAiOpsLock(docPath, () => journalAppendAiOp(store, name, toolArgs)).catch(
            () => undefined
          )
        }
      },
      inverse: () => {
        store.restorePageFromSnapshot(beforeSnapshot)
        if (docPath && journalSeq != null) {
          // Undo removes the op's effect → drop its journal records so replay
          // cannot resurrect it.
          void withAiOpsLock(docPath, () => removeAiOpsFrom(docPath, journalSeq)).catch(
            () => undefined
          )
        }
      }
    })
  }

  return verified
}

/**
 * Apply one remote tool call to the in-memory graph of the target store.
 * Mirrors the browser AI chat semantics (undo + layout + render + flash).
 */
export async function applyAutomationTool(
  makeFigma: FigmaFactory,
  target: AutomationTarget,
  name: string,
  toolArgs: Record<string, unknown>,
  options: ApplyToolOptions = {}
): Promise<ApplyToolResult> {
  markAutomationRpc()
  const store = target.store
  // Journaling ops hold the document lock for the whole "mutate + append" span so
  // no autosave write can serialize/clear in the middle (see op-journal header).
  const docPath = options.journal ? await journalDocPath(store) : null

  const apply = async (): Promise<ApplyToolResult> => {
    if (name === 'render' && toolArgs.tree !== undefined) {
      const before = options.undo ? store.snapshotPage() : null
      try {
        const tree = toolArgs.tree as Parameters<typeof renderTreeNode>[1]
        const result = await renderTreeNode(store.graph, tree, {
          parentId: (toolArgs.parent_id as string | undefined) ?? target.pageId,
          x: toolArgs.x as number | undefined,
          y: toolArgs.y as number | undefined
        })
        await finishMutating(
          store,
          target.pageId,
          makeFigma(store, target.pageId),
          result,
          name,
          toolArgs,
          options,
          before,
          docPath
        )
        return {
          ok: true,
          result: { id: result.id, name: result.name, type: result.type, children: result.childIds }
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }

    const def = ALL_TOOLS.find((t) => t.name === name)
    if (!def) return { ok: false, error: `Unknown tool: ${name}` }

    const figma = makeFigma(store, target.pageId)
    const before = def.mutates && options.undo ? store.snapshotPage() : null
    try {
      let result = await def.execute(figma, toolArgs)
      if (def.mutates) {
        result = await finishMutating(
          store,
          figma.currentPageId,
          figma,
          result,
          name,
          toolArgs,
          options,
          before,
          docPath
        )
      }
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return withAiOpsLock(docPath, apply)
}
