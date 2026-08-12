import type { SceneGraph } from '@open-pencil/scene-graph'

import { renderTreeNode } from '#core/design-jsx'
import { snapshotPage, type PageSnapshot } from '#core/editor/history/snapshot'
import { FigmaAPI } from '#core/figma-api'
import { exportFigFile } from '#core/io/formats/fig'
import { computeAllLayouts } from '#core/layout'
import { ALL_TOOLS, appendPostComputeWarnings, wrapEvalCode } from '#core/tools'

export interface ApplyToolResult {
  ok: boolean
  result?: unknown
  error?: string
}

interface UndoEntry {
  label: string
  pageId: string
  before: PageSnapshot
  after: PageSnapshot
}

export interface HeadlessEditSessionOptions {
  graph: SceneGraph
  /** Original file path, used for in-place saves. */
  filePath?: string | null
  /** Initial current page. Defaults to the first page. */
  pageId?: string | null
}

/**
 * Server-side editing session that mirrors the browser apply.ts recipe
 * (snapshot → execute → computeAllLayouts → undo) against an in-memory
 * SceneGraph. Exposes the same `applyTool(name, args)` contract as the app
 * automation bridge so MCP can fall back to it when no browser is connected.
 */
export class HeadlessEditSession {
  readonly graph: SceneGraph
  filePath: string | null
  currentPageId: string
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []

  constructor({ graph, filePath, pageId }: HeadlessEditSessionOptions) {
    this.graph = graph
    this.filePath = filePath ?? null
    this.currentPageId = pageId ?? graph.getPages()[0].id
  }

  setCurrentPage(pageId: string): boolean {
    if (!this.graph.getNode(pageId)) return false
    this.currentPageId = pageId
    return true
  }

  pages(): Array<{ id: string; name: string }> {
    return this.graph.getPages().map((page) => ({ id: page.id, name: page.name }))
  }

  makeFigma(): FigmaAPI {
    const figma = new FigmaAPI(this.graph)
    const page = this.graph.getNode(this.currentPageId)
    if (page?.type === 'CANVAS') {
      figma.currentPage = figma.wrapNode(this.currentPageId)
    }
    return figma
  }

  private snapshot(): PageSnapshot {
    return snapshotPage(this.graph, this.currentPageId)
  }

  private pushUndo(label: string, before: PageSnapshot): void {
    const after = snapshotPage(this.graph, this.currentPageId)
    this.undoStack.push({ label, pageId: this.currentPageId, before, after })
    this.redoStack = []
  }

  /** Apply one registered tool. Mirrors browser applyAutomationTool. */
  async applyTool(name: string, args: Record<string, unknown>): Promise<ApplyToolResult> {
    if (name === 'render' && args.tree !== undefined) return this.applyRenderTree(args)
    const def = ALL_TOOLS.find((tool) => tool.name === name)
    if (!def) return { ok: false, error: `Unknown tool: ${name}` }

    const figma = this.makeFigma()
    const before = def.mutates ? this.snapshot() : null
    try {
      let result = await def.execute(figma, args)
      if (def.mutates) {
        computeAllLayouts(this.graph, figma.currentPageId)
        result = appendPostComputeWarnings(figma, name, args, result)
        if (before) this.pushUndo(`AI: ${name}`, before)
      }
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Legacy render-tree shape (design-jsx renderTreeNode). */
  private async applyRenderTree(args: Record<string, unknown>): Promise<ApplyToolResult> {
    const before = this.snapshot()
    try {
      const tree = args.tree as Parameters<typeof renderTreeNode>[1]
      const result = await renderTreeNode(this.graph, tree, {
        parentId: (args.parent_id as string | undefined) ?? this.currentPageId,
        x: args.x as number | undefined,
        y: args.y as number | undefined
      })
      computeAllLayouts(this.graph, this.currentPageId)
      this.pushUndo('AI: render (tree)', before)
      return {
        ok: true,
        result: { id: result.id, name: result.name, type: result.type, children: result.childIds }
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Evaluate Figma plugin API JS against the in-memory graph. */
  async eval(code: string): Promise<ApplyToolResult> {
    const figma = this.makeFigma()
    const before = this.snapshot()
    try {
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
        ...args: string[]
      ) => (...args: unknown[]) => Promise<unknown>
      const fn = new AsyncFunction('figma', wrapEvalCode(code))
      const result = await fn(figma)
      computeAllLayouts(this.graph, this.currentPageId)
      this.pushUndo('AI: eval', before)
      return { ok: true, result: result ?? null }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  undo(): ApplyToolResult {
    const entry = this.undoStack.pop()
    if (!entry) return { ok: false, error: 'Nothing to undo' }
    this.restore(entry.pageId, entry.before)
    this.redoStack.push(entry)
    return { ok: true, result: { undid: entry.label } }
  }

  redo(): ApplyToolResult {
    const entry = this.redoStack.pop()
    if (!entry) return { ok: false, error: 'Nothing to redo' }
    this.restore(entry.pageId, entry.after)
    this.undoStack.push(entry)
    return { ok: true, result: { redid: entry.label } }
  }

  private restore(pageId: string, snapshot: PageSnapshot): void {
    const page = this.graph.getNode(pageId)
    const pageSnap = snapshot.get(pageId)
    if (!page || !pageSnap) return
    for (const childId of page.childIds.slice()) this.graph.deleteNode(childId)
    restoreSnapshotChildren(this.graph, snapshot, pageId, pageSnap.childIds)
    this.graph.clearAbsPosCache()
    computeAllLayouts(this.graph, pageId)
  }

  /** Serialize the whole graph to .fig bytes (Node-safe, no renderer required). */
  async exportBytes(): Promise<Uint8Array> {
    return exportFigFile(this.graph)
  }
}

function restoreSnapshotChildren(
  graph: SceneGraph,
  snapshot: PageSnapshot,
  parentId: string,
  childIds: string[]
): void {
  for (const childId of childIds) {
    const snap = snapshot.get(childId)
    if (!snap) continue
    const { parentId: _snapParentId, childIds: snapChildIds, ...rest } = snap
    graph.createNode(snap.type, parentId, { ...rest, childIds: [] })
    graph.reorderChild(snap.id, parentId, childIds.indexOf(childId))
    restoreSnapshotChildren(graph, snapshot, snap.id, snapChildIds)
  }
}
