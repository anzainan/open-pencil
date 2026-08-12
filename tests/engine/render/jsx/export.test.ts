import { describe, expect, test } from 'bun:test'

import type { SceneNode } from '@open-pencil/core'
import {
  parseSVGPath,
  renderJSX,
  SceneGraph,
  sceneNodeToJSX,
  selectionToJSX,
  vectorNetworkToSVGPaths
} from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

function makeGraph() {
  const graph = new SceneGraph()
  graph.createNode('CANVAS', graph.rootId, { name: 'Page 1' })
  return graph
}

function pageId(graph: SceneGraph) {
  return graph.getPages()[0].id
}

describe('sceneNodeToJSX', () => {
  test('basic rectangle', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Box',
      width: 100,
      height: 50
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toBe('<Rectangle name="Box" w={100} h={50} />')
  })

  test('rectangle with fill and rounded corners', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Card',
      width: 320,
      height: 200,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
      cornerRadius: 16
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('w={320}')
    expect(jsx).toContain('h={200}')
    expect(jsx).toContain('bg="#FFFFFF"')
    expect(jsx).toContain('rounded={16}')
    expect(jsx).toContain('<Rectangle')
    expect(jsx).toContain('/>')
  })

  test('text node', () => {
    const graph = makeGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Title',
      width: 200,
      height: 24,
      text: 'Hello World',
      fontSize: 18,
      fontWeight: 700,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('<Text')
    expect(jsx).toContain('size={18}')
    expect(jsx).toContain('weight="bold"')
    expect(jsx).toContain('color="#000000"')
    expect(jsx).toContain('>Hello World</Text>')
  })

  test('rtl text node', () => {
    const graph = makeGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Arabic Title',
      width: 200,
      height: 24,
      text: 'مرحبا',
      textDirection: 'RTL'
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('dir="rtl"')
  })

  test('frame with auto-layout', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Row',
      width: 400,
      height: 100,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'HUG'
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('flex="row"')
    expect(jsx).toContain('gap={16}')
    expect(jsx).toContain('p={12}')
    expect(jsx).toContain('w={400}')
  })

  test('frame with rtl auto-layout', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Row RTL',
      width: 400,
      height: 100,
      layoutMode: 'HORIZONTAL',
      layoutDirection: 'RTL'
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('dir="rtl"')
  })

  test('frame with children', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Card',
      width: 320,
      height: 200,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Image',
      width: 320,
      height: 120
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Title',
      width: 200,
      height: 20,
      text: 'Card Title',
      fontSize: 16,
      fontWeight: 700,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })

    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('<Frame')
    expect(jsx).toContain('flex="col"')
    expect(jsx).toContain('gap={8}')
    expect(jsx).toContain('  <Rectangle')
    expect(jsx).toContain('  <Text')
    expect(jsx).toContain('>Card Title</Text>')
    expect(jsx).toContain('</Frame>')
  })

  test('asymmetric padding', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Box',
      width: 100,
      height: 100,
      layoutMode: 'HORIZONTAL',
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('py={8}')
    expect(jsx).toContain('px={16}')
    expect(jsx).not.toContain('pt=')
    expect(jsx).not.toContain('pb=')
  })

  test('independent corners', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Pill',
      width: 100,
      height: 40,
      cornerRadius: 20,
      independentCorners: true,
      topLeftRadius: 20,
      topRightRadius: 0,
      bottomRightRadius: 0,
      bottomLeftRadius: 20
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('roundedTL={20}')
    expect(jsx).toContain('roundedBL={20}')
    expect(jsx).not.toContain('roundedTR=')
    expect(jsx).not.toContain('roundedBR=')
  })

  test('opacity and rotation', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 50,
      height: 50,
      opacity: 0.5,
      rotation: 45
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('opacity={0.5}')
    expect(jsx).toContain('rotate={45}')
  })

  test('stroke', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 100,
      strokes: [
        {
          color: { r: 1, g: 0, b: 0, a: 1 },
          weight: 2,
          opacity: 1,
          visible: true,
          align: 'INSIDE' as const
        }
      ]
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('stroke="#FF0000"')
    expect(jsx).toContain('strokeWidth={2}')
  })

  test('hidden children are excluded', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Parent',
      width: 100,
      height: 100
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Visible',
      width: 50,
      height: 50
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Hidden',
      width: 50,
      height: 50,
      visible: false
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('Visible')
    expect(jsx).not.toContain('Hidden')
  })

  test('empty text node renders self-closing', () => {
    const graph = makeGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Empty',
      width: 100,
      height: 20,
      text: ''
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('/>')
    expect(jsx).not.toContain('</Text>')
  })

  test('omits default values', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 100,
      opacity: 1,
      rotation: 0,
      cornerRadius: 0
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).not.toContain('opacity')
    expect(jsx).not.toContain('rotate')
    expect(jsx).not.toContain('rounded')
  })

  test('effects: shadow and blur', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 100,
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          radius: 8,
          spread: 0,
          visible: true
        },
        {
          type: 'LAYER_BLUR',
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          radius: 4,
          spread: 0,
          visible: true
        }
      ]
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('shadow="0 4 8')
    expect(jsx).toContain('blur={4}')
  })

  test('grid layout frame', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Grid',
      width: 400,
      height: 300,
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridTemplateRows: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridColumnGap: 16,
      gridRowGap: 8,
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('grid')
    expect(jsx).toContain('columns="1fr 1fr 1fr"')
    expect(jsx).toContain('rows="1fr 1fr"')
    expect(jsx).toContain('columnGap={16}')
    expect(jsx).toContain('rowGap={8}')
    expect(jsx).toContain('p={12}')
    expect(jsx).toContain('w={400}')
    expect(jsx).not.toContain('flex')
  })

  test('grid with mixed track sizes', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      width: 600,
      height: 400,
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FIXED', value: 200 },
        { sizing: 'FR', value: 1 },
        { sizing: 'AUTO', value: 0 }
      ],
      gridTemplateRows: [],
      gridColumnGap: 0,
      gridRowGap: 0
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('columns="200px 1fr auto"')
    expect(jsx).not.toContain('rows=')
    expect(jsx).not.toContain('columnGap')
  })

  test('child grid position', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      width: 400,
      height: 300,
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridTemplateRows: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridColumnGap: 0,
      gridRowGap: 0
    })
    const child = graph.createNode('RECTANGLE', frame.id, {
      name: 'Span',
      width: 100,
      height: 50,
      gridPosition: { column: 1, row: 2, columnSpan: 2, rowSpan: 1 }
    })
    const jsx = sceneNodeToJSX(child.id, graph)
    expect(jsx).toContain('colStart={1}')
    expect(jsx).toContain('rowStart={2}')
    expect(jsx).toContain('colSpan={2}')
    expect(jsx).not.toContain('rowSpan')
  })
})

describe('sceneNodeToJSX vector round-trip', () => {
  test('VECTOR with vectorNetwork exports inline svg with path d', () => {
    const graph = makeGraph()
    const network = parseSVGPath('M0 0 L24 0 L24 24 L0 24 Z')
    const node = graph.createNode('VECTOR', pageId(graph), {
      name: 'home',
      width: 24,
      height: 24,
      vectorNetwork: network,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('<svg')
    expect(jsx).toContain('viewBox="0 0 24 24"')
    expect(jsx).toContain('<path d=')
    expect(jsx).toContain('fill="#FFFFFF"')
    expect(jsx).not.toContain('<Vector')
  })

  test('VECTOR without vectorNetwork falls back to Vector tag', () => {
    const graph = makeGraph()
    const node = graph.createNode('VECTOR', pageId(graph), {
      name: 'plain',
      width: 24,
      height: 24
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('<Vector')
    expect(jsx).not.toContain('<svg')
  })

  test('inline svg paths are non-empty and parse back to network geometry', () => {
    const graph = makeGraph()
    const network = parseSVGPath('M0 0 C10 0 24 10 24 24 Z')
    const node = graph.createNode('VECTOR', pageId(graph), {
      width: 24,
      height: 24,
      vectorNetwork: network
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    const dMatch = jsx.match(/<path d="([^"]+)"/)
    expect(dMatch).not.toBeNull()
    if (!dMatch) return
    const roundTrip = parseSVGPath(dMatch[1])
    expect(roundTrip.segments.length).toBe(network.segments.length)
    expect(roundTrip.vertices.length).toBe(network.vertices.length)
  })

  test('vectorNetworkToSVGPaths returns one path per region', () => {
    const graph = makeGraph()
    const network = parseSVGPath('M0 0 L12 0 L12 12 L0 12 Z M12 12 L24 12 L24 24 L12 24 Z')
    const paths = vectorNetworkToSVGPaths(network)
    expect(paths.length).toBeGreaterThan(0)
    const node = graph.createNode('VECTOR', pageId(graph), {
      width: 24,
      height: 24,
      vectorNetwork: network
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    const dCount = (jsx.match(/<path /g) ?? []).length
    expect(dCount).toBe(paths.length)
  })

  test('exported inline svg renders back to VECTOR with non-empty vectorNetwork', async () => {
    const graph = makeGraph()
    const network = parseSVGPath('M0 0 L24 0 L24 24 L0 24 Z')
    graph.createNode('VECTOR', pageId(graph), {
      name: 'home',
      width: 24,
      height: 24,
      vectorNetwork: network
    })
    const jsx = sceneNodeToJSX(graph.getPages()[0].childIds[0], graph)

    const renderGraph = makeGraph()
    await renderJSX(renderGraph, jsx)
    const page = renderGraph.getPages()[0]
    const vectors: SceneNode[] = []
    for (const childId of page.childIds) {
      const child = renderGraph.getNode(childId)
      if (child?.type === 'VECTOR') vectors.push(child)
      for (const grandChildId of child?.childIds ?? []) {
        const grandChild = renderGraph.getNode(grandChildId)
        if (grandChild?.type === 'VECTOR') vectors.push(grandChild)
      }
    }
    expect(vectors.length).toBeGreaterThan(0)
    for (const vector of vectors) expect(vector.vectorNetwork).not.toBeNull()
  })
})

describe('selectionToJSX', () => {
  test('multiple nodes separated by blank lines', () => {
    const graph = makeGraph()
    const a = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'A',
      width: 10,
      height: 10
    })
    const b = graph.createNode('ELLIPSE', pageId(graph), {
      name: 'B',
      width: 20,
      height: 20
    })
    const jsx = selectionToJSX([a.id, b.id], graph)
    expect(jsx).toContain('<Rectangle')
    expect(jsx).toContain('<Ellipse')
    expect(jsx).toContain('\n\n')
  })
})

describe('JSX export of ABSOLUTE children inside flex (B2/Task 4 round trip)', () => {
  test('absolute child in flex keeps position="absolute" + x/y on export', () => {
    const graph = makeGraph()
    const btn = graph.createNode('FRAME', pageId(graph), {
      name: 'copy-btn',
      width: 296,
      height: 32,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER'
    })
    graph.createNode('RECTANGLE', btn.id, {
      name: 'AbsIcon',
      x: 113.5,
      y: 9,
      width: 14,
      height: 14,
      layoutPositioning: 'ABSOLUTE'
    })
    graph.createNode('TEXT', btn.id, {
      name: 'Text',
      x: 20,
      y: 8.5,
      width: 60,
      height: 20,
      text: '复制链接',
      textAutoResize: 'NONE'
    })

    const jsx = sceneNodeToJSX(btn.id, graph)
    expect(jsx).toContain('position="absolute"')
    expect(jsx).toContain('x={113.5}')
    expect(jsx).toContain('y={9}')
    // flow child keeps coordinates implicit for round-trip stability.
    expect(jsx).not.toContain('x={20}')
  })

  test('absolute child in flex round-trips back to identical coordinates', async () => {
    const graph = makeGraph()
    const btn = graph.createNode('FRAME', pageId(graph), {
      name: 'copy-btn',
      width: 296,
      height: 32,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'CENTER',
      itemSpacing: 6
    })
    const abs = graph.createNode('RECTANGLE', btn.id, {
      name: 'AbsIcon',
      x: 113.5,
      y: 9,
      width: 14,
      height: 14,
      layoutPositioning: 'ABSOLUTE'
    })
    graph.createNode('TEXT', btn.id, {
      name: 'Text',
      x: 20,
      y: 8.5,
      width: 60,
      height: 20,
      text: '复制链接',
      textAutoResize: 'NONE'
    })

    const jsx = sceneNodeToJSX(btn.id, graph)
    const [result] = await renderJSX(graph, jsx)
    const rBtn = expectDefined(graph.getNode(result.id), 'round-tripped button')
    const rAbs = expectDefined(graph.getNode(rBtn.childIds[0]), 'round-tripped absolute child')

    expect(rAbs.layoutPositioning).toBe('ABSOLUTE')
    expect(rAbs.x).toBe(abs.x)
    expect(rAbs.y).toBe(abs.y)
  })
})
