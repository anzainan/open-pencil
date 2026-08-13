import { describe, expect, test } from 'bun:test'

import {
  createNodeChange,
  createNodeChangesMessage,
  decodeMessage,
  encodeMessage,
  getSchemaBytes,
  initCodec,
  isCodecReady,
  peekMessageType,
  type Color,
  type FigmaMessage,
  type NodeChange
} from '../src/fig/codec'

const red: Color = { r: 1, g: 0, b: 0, a: 1 }

describe('Figma Kiwi codec', () => {
  test('initializes schema and exposes schema bytes', async () => {
    await initCodec()

    expect(isCodecReady()).toBe(true)
    expect(getSchemaBytes().length).toBeGreaterThan(0)
  })

  test('creates normalized node changes', () => {
    const nodeChange = createNodeChange({
      sessionID: 1,
      localID: 2,
      parentSessionID: 1,
      parentLocalID: 1,
      type: 'RECTANGLE',
      name: 'Box',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      fill: red
    })

    expect(nodeChange.name).toBe('Box')
    expect(nodeChange.fillPaints?.[0]?.color).toEqual(red)
  })

  test('encodes and decodes empty node change messages', async () => {
    await initCodec()

    const encoded = encodeMessage(createNodeChangesMessage(1, 0, []))
    const decoded = decodeMessage(encoded)

    expect(peekMessageType(encoded)).toBe(1)
    expect(decoded.type).toBe('NODE_CHANGES')
  })

  test('encodes variable-bound paint messages', async () => {
    await initCodec()

    const nodeChange: NodeChange = {
      guid: { sessionID: 1, localID: 2 },
      type: 'RECTANGLE',
      fillPaints: [
        {
          type: 'SOLID',
          color: red,
          colorVariableBinding: { variableID: { sessionID: 7, localID: 9 } }
        }
      ]
    }
    const encoded = encodeMessage(createNodeChangesMessage(1, 0, [nodeChange]))

    expect(encoded.length).toBeGreaterThan(0)
  })

  test('round-trips IMAGE paint with CROP scale mode', async () => {
    await initCodec()

    const nodeChange: NodeChange = {
      guid: { sessionID: 1, localID: 3 },
      type: 'RECTANGLE',
      fillPaints: [
        {
          type: 'IMAGE',
          color: red,
          image: { hash: new Uint8Array([1, 2, 3, 4]) },
          imageScaleMode: 'CROP'
        }
      ]
    }
    const encoded = encodeMessage(createNodeChangesMessage(1, 0, [nodeChange]))
    const decoded = decodeMessage(encoded)
    const paint = decoded.nodeChanges?.[0]?.fillPaints?.[0]

    expect(paint?.type).toBe('IMAGE')
    expect(paint?.imageScaleMode).toBe('CROP')
  })

  test('round-trips VECTOR fill geometry with EVENODD winding rule', async () => {
    await initCodec()

    const message: FigmaMessage = {
      ...createNodeChangesMessage(1, 0, [
        {
          guid: { sessionID: 1, localID: 3 },
          type: 'VECTOR',
          fillGeometry: [{ windingRule: 'EVENODD', commandsBlob: 0 }]
        }
      ]),
      blobs: [{ bytes: new Uint8Array([0, 1, 2, 3]) }]
    }
    const encoded = encodeMessage(message)
    const decoded = decodeMessage(encoded)
    const path = decoded.nodeChanges?.[0]?.fillGeometry?.[0]

    expect(path?.windingRule).toBe('EVENODD')
    expect(path?.commandsBlob).toBe(0)
  })
})
