import { describe, expect, test } from 'bun:test'

import type { Fill, SceneNode } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { resolveCaretColor } from '#core/canvas/overlays/text-edit'
import { BLACK, CANVAS_BG_COLOR } from '#core/constants'

function node(type: SceneNode['type'], fills: Fill[]): SceneNode {
  return { id: 'test', type, fills } as SceneNode
}

describe('resolveCaretColor (④ caret contrast against background)', () => {
  test('TEXT node on a dark page gets a light caret (fills are glyphs, not background)', () => {
    const text = node('TEXT', [
      { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }
    ])
    const darkPage: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 }
    expect(resolveCaretColor(text, darkPage)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  test('TEXT node on a light page keeps the default black caret', () => {
    const text = node('TEXT', [
      { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
    ])
    expect(resolveCaretColor(text, CANVAS_BG_COLOR)).toEqual(BLACK)
  })

  test('non-TEXT node with a dark solid fill gets a light caret', () => {
    const rect = node('RECTANGLE', [
      { type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05, a: 1 }, opacity: 1, visible: true }
    ])
    expect(resolveCaretColor(rect, CANVAS_BG_COLOR)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  test('non-TEXT node with a light solid fill keeps the default black caret', () => {
    const rect = node('RECTANGLE', [
      { type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95, a: 1 }, opacity: 1, visible: true }
    ])
    expect(resolveCaretColor(rect, CANVAS_BG_COLOR)).toEqual(BLACK)
  })

  test('node without a visible fill falls back to the page background', () => {
    const frame = node('FRAME', [])
    const darkPage: Color = { r: 0.2, g: 0.2, b: 0.2, a: 1 }
    expect(resolveCaretColor(frame, darkPage)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(resolveCaretColor(frame, CANVAS_BG_COLOR)).toEqual(BLACK)
  })

  test('TEXT caret follows the text color: red text → red caret', () => {
    const text = node('TEXT', [
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
    ])
    expect(resolveCaretColor(text, CANVAS_BG_COLOR)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  test('TEXT caret follows the text color: white text → white caret even on a light page', () => {
    const text = node('TEXT', [
      { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }
    ])
    expect(resolveCaretColor(text, CANVAS_BG_COLOR)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  test('TEXT caret follows the text color: black text → black caret on a dark page', () => {
    const text = node('TEXT', [
      { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
    ])
    const darkPage: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 }
    expect(resolveCaretColor(text, darkPage)).toEqual(BLACK)
  })

  test('TEXT without a solid fill falls back to the page-background luminance', () => {
    const emptyText = node('TEXT', [])
    const gradientText = node('TEXT', [
      {
        type: 'GRADIENT_LINEAR',
        color: { r: 1, g: 1, b: 1, a: 1 },
        gradientStops: [
          { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }
        ],
        gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: 1,
        visible: true
      }
    ])
    const darkPage: Color = { r: 0.2, g: 0.2, b: 0.2, a: 1 }
    expect(resolveCaretColor(emptyText, darkPage)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(resolveCaretColor(emptyText, CANVAS_BG_COLOR)).toEqual(BLACK)
    expect(resolveCaretColor(gradientText, darkPage)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(resolveCaretColor(gradientText, CANVAS_BG_COLOR)).toEqual(BLACK)
  })
})
