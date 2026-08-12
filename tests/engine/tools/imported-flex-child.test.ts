import { describe, expect, test } from 'bun:test'

import { computeAllLayouts, exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'
import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

/**
 * B3 工具语义收口（ARCH-flex-store-vs-layout §8）：
 * 导入来源（source.fig）的 flex 子节点上 node_move / set_layout_child 只改活体字段，
 * 落盘序列化仍读 source 快照（rawTransform / figLayout）→ 返回 warning 避免误导性成功。
 * 非导入节点保持「改活体 → 落盘」行为。
 */

/** 给 flex 容器加一个 fig 导入来源的 RECTANGLE 子节点（rawTransform 携带陈旧坐标）。 */
function addImportedChild(figma: ReturnType<typeof setupToolTest>['figma']) {
  const child = figma.createRectangle()
  child.resize(14, 14)
  const raw = figma.graph.getNode(child.id)
  if (!raw) throw new Error('child not found')
  figma.graph.updateNode(child.id, {
    source: {
      ...raw.source,
      format: 'fig',
      editedFields: [],
      fig: {
        ...raw.source.fig,
        rawTransform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 9 }
      }
    }
  })
  return child
}

describe('node_move on flex children', () => {
  test('non-imported flex child: move persists through save/reload', async () => {
    await initCodec()
    const { graph, figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(296, 32)
    graph.updateNode(frame.id, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER'
    })
    const child = figma.createRectangle()
    child.resize(14, 14)
    frame.appendChild(child)
    computeAllLayouts(graph)

    getTool('node_move').execute(figma, { id: child.id, x: 100, y: 50 })
    computeAllLayouts(graph)

    const liveX = expectDefined(graph.getNode(child.id), 'moved child').x

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(
      exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)
    )
    const rChild = expectDefined(
      reimported.getAllNodes().find((n) => n.name === child.name),
      'reimported child'
    )
    // 保存读活体 node.x（非导入节点无 source 快照分叉）→ 磁盘 == 活体。
    expect(Math.abs(rChild.x - liveX)).toBeLessThan(0.001)
  })

  test('imported flex child: warns that the move is memory-only', async () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(296, 32)
    const child = addImportedChild(figma)

    const result = getTool('node_move').execute(figma, {
      id: child.id,
      x: 100,
      y: 50
    }) as ToolResult

    expect(Array.isArray(result.warnings)).toBe(true)
    const warning = (result.warnings as string[])[0]
    expect(warning).toContain('仅内存生效')
    expect(warning).toContain('导入来源')
  })
})

describe('set_layout_child(ABSOLUTE) on flex children', () => {
  test('non-imported flex child: stackPositioning=ABSOLUTE persists through save/reload', async () => {
    await initCodec()
    const { graph, figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(296, 32)
    graph.updateNode(frame.id, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER'
    })
    const child = figma.createRectangle()
    child.resize(14, 14)
    frame.appendChild(child)
    computeAllLayouts(graph)

    getTool('set_layout_child').execute(figma, { id: child.id, positioning: 'ABSOLUTE' })
    computeAllLayouts(graph)

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(
      exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)
    )
    const rChild = expectDefined(
      reimported.getAllNodes().find((n) => n.name === child.name),
      'reimported child'
    )
    expect(rChild.layoutPositioning).toBe('ABSOLUTE')
  })

  test('imported flex child: warns that layoutPositioning is memory-only', async () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(296, 32)
    const child = addImportedChild(figma)

    const result = getTool('set_layout_child').execute(figma, {
      id: child.id,
      positioning: 'ABSOLUTE'
    }) as ToolResult

    expect(Array.isArray(result.warnings)).toBe(true)
    const warning = (result.warnings as string[])[0]
    expect(warning).toContain('仅内存生效')
    expect(warning).toContain('落盘仍读源快照')
  })
})
