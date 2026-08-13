import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'
import { executeRPCCommand } from '@open-pencil/core/rpc'

interface DescribeNode {
  id: string
  name: string
  type: string
  role?: string
  size?: string
  visual?: string
  layout?: string
  issues?: Array<{ severity?: string; message: string }>
  children?: DescribeNode[]
}

function buildGraph(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    name: 'Card',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16
  })
  graph.createNode('TEXT', frame.id, {
    name: 'Title',
    text: 'Hello',
    fontSize: 24,
    fontFamily: 'Inter',
    fontWeight: 700,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  graph.createNode('RECTANGLE', frame.id, {
    name: 'Submit',
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 0.25, g: 0.46, b: 0.98, a: 1 }, opacity: 1, visible: true }],
    cornerRadius: 8
  })
  return graph
}

describe('RPC describe command (pure core, shared with MCP tool)', () => {
  test('describes a page into role/size/visual/layout + children', () => {
    const graph = buildGraph()
    const result = executeRPCCommand(graph, 'describe', {}) as {
      page: { id: string; name: string }
      nodes: DescribeNode[]
    }
    expect(result.page.name).toBe('Page 1')
    expect(result.nodes).toHaveLength(1)
    const card = result.nodes[0]
    expect(card.name).toBe('Card')
    expect(card.type).toBe('FRAME')
    expect(card.role).toBeDefined()
    expect(card.size).toBe('320×180')
    expect(card.visual.toLowerCase()).toContain('#ffffff')
    expect(card.layout).toContain('vertical')
    expect(card.children).toHaveLength(2)
    const names = (card.children ?? []).map((c) => c.name).sort()
    expect(names).toEqual(['Submit', 'Title'])
  })

  test('describe by node id matches the page-level entry', () => {
    const graph = buildGraph()
    const frameId = [...graph.getAllNodes()].find((n) => n.name === 'Card')?.id
    expect(frameId).toBeDefined()
    const single = executeRPCCommand(graph, 'describe', { id: frameId }) as {
      nodes: DescribeNode[]
    }
    expect(single.nodes).toHaveLength(1)
    expect(single.nodes[0].name).toBe('Card')
  })

  test('returns error for unknown page', () => {
    const graph = buildGraph()
    const result = executeRPCCommand(graph, 'describe', { page: 'Nope' }) as { error?: string }
    expect(result.error).toContain('not found')
  })
})
