import { describe, expect, mock, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import type { Fill, SceneNode, Stroke } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { applyFill, paintFills } from '#core/canvas/fills'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { configureStrokePaint } from '#core/canvas/strokes'

// [custom] alpha-fix: renderer compositing must use color.a × opacity for SOLID fills/strokes
// (CanvasKit setAlphaf overwrites color.a rather than multiplying, so the bake must happen at
// setColor / setAlphaf time and must never be left to a later overwrite).

function createRenderer() {
  return {
    fillPaint: {
      setShader: mock(() => undefined),
      setColor: mock(() => undefined),
      setAlphaf: mock(() => undefined),
      setBlendMode: mock(() => undefined)
    },
    strokePaint: {
      setColor: mock(() => undefined),
      setStrokeWidth: mock(() => undefined),
      setAlphaf: mock(() => undefined),
      setStrokeCap: mock(() => undefined),
      setStrokeJoin: mock(() => undefined),
      setStrokeMiter: mock(() => undefined)
    },
    ck: {
      BlendMode: { SrcOver: 'source-over' },
      Color4f: mock((r, g, b, a) => ['color', r, g, b, a]),
      StrokeCap: { Butt: 'butt', Round: 'round', Square: 'square' },
      StrokeJoin: { Bevel: 'bevel', Miter: 'miter', Round: 'round' }
    },
    applyFill: mock(() => true),
    resolveFillColor: mock((fill: Fill) => fill.color),
    resolveStrokeColor: mock((stroke: Stroke) => stroke.color)
  } as SkiaRenderer
}

const node = { id: '1:2', source: { id: '' }, width: 100, height: 100 } as SceneNode

describe('SOLID fill alpha compositing', () => {
  test('bakes color.a × opacity into setColor for 8-digit hex (color.a 0.5, opacity 1)', () => {
    const renderer = createRenderer()
    const fill: Fill = {
      type: 'SOLID',
      color: { r: 0.2, g: 0.3, b: 0.4, a: 0.5 },
      opacity: 1,
      visible: true
    }

    expect(applyFill(renderer, fill, node, new SceneGraph())).toBe(true)
    expect(renderer.fillPaint.setColor).toHaveBeenCalledWith(['color', 0.2, 0.3, 0.4, 0.5])
  })

  test('bakes opaque color × opacity < 1 (color.a 1, opacity 0.6)', () => {
    const renderer = createRenderer()
    const fill: Fill = {
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: 0.6,
      visible: true
    }

    expect(applyFill(renderer, fill, node, new SceneGraph())).toBe(true)
    expect(renderer.fillPaint.setColor).toHaveBeenCalledWith(['color', 1, 0, 0, 0.6])
  })

  test('paintFills does not call setAlphaf for SOLID fills', () => {
    const renderer = createRenderer()
    const draw = mock(() => undefined)
    const fill: Fill = {
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0, a: 0.5 },
      opacity: 1,
      visible: true
    }

    paintFills(renderer, [fill], node, new SceneGraph(), draw)

    expect(renderer.fillPaint.setAlphaf).not.toHaveBeenCalled()
    expect(draw).toHaveBeenCalledTimes(1)
  })

  test('paintFills keeps setAlphaf(opacity) for gradient fills (unchanged alpha path)', () => {
    const renderer = createRenderer()
    const draw = mock(() => undefined)
    const fill = {
      type: 'GRADIENT_LINEAR',
      opacity: 0.5,
      visible: true
    } as Fill

    paintFills(renderer, [fill], node, new SceneGraph(), draw)

    expect(renderer.fillPaint.setAlphaf).toHaveBeenCalledWith(0.5)
    expect(draw).toHaveBeenCalledTimes(1)
  })
})

describe('SOLID stroke alpha compositing', () => {
  test('uses color.a × opacity for 8-digit hex stroke (color.a 0.5, opacity 1)', () => {
    const renderer = createRenderer()
    const color: Color = { r: 0.2, g: 0.3, b: 0.4, a: 0.5 }
    const stroke = {
      color,
      opacity: 1,
      visible: true,
      weight: 2
    } as Stroke

    configureStrokePaint(renderer, node, stroke, color)

    expect(renderer.strokePaint.setColor).toHaveBeenCalledWith(['color', 0.2, 0.3, 0.4, 0.5])
    expect(renderer.strokePaint.setAlphaf).toHaveBeenCalledWith(0.5)
  })

  test('uses opaque color × opacity < 1 (color.a 1, opacity 0.6)', () => {
    const renderer = createRenderer()
    const color: Color = { r: 1, g: 0, b: 0, a: 1 }
    const stroke = {
      color,
      opacity: 0.6,
      visible: true,
      weight: 2
    } as Stroke

    configureStrokePaint(renderer, node, stroke, color)

    expect(renderer.strokePaint.setColor).toHaveBeenCalledWith(['color', 1, 0, 0, 1])
    expect(renderer.strokePaint.setAlphaf).toHaveBeenCalledWith(0.6)
  })
})
