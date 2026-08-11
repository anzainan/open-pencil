import { describe, expect, test } from 'bun:test'

import type { Fill } from '@open-pencil/core'
import { applySolidFillColor, applySolidStrokeColor } from '@open-pencil/vue'

describe('solid color commit helpers', () => {
  test('keeps fill opacity untouched when alpha changes', () => {
    const fill: Fill = {
      type: 'SOLID',
      visible: true,
      opacity: 1,
      color: { r: 1, g: 0, b: 0, a: 1 }
    }

    const updated = applySolidFillColor(fill, { r: 0, g: 1, b: 0, a: 0.4 })
    expect(updated.color.a).toBeCloseTo(0.4, 5)
    // [custom] alpha-fix: opacity stays an independent multiplier — alpha is color.a only
    expect(updated.opacity).toBeCloseTo(1, 5)
  })

  test('keeps stroke opacity untouched when alpha changes', () => {
    const updated = applySolidStrokeColor({ r: 1, g: 1, b: 0, a: 0.2 })
    expect(updated.color?.a).toBeCloseTo(0.2, 5)
    // [custom] alpha-fix: stroke opacity is not written (fill.opacity stays as-is)
    expect(updated.opacity).toBeUndefined()
  })
})
