import type { Editor, EditorState } from '@open-pencil/core/editor'

type ReloadViewport = {
  panX: number
  panY: number
  zoom: number
}

export type ReloadStateSnapshot = {
  viewport: ReloadViewport
  pageId: string
}

export function captureReloadState(state: EditorState): ReloadStateSnapshot {
  return {
    viewport: { panX: state.panX, panY: state.panY, zoom: state.zoom },
    pageId: state.currentPageId
  }
}

export function restoreReloadState(
  editor: Editor,
  state: EditorState,
  snapshot: ReloadStateSnapshot
) {
  editor.clearSelection()
  // 只有快照页仍是真实 PAGE（CANVAS）才恢复指针，否则回退第一个页面，
  // 防止重建后 currentPageId 指向非 PAGE 节点（P0-3）。
  const snapNode = editor.graph.getNode(snapshot.pageId)
  if (snapNode?.type === 'CANVAS') {
    state.currentPageId = snapshot.pageId
  } else {
    state.currentPageId = editor.graph.getPages()[0]?.id ?? editor.graph.rootId
  }
  state.panX = snapshot.viewport.panX
  state.panY = snapshot.viewport.panY
  state.zoom = snapshot.viewport.zoom
}
