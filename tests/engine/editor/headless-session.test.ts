import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { HeadlessEditSession } from '@open-pencil/core/editor'

import { expectDefined } from '#tests/helpers/assert'

interface DescribeReport {
  name: string
  type: string
  children: unknown[]
}

beforeAll(async () => {
  await initCodec()
})

describe('HeadlessEditSession (server-side editing, no browser)', () => {
  test('render → describe → save → reopen keeps the built tree', async () => {
    const graph = new SceneGraph()
    const session = new HeadlessEditSession({ graph, filePath: '/tmp/x.fig' })

    const render = await session.applyTool('render', {
      jsx: '<Frame name="Card" w={200} h={100} bg="#FFF"><Text>Hello</Text><Text>World</Text></Frame>'
    })
    expect(render.ok).toBe(true)
    const card = render.result as { id: string; name: string; type: string; children: string[] }
    expect(card.name).toBe('Card')
    expect(card.children.length).toBe(2)

    // describe (same pure-core impl as the MCP tool)
    const describe = await session.applyTool('describe', { id: card.id })
    expect(describe.ok).toBe(true)
    const report = describe.result as DescribeReport
    expect(report.name).toBe('Card')
    expect(report.type).toBe('FRAME')
    expect(report.children).toHaveLength(2)

    // save → reopen → verify full tree survives
    const bytes = await session.exportBytes()
    const reloaded = await parseFigFile(bytes.buffer as ArrayBuffer, { populate: 'all' })
    const reopened = new HeadlessEditSession({ graph: reloaded })
    const reopenedCard = [...reloaded.getAllNodes()].find((n) => n.name === 'Card')
    expectDefined(reopenedCard, 'reopened Card')
    expect(reloaded.getChildren(reopenedCard.id)).toHaveLength(2)
    expect(reopened.pages().length).toBe(1)
  })

  test('undo/redo restores the graph at AI-op granularity', async () => {
    const graph = new SceneGraph()
    const session = new HeadlessEditSession({ graph })

    const before = [...graph.getAllNodes()].length
    const render = await session.applyTool('render', {
      jsx: '<Frame name="F" w={100} h={50} />'
    })
    expect(render.ok).toBe(true)
    expect([...graph.getAllNodes()].length).toBeGreaterThan(before)

    const undo = session.undo()
    expect(undo.ok).toBe(true)
    expect([...graph.getAllNodes()].length).toBe(before)
    expect([...graph.getAllNodes()].some((n) => n.name === 'F')).toBe(false)

    const redo = session.redo()
    expect(redo.ok).toBe(true)
    expect([...graph.getAllNodes()].some((n) => n.name === 'F')).toBe(true)

    expect(session.undo().ok).toBe(true)
    expect(session.undo().ok).toBe(false) // stack empty
  })

  test('batch_update applies multiple ops then layout recomputes', async () => {
    const graph = new SceneGraph()
    const session = new HeadlessEditSession({ graph })
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Root',
      width: 100,
      height: 100,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })

    const batch = await session.applyTool('batch_update', {
      operations: JSON.stringify([
        { id: frame.id, props: { opacity: 0.5, name: 'Root-edited' } }
      ])
    })
    expect(batch.ok).toBe(true)
    expect(graph.getNode(frame.id)?.name).toBe('Root-edited')
    expect(graph.getNode(frame.id)?.opacity).toBe(0.5)
  })

  test('eval runs Figma plugin API JS in-process', async () => {
    const graph = new SceneGraph()
    const session = new HeadlessEditSession({ graph })
    const result = await session.eval(
      'const f = figma.createFrame(); f.name = "EvalFrame"; f.resize(40, 40); return f.name'
    )
    expect(result.ok).toBe(true)
    expect(result.result).toBe('EvalFrame')
    expect([...graph.getAllNodes()].some((n) => n.name === 'EvalFrame')).toBe(true)
  })
})
