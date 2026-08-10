import type { Editor } from '@open-pencil/core/editor'

export function createFlashActions(editor: Editor) {
  let flashRafId = 0

  function pumpFlashes() {
    if (!editor.renderer?.hasActiveFlashes) {
      flashRafId = 0
      return
    }
    // 渲染循环是纯事件驱动（只订阅 render:requested / viewport:changed /
    // repaint:requested / selection:changed），仅 renderVersion++ 不派发事件，
    // 动画不会重绘。requestRepaint() = renderVersion++ + emit repaint:requested，
    // pumpFlashes 每帧都会让 render-loop 调度重绘，flash 动画（900ms）得以播放。
    editor.requestRepaint()
    flashRafId = requestAnimationFrame(pumpFlashes)
  }

  function flashNodes(nodeIds: string[]) {
    const renderer = editor.renderer
    if (!renderer) return
    for (const id of nodeIds) renderer.flashNode(id)
    if (!flashRafId) pumpFlashes()
  }

  function aiMarkActive(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiMarkActive(nodeIds)
    if (!flashRafId) pumpFlashes()
  }

  function aiMarkDone(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiMarkDone(nodeIds)
    if (!flashRafId) pumpFlashes()
  }

  function aiFlashDone(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiFlashDone(nodeIds)
    if (!flashRafId) pumpFlashes()
  }

  function aiClearAll() {
    editor.renderer?.aiClearAll()
  }

  return {
    flashNodes,
    aiMarkActive,
    aiMarkDone,
    aiFlashDone,
    aiClearAll
  }
}
