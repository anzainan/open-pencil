import { describe, expect, test } from 'bun:test'

import { computeAllLayouts } from '@open-pencil/core'
import { appendPostComputeWarnings } from '@open-pencil/core/tools'

import { expectDefined } from '#tests/helpers/assert'
import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

describe('delete_node', () => {
  test('removes a node', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()

    const tool = getTool('delete_node')
    tool.execute(figma, { id: rect.id })

    expect(figma.getNodeById(rect.id)).toBeNull()
  })
})

describe('clone_node', () => {
  test('duplicates a node', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    rect.name = 'Original'
    rect.resize(100, 100)

    const tool = getTool('clone_node')
    const result = tool.execute(figma, { id: rect.id }) as ToolResult

    expect(result.id).not.toBe(rect.id)
    expect(result.name).toBe('Original')
  })
})

describe('rename_node', () => {
  test('renames a node', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()

    const tool = getTool('rename_node')
    tool.execute(figma, { id: rect.id, name: 'My Rectangle' })

    expect(expectDefined(figma.getNodeById(rect.id), 'renamed rectangle').name).toBe('My Rectangle')
  })
})

describe('reparent_node', () => {
  test('moves node into frame', () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(300, 300)
    const rect = figma.createRectangle()
    rect.resize(50, 50)

    const tool = getTool('reparent_node')
    tool.execute(figma, { id: rect.id, parent_id: frame.id })

    expect(
      expectDefined(figma.getNodeById(frame.id), 'target frame').children.some(
        (c) => c.id === rect.id
      )
    ).toBe(true)
  })
})

describe('group_nodes', () => {
  test('groups two nodes', () => {
    const { figma } = setupToolTest()
    const r1 = figma.createRectangle()
    r1.resize(50, 50)
    const r2 = figma.createRectangle()
    r2.resize(50, 50)

    const tool = getTool('group_nodes')
    const result = tool.execute(figma, { ids: [r1.id, r2.id] }) as ToolResult

    expect(result.type).toBe('GROUP')
    const group = expectDefined(
      figma.getNodeById(expectDefined(result.id, 'group id')),
      'created group'
    )
    expect(group.children.length).toBe(2)
  })
})

describe('node_resize', () => {
  test('resizes a plain node without warnings', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    rect.resize(100, 100)

    const tool = getTool('node_resize')
    const result = tool.execute(figma, { id: rect.id, width: 250, height: 120 }) as ToolResult

    expect(result.warnings).toBeUndefined()
    expect(expectDefined(figma.getNodeById(rect.id), 'resized node').width).toBe(250)
    expect(expectDefined(figma.getNodeById(rect.id), 'resized node').height).toBe(120)
  })
})

describe('appendPostComputeWarnings (post-layout fake-success guard)', () => {
  test('flags resize overwritten by flex HUG layout', () => {
    const { graph, figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(320, 100)

    const setLayout = getTool('set_layout')
    setLayout.execute(figma, { id: frame.id, direction: 'VERTICAL', spacing: 8, padding: 16 })
    for (let i = 0; i < 3; i++) {
      const child = figma.createRectangle()
      child.resize(100, 40)
      frame.appendChild(child)
    }

    // 模拟 app 包装层：resize → computeAllLayouts → 回读 diff 校验。
    computeAllLayouts(graph)
    const requested = { id: frame.id, width: 1280, height: 800 }
    const verified = appendPostComputeWarnings(
      figma,
      'node_resize',
      requested,
      requested
    ) as ToolResult

    expect(Array.isArray(verified.warnings)).toBe(true)
    const warning = (verified.warnings as string[])[0]
    expect(warning).toMatch(/flex HUG/)
    expect(warning).toMatch(/width=/)
  })

  test('does not warn when resize is honored', () => {
    const { graph, figma } = setupToolTest()
    const rect = figma.createRectangle()
    rect.resize(100, 100)

    // 模拟 app 包装层顺序：node_resize 先写入 → computeAllLayouts 不覆盖固定尺寸。
    const resize = getTool('node_resize')
    resize.execute(figma, { id: rect.id, width: 200, height: 150 })
    computeAllLayouts(graph)

    const requested = { id: rect.id, width: 200, height: 150 }
    const verified = appendPostComputeWarnings(
      figma,
      'node_resize',
      requested,
      requested
    ) as ToolResult

    expect(verified.warnings).toBeUndefined()
  })

  test('skips pure error results', () => {
    const { figma } = setupToolTest()
    const verified = appendPostComputeWarnings(figma, 'node_resize', { id: 'x', width: 10, height: 10 }, {
      error: 'boom'
    }) as ToolResult
    expect(verified.warnings).toBeUndefined()
  })
})

describe('batch_update', () => {
  test('applies whitelisted props', () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(300, 200)

    const tool = getTool('batch_update')
    const result = tool.execute(figma, {
      operations: JSON.stringify([{ id: frame.id, props: { spacing: 12, padding: 20 } }])
    }) as ToolResult

    expect(result.updated).toBe(1)
    expect(result.warnings).toBeUndefined()
    const node = expectDefined(figma.getNodeById(frame.id), 'batched frame')
    expect(node.itemSpacing).toBe(12)
    expect(node.paddingLeft).toBe(20)
  })

  test('reports unsupported props in warnings instead of silent updated:0', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    rect.resize(100, 100)

    const tool = getTool('batch_update')
    const result = tool.execute(figma, {
      operations: JSON.stringify([{ id: rect.id, props: { flex: 'row', gap: 24 } }])
    }) as ToolResult

    expect(result.updated).toBe(0)
    const warnings = result.warnings as string[]
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/flex/)
    expect(warnings[0]).toMatch(/gap/)
    expect(warnings[0]).toMatch(/batch_update/)
  })

  test('warns when an operation matches no props', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()

    const tool = getTool('batch_update')
    const result = tool.execute(figma, {
      operations: JSON.stringify([{ id: rect.id, props: { bogus_prop: 1 } }])
    }) as ToolResult

    expect(result.updated).toBe(0)
    expect((result.warnings as string[])[0]).toMatch(/bogus_prop/)
  })
})
