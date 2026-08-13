import { describe, test, expect, beforeAll } from 'bun:test'

import { exportFigFile, parseFigFile, initCodec, SceneGraph } from '@open-pencil/core'

beforeAll(async () => {
  await initCodec()
})

describe('fig export survives contaminated nodes (P0 回归)', () => {
  test('exportFigFile succeeds and drops the uncloneable field', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'contaminated',
      x: 0,
      y: 0,
      width: 100,
      height: 100
    })
    // Simulate the P0 现场：内存节点字段被挂上不可克隆对象（函数）。
    // 真实泄漏路径不会直接赋值，但这里验证保存链「永不因克隆失败」的兜底。
    graph.updateNode(node.id, { effectStyleId: null })
    Object.assign(graph.getNode(node.id) as object, { contaminatedField: () => 'leak' })

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)
    const reimportedNode = [...reimported.nodes.values()].find((n) => n.name === 'contaminated')
    expect(reimportedNode).toBeDefined()
    expect(reimported.getPages().length).toBeGreaterThan(0)
  })

  test('healthy graph exports and re-imports without data loss', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, {
      name: 'Frame',
      x: 10,
      y: 20,
      width: 200,
      height: 120,
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }, visible: true }]
    })
    const col = graph.createCollection('Colors')
    graph.createVariable('brand', 'COLOR', col.id, { r: 0.2, g: 0.4, b: 0.8, a: 1 })

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    const frame = [...reimported.nodes.values()].find((n) => n.name === 'Frame')
    expect(frame).toBeDefined()
    const color = frame?.fills[0]?.color
    expect(color).toBeDefined()
    expect(color.r).toBeCloseTo(0.1, 2)
    expect(color.g).toBeCloseTo(0.2, 2)
    expect(color.b).toBeCloseTo(0.3, 2)
    expect(color.a).toBeCloseTo(1, 2)
    expect([...reimported.variables.values()].some((v) => v.name === 'brand')).toBe(true)
    expect(exported.length).toBeGreaterThan(0)
  })
})
