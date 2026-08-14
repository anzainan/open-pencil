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
 * Picks a caret color for the text node currently being edited.
 * The caret follows the text color itself: a solid first fill on a TEXT node
 * is the glyph color, so the caret reuses it (black text → black caret, white
 * text → white caret, red text → red caret). Without a solid fill (gradient /
 * image / empty) the caret falls back to the page-background luminance logic:
 * dark page → light caret, light page → default `TEXT_CARET_COLOR` black.
 * Non-TEXT nodes keep the visible-solid-fill backdrop behavior.
 */
export function resolveCaretColor(node: SceneNode, pageColor: Color): Color {
  if (node.type === 'TEXT' && node.fills.length > 0) {
    const fill = node.fills[0]
    if (fill.type === 'SOLID' && fill.visible && fill.opacity > 0 && fill.color.a > 0) {
      return { r: fill.color.r, g: fill.color.g, b: fill.color.b, a: 1 }
    }
  }
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
