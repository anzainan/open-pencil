import { describe, expect, test } from 'bun:test'

import type { Effect } from '@open-pencil/scene-graph'

import { formatColor, formatShadow } from '#core/io/formats/jsx/helpers'

// [custom] alpha-fix: JSX export projection must use color.a × opacity (like canvas/SVG).

describe('JSX formatColor alpha projection', () => {
  test('uses color.a × opacity for 8-digit hex fills', () => {
    const color = { r: 0.086, g: 0.176, b: 0.314, a: 0.6 }

    expect(formatColor(color, 1)).toBe('#162D5099')
  })

  test('keeps opaque color × opacity < 1', () => {
    const color = { r: 1, g: 0, b: 0, a: 1 }

    expect(formatColor(color, 0.5)).toBe('#FF000080')
  })

  test('keeps 6-digit hex for opaque colors', () => {
    const color = { r: 0.18, g: 0.525, b: 0.871, a: 1 }

    expect(formatColor(color, 1)).toBe('#2E86DE')
  })

  test('formatShadow keeps shadow alpha = color.a (opacity passed as 1)', () => {
    const shadow = {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL'
    } as Effect

    expect(formatShadow(shadow)).toBe('0 4 8 #00000080')
  })
})
