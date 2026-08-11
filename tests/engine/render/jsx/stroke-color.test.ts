import { describe, expect, it } from 'bun:test'

import { renderJSX } from '@open-pencil/core'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'
import { makeSceneGraph } from '#tests/helpers/scene'

describe('8-digit hex colors in JSX props', () => {
  it('applies stroke alpha exactly once (color.a only, opacity 1)', async () => {
    const g = makeSceneGraph()
    const [result] = await renderJSX(
      g,
      `<Rectangle name="Faded" stroke="#162D5099" strokeWidth={2} />`
    )
    const node = getNodeOrThrow(g, result.id)
    const stroke = expectDefined(node.strokes[0], 'first stroke')

    expect(stroke.opacity).toBe(1)
    expect(stroke.color.a).toBeCloseTo(0.6, 2)
  })

  it('applies fill alpha exactly once (color.a only, opacity 1)', async () => {
    const g = makeSceneGraph()
    const [result] = await renderJSX(g, `<Rectangle name="Faded" bg="#162D5099" />`)
    const node = getNodeOrThrow(g, result.id)
    const fill = expectDefined(node.fills[0], 'first fill')

    expect(fill.opacity).toBe(1)
    expect(fill.color.a).toBeCloseTo(0.6, 2)
  })

  it('keeps 6-digit hex opaque on strokes and fills', async () => {
    const g = makeSceneGraph()
    const [result] = await renderJSX(
      g,
      `<Rectangle name="Solid" bg="#2E86DE" stroke="#2E86DE" strokeWidth={2} />`
    )
    const node = getNodeOrThrow(g, result.id)

    expect(expectDefined(node.fills[0], 'first fill').color.a).toBe(1)
    expect(expectDefined(node.fills[0], 'first fill').opacity).toBe(1)
    expect(expectDefined(node.strokes[0], 'first stroke').color.a).toBe(1)
    expect(expectDefined(node.strokes[0], 'first stroke').opacity).toBe(1)
  })
})
