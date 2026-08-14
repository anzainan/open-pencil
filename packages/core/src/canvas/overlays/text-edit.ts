import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { TEXT_CARET_COLOR, TEXT_CARET_WIDTH, TEXT_SELECTION_COLOR } from '#core/constants'
import type { TextEditor } from '#core/text/editor'

const CARET_LIGHT_COLOR: Color = { r: 1, g: 1, b: 1, a: 1 }
const CARET_DARK_BG_LUMINANCE_THRESHOLD = 0.5

function colorLuminance(color: Color): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

/**
 * Picks a caret color that stays visible against the text node's effective
 * background. TEXT node fills are glyph colors, not a background, so the page
 * background governs; for other nodes a visible solid fill is treated as the
 * caret's backdrop. Dark backgrounds get a light caret, light backgrounds keep
 * the default `TEXT_CARET_COLOR` black.
 */
export function resolveCaretColor(node: SceneNode, pageColor: Color): Color {
  const hasSolidBackground =
    node.type !== 'TEXT' &&
    node.fills.length > 0 &&
    node.fills[0].type === 'SOLID' &&
    node.fills[0].visible &&
    node.fills[0].opacity > 0 &&
    node.fills[0].color.a > 0
  const background = hasSolidBackground ? node.fills[0].color : pageColor
  return colorLuminance(background) < CARET_DARK_BG_LUMINANCE_THRESHOLD
    ? CARET_LIGHT_COLOR
    : TEXT_CARET_COLOR
}

export function drawTextEditOverlay(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  editor: TextEditor
): void {
  r.auxStroke.setStrokeWidth(1 / r.zoom)
  r.auxStroke.setColor(r.selColor())
  r.auxStroke.setPathEffect(null)
  canvas.drawRect(r.ck.LTRBRect(0, 0, node.width, node.height), r.auxStroke)

  const selRects = editor.getSelectionRects()
  if (selRects.length > 0) {
    r.auxFill.setColor(
      r.ck.Color4f(
        TEXT_SELECTION_COLOR.r,
        TEXT_SELECTION_COLOR.g,
        TEXT_SELECTION_COLOR.b,
        TEXT_SELECTION_COLOR.a
      )
    )
    for (const sel of selRects) {
      canvas.drawRect(r.ck.LTRBRect(sel.x, sel.y, sel.x + sel.width, sel.y + sel.height), r.auxFill)
    }
  }

  if (editor.caretVisible && !editor.hasSelection()) {
    const caret = editor.getCaretRect()
    if (caret) {
      const caretColor = resolveCaretColor(node, r.pageColor)
      r.auxFill.setColor(
        r.ck.Color4f(caretColor.r, caretColor.g, caretColor.b, caretColor.a)
      )
      const w = TEXT_CARET_WIDTH / r.zoom
      canvas.drawRect(
        r.ck.LTRBRect(caret.x - w / 2, caret.y0, caret.x + w / 2, caret.y1),
        r.auxFill
      )
    }
  }
}
