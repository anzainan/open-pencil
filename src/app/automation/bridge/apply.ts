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
import { ALL_TOOLS } from '@open-pencil/core/tools'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { journalAppendAiOp } from '@/app/bridge/op-journal'
import { ensureGraphFonts } from '@/app/editor/fonts'
import type { AutomationTarget } from '@/app/automation/bridge/target'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

export interface ApplyToolOptions {
  /** Record the op in the anti-loss IndexedDB journal (bridge documents). */
  journal?: boolean
  /** Push a snapshot undo entry for this op (label "AI: <tool>"). */
  undo?: boolean
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
  result: unknown,
  name: string,
  toolArgs: Record<string, unknown>,
  options: ApplyToolOptions,
  beforeSnapshot: ReturnType<typeof store.snapshotPage> | null
): Promise<void> {
  const pageNode = store.graph.getNode(pageId)
  if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds, store.renderer)
  computeAllLayouts(store.graph, pageId)
  store.requestRender()
  store.flashNodes(extractNodeIds(result))
  if (options.undo && beforeSnapshot) {
    const after = store.snapshotPage()
    store.pushUndoEntry({
      label: `AI: ${name}`,
      forward: () => store.restorePageFromSnapshot(after),
      inverse: () => store.restorePageFromSnapshot(beforeSnapshot)
    })
  }
  if (options.journal) {
    await journalAppendAiOp(store, name, toolArgs)
  }
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
  const store = target.store

  if (name === 'render' && toolArgs.tree !== undefined) {
    const before = options.undo ? store.snapshotPage() : null
    try {
      const tree = toolArgs.tree as Parameters<typeof renderTreeNode>[1]
      const result = await renderTreeNode(store.graph, tree, {
        parentId: (toolArgs.parent_id as string | undefined) ?? target.pageId,
        x: toolArgs.x as number | undefined,
        y: toolArgs.y as number | undefined
      })
      await finishMutating(store, target.pageId, result, name, toolArgs, options, before)
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
    const result = await def.execute(figma, toolArgs)
    if (def.mutates) {
      await finishMutating(store, figma.currentPageId, result, name, toolArgs, options, before)
    }
    return { ok: true, result }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
