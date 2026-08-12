import { describe, expect, test } from 'bun:test'

import { computeAllLayouts, SceneGraph, setTextMeasurer } from '@open-pencil/core'

import { autoFrame, pageId } from '#tests/helpers/layout'

/**
 * Headless text sizing regression tests (no CanvasKit measurer).
 *
 * These cover the sentinel bug where JSX that sets an explicit width
 * (`w={28}`, `w={250}`) left the default height (100) in place, so
 * `hasStoredSize` misread it as a real stored size and the headless
 * fallback estimator was never reached.
 */
describe('headless text layout without measurer', () => {
  test('fixed-width single-line text with lineHeight gets lineHeight, not default 100', () => {
    const graph = new SceneGraph()
    const pid = pageId(graph)

    const frame = autoFrame(graph, pid, {
      width: 300,
      height: 60,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      paddingLeft: 12,
      paddingRight: 12
    })

    graph.createNode('TEXT', frame.id, {
      width: 28,
      height: 100,
      text: '标题',
      fontSize: 14,
      lineHeight: 17,
      textAutoResize: 'HEIGHT' as const
    })

    setTextMeasurer(null)
    computeAllLayouts(graph)
    const children = graph.getChildren(frame.id)
    const text = children[0]
    expect(text.width).toBe(28)
    expect(text.height).toBe(17)
  })

  test('fixed-width text with long content wraps via estimate, not default 100', () => {
    const graph = new SceneGraph()
    const pid = pageId(graph)

    const frame = autoFrame(graph, pid, {
      width: 300,
      height: 200,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      paddingLeft: 12,
      paddingRight: 12
    })

    graph.createNode('TEXT', frame.id, {
      width: 250,
      height: 100,
      text: '这是一段很长的中文内容，宽度受限于二百五十像素之后必须自动换行才能完整展示出来。',
      fontSize: 14,
      lineHeight: 20,
      textAutoResize: 'HEIGHT' as const
    })

    setTextMeasurer(null)
    computeAllLayouts(graph)
    const children = graph.getChildren(frame.id)
    const text = children[0]
    expect(text.width).toBe(250)
    expect(text.height).toBeGreaterThan(20)
    expect(text.height).not.toBe(100)
  })

  test('HUG text (no width) still measures normally', () => {
    const graph = new SceneGraph()
    const pid = pageId(graph)

    const frame = autoFrame(graph, pid, {
      width: 300,
      height: 60,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      paddingLeft: 12,
      paddingRight: 12
    })

    graph.createNode('TEXT', frame.id, {
      width: 100,
      height: 100,
      text: '测试',
      fontSize: 14,
      textAutoResize: 'WIDTH_AND_HEIGHT' as const
    })

    setTextMeasurer(null)
    computeAllLayouts(graph)
    const children = graph.getChildren(frame.id)
    const text = children[0]
    expect(text.width).toBeLessThan(100)
    expect(text.height).toBeLessThan(100)
    expect(text.height).toBeGreaterThan(0)
  })

  test('WIDTH_AND_HEIGHT text keeps imported stored size from .fig', () => {
    const graph = new SceneGraph()
    const pid = pageId(graph)

    const frame = autoFrame(graph, pid, {
      width: 300,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER'
    })

    graph.createNode('TEXT', frame.id, {
      width: 200,
      height: 20,
      text: 'Test',
      fontSize: 14,
      textAutoResize: 'WIDTH_AND_HEIGHT' as const
    })

    setTextMeasurer(null)
    computeAllLayouts(graph)
    const children = graph.getChildren(frame.id)
    const text = children[0]
    expect(text.width).toBe(200)
    expect(text.height).toBe(20)
  })
})
