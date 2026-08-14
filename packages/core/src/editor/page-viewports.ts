import type { Color } from '@open-pencil/scene-graph/primitives'

import { CANVAS_BG_COLOR } from '#core/constants'
import { getPageBackgrounds } from '#core/figma-api/page-backgrounds'

import type { EditorContext } from './types'

interface PageViewport {
  panX: number
  panY: number
  zoom: number
  pageColor: Color
}

export function createPageViewportStore(ctx: EditorContext) {
  const pageViewports = new Map<string, PageViewport>()

  function saveCurrentPageViewport() {
    pageViewports.set(ctx.state.currentPageId, {
      panX: ctx.state.panX,
      panY: ctx.state.panY,
      zoom: ctx.state.zoom,
      pageColor: { ...ctx.state.pageColor }
    })
  }

  function resolvePageBackgroundColor(pageId: string): Color {
    const page = ctx.graph.getNode(pageId)
    if (page?.type === 'CANVAS') {
      const background = getPageBackgrounds(page).find((fill) => fill.type === 'SOLID')
      if (background) return { ...background.color }
    }
    return { ...CANVAS_BG_COLOR }
  }

  function restorePageViewport(pageId: string) {
    const viewport = pageViewports.get(pageId)
    if (viewport) {
      ctx.state.panX = viewport.panX
      ctx.state.panY = viewport.panY
      ctx.state.zoom = viewport.zoom
    } else {
      ctx.state.panX = 0
      ctx.state.panY = 0
      ctx.state.zoom = 1
    }
    ctx.state.pageColor = resolvePageBackgroundColor(pageId)
  }

  function deletePageViewport(pageId: string) {
    pageViewports.delete(pageId)
  }

  function clearPageViewports() {
    pageViewports.clear()
  }

  return { saveCurrentPageViewport, restorePageViewport, deletePageViewport, clearPageViewports }
}
