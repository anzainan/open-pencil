import { describe, expect, test } from 'bun:test'

import { encodePathCommandsBlob } from '@open-pencil/fig/node-change'
import { exportFigFile, parseFigFile, SceneGraph } from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

const triangleBlob = encodePathCommandsBlob([
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 10, y: 0 },
  { type: 'L', x: 0, y: 10 },
  { type: 'Z' }
])

describe('fig export/import winding rules', () => {
  test('round-trips EVENODD fill geometry winding rule', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('VECTOR', page.id, {
      name: 'EvenOddVector',
      width: 10,
      height: 10,
      fillGeometry: [{ windingRule: 'EVENODD', commandsBlob: triangleBlob }],
      strokeGeometry: [{ windingRule: 'EVENODD', commandsBlob: triangleBlob }]
    })

    const zip = await exportFigFile(graph)
    const restored = await parseFigFile(zip.buffer as ArrayBuffer)

    const restoredVector = expectDefined(
      [...restored.getAllNodes()].find((node) => node.name === 'EvenOddVector'),
      'restored evenodd vector node'
    )
    expect(restoredVector.fillGeometry[0]?.windingRule).toBe('EVENODD')
    expect(restoredVector.fillGeometry[0]?.commandsBlob).toEqual(triangleBlob)
    expect(restoredVector.strokeGeometry[0]?.windingRule).toBe('EVENODD')
  })

  test('round-trips NONZERO fill geometry winding rule as-is', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('VECTOR', page.id, {
      name: 'NonZeroVector',
      width: 10,
      height: 10,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: triangleBlob }]
    })

    const zip = await exportFigFile(graph)
    const restored = await parseFigFile(zip.buffer as ArrayBuffer)

    const restoredVector = expectDefined(
      [...restored.getAllNodes()].find((node) => node.name === 'NonZeroVector'),
      'restored nonzero vector node'
    )
    expect(restoredVector.fillGeometry[0]?.windingRule).toBe('NONZERO')
  })
})
