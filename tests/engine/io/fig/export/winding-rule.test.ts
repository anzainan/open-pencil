import { describe, expect, test } from 'bun:test'

import { deflateSync } from 'fflate'

import { exportFigFile, parseFigFile, SceneGraph } from '@open-pencil/core'
import { encodePathCommandsBlob } from '@open-pencil/fig/node-change'
import { getSchemaBytes } from '@open-pencil/kiwi/fig/codec'
import {
  ByteBuffer,
  decodeBinarySchema,
  encodeBinarySchema
} from '@open-pencil/kiwi/schema-runtime'

import { expectDefined } from '#tests/helpers/assert'

const triangleBlob = encodePathCommandsBlob([
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 10, y: 0 },
  { type: 'L', x: 0, y: 10 },
  { type: 'Z' }
])

/**
 * Builds a deflated embedded kiwi schema equivalent to one written by a
 * pre-rename build: a full schema whose `WindingRule` enum names value 1 `ODD`
 * instead of `EVENODD`.
 */
function legacyOddSchemaDeflated(): Uint8Array {
  const schema = decodeBinarySchema(new ByteBuffer(getSchemaBytes()))
  const windingRule = expectDefined(
    schema.definitions.find(
      (definition) => definition.kind === 'ENUM' && definition.name === 'WindingRule'
    ),
    'WindingRule enum in embedded schema'
  )
  const evenOdd = expectDefined(
    windingRule.fields.find((field) => field.name === 'EVENODD'),
    'EVENODD member'
  )
  evenOdd.name = 'ODD'
  return deflateSync(encodeBinarySchema(schema))
}

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

  test('saves EVENODD into a file whose embedded schema still names ODD', async () => {
    const legacySchema = legacyOddSchemaDeflated()
    const graph = new SceneGraph()
    graph.figSchemaDeflated = legacySchema
    const page = graph.getPages()[0]
    graph.createNode('VECTOR', page.id, {
      name: 'LegacyEvenOddVector',
      width: 10,
      height: 10,
      fillGeometry: [{ windingRule: 'EVENODD', commandsBlob: triangleBlob }]
    })

    const zip = await exportFigFile(graph)
    const restored = await parseFigFile(zip.buffer as ArrayBuffer)

    const restoredVector = expectDefined(
      [...restored.getAllNodes()].find((node) => node.name === 'LegacyEvenOddVector'),
      'restored legacy evenodd vector node'
    )
    expect(restoredVector.fillGeometry[0]?.windingRule).toBe('EVENODD')
    expect(restoredVector.fillGeometry[0]?.commandsBlob).toEqual(triangleBlob)
    expect(restored.figSchemaDeflated).toEqual(legacySchema)
  })
})
