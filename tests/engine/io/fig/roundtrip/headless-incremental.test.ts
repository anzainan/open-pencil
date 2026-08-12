import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { populateAllLazyFigImportRoots } from '@open-pencil/core/kiwi'

import { expectDefined } from '#tests/helpers/assert'

setDefaultTimeout(60_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)

function populateWholeDocument(graph: SceneGraph): boolean {
  const changed = populateAllLazyFigImportRoots(graph)
  if (changed) computeAllLayouts(graph)
  return changed
}

async function writeFig(graph: SceneGraph): Promise<Uint8Array> {
  const result = await io.writeDocument('fig', graph)
  return result.data as Uint8Array
}

/** Build a doc that mirrors a real .fig: G frame with 30 children on page 1. */
function buildBaseGraph(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const g = graph.createNode('FRAME', page.id, { name: 'G', x: 0, y: 0, width: 400, height: 400 })
  for (let i = 0; i < 30; i++) {
    graph.createNode('RECTANGLE', g.id, {
      name: `child-${i}`,
      x: i * 10,
      y: 0,
      width: 20,
      height: 20
    })
  }
  graph.createNode('RECTANGLE', page.id, { name: 'sibling', x: 0, y: 500, width: 50, height: 50 })
  return graph
}

describe('headless edit chain: load → mutate → write → reload keeps tree intact', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('incremental append to imported doc survives export/reload (G + 30 children)', async () => {
    // 1. Round-trip once so every node carries a real imported source.id
    //    (exactly what io.readDocument produces for a saved .fig).
    const baseBytes = await exportFigFile(buildBaseGraph())
    const original = await parseFigFile(baseBytes.buffer as ArrayBuffer, { populate: 'first-page' })
    populateWholeDocument(original)

    const gBefore = [...original.getAllNodes()].find((n) => n.name === 'G')
    expectDefined(gBefore, 'G node')
    expect(original.getChildren(gBefore.id)).toHaveLength(30)

    // 2. eval-style mutation: findOne old node, append a new subtree with children
    const g = expectDefined(original.getNode(gBefore.id), 'G node')
    const box = original.createNode('FRAME', g.id, { name: 'NewBox', width: 100, height: 100 })
    for (let i = 0; i < 5; i++) {
      original.createNode('ELLIPSE', box.id, { name: `dot-${i}`, width: 8, height: 8 })
    }

    // 3. Write back (eval --write path)
    const result = await writeFig(original)
    const reloaded = await parseFigFile((result as Uint8Array).buffer as ArrayBuffer, {
      populate: 'first-page'
    })
    populateWholeDocument(reloaded)

    // 4. Assert the whole tree is intact
    const gAfter = [...reloaded.getAllNodes()].find((n) => n.name === 'G')
    expectDefined(gAfter, 'reloaded G')
    expect(reloaded.getChildren(gAfter.id)).toHaveLength(31) // 30 + NewBox
    const newBox = reloaded.getChildren(gAfter.id).find((c) => c.name === 'NewBox')
    expectDefined(newBox, 'NewBox')
    expect(reloaded.getChildren(newBox.id)).toHaveLength(5)
    expect(reloaded.getAllNodes().some((n) => n.name === 'sibling')).toBe(true)
    expect(reloaded.getChildren(gAfter.id).filter((c) => c.name.startsWith('child-'))).toHaveLength(30)
  })

  test('findOne old node + append new node (incremental) keeps old subtree', async () => {
    const baseBytes = await exportFigFile(buildBaseGraph())
    const graph = await parseFigFile(baseBytes.buffer as ArrayBuffer, { populate: 'first-page' })
    populateWholeDocument(graph)

    const { FigmaAPI } = await import('@open-pencil/core/figma-api')
    const figma = new FigmaAPI(graph)
    const page = figma.currentPage
    const g = expectDefined(
      page.findOne((n) => n.name === 'G'),
      'findOne G'
    )
    const added = figma.createFrame()
    added.name = 'added-frame'
    const inner = figma.createRectangle()
    inner.name = 'added-inner'
    g.appendChild(added)
    added.appendChild(inner)

    const bytes = await exportFigFile(graph)
    const reloaded = await parseFigFile(bytes.buffer as ArrayBuffer, { populate: 'first-page' })
    populateWholeDocument(reloaded)

    const gAfter = [...reloaded.getAllNodes()].find((n) => n.name === 'G')
    expectDefined(gAfter, 'reloaded G')
    expect(reloaded.getChildren(gAfter.id)).toHaveLength(31) // 30 + added-frame
    const addedAfter = reloaded.getChildren(gAfter.id).find((n) => n.name === 'added-frame')
    expectDefined(addedAfter, 'reloaded added-frame')
    expect(reloaded.getChildren(addedAfter.id)).toHaveLength(1)
    expect(expectDefined(reloaded.getNode(addedAfter.id), 'addedAfter').childIds.some((id) => {
      return reloaded.getNode(id)?.name === 'added-inner'
    })).toBe(true)
    expect(reloaded.getAllNodes().some((n) => n.name === 'sibling')).toBe(true)
  })

  test('multi-page doc: append to lazily-populated page survives write/reload', async () => {
    const graph = new SceneGraph()
    const page1 = graph.getPages()[0]
    const page2 = graph.addPage('Second Page')
    const comp = graph.createNode('COMPONENT', page1.id, { name: 'Btn', width: 100, height: 40 })
    graph.createNode('RECTANGLE', comp.id, { name: 'BtnBG', width: 100, height: 40 })
    const g2 = graph.createNode('FRAME', page2.id, { name: 'G2', width: 300, height: 300 })
    for (let i = 0; i < 10; i++) {
      graph.createNode('RECTANGLE', g2.id, { name: `c2-${i}`, width: 10, height: 10 })
    }
    graph.createNode('INSTANCE', page2.id, { name: 'Btn instance', componentId: comp.id })

    const baseBytes = await exportFigFile(graph)
    const loaded = await parseFigFile(baseBytes.buffer as ArrayBuffer, { populate: 'first-page' })
    expect(loaded.getPages(true).length).toBe(2)
    // Regular nodes are always fully imported; only instance children +
    // cross-page override resolution is deferred by 'first-page'.
    const g2Loaded = [...loaded.getAllNodes()].find((n) => n.name === 'G2')
    expectDefined(g2Loaded, 'G2 present on second page')
    expect(loaded.getChildren(g2Loaded.id)).toHaveLength(10)
    const instanceLoaded = [...loaded.getAllNodes()].find((n) => n.type === 'INSTANCE')
    expectDefined(instanceLoaded, 'instance placeholder')
    expect(loaded.getChildren(instanceLoaded.id)).toHaveLength(0)

    populateWholeDocument(loaded)
    const g2Populated = [...loaded.getAllNodes()].find((n) => n.name === 'G2')
    expectDefined(g2Populated, 'G2 populated')
    expect(loaded.getChildren(g2Populated.id)).toHaveLength(10)
    expect(
      loaded.getChildren(expectDefined([...loaded.getAllNodes()].find((n) => n.type === 'INSTANCE'), 'instance').id)
    ).toHaveLength(1)

    // eval-style incremental edit on the now-populated second page
    const box = loaded.createNode('FRAME', g2Populated.id, { name: 'G2Box', width: 80, height: 80 })
    loaded.createNode('TEXT', box.id, { name: 'G2Label', text: 'Hi', fontSize: 12 })

    const bytes = await exportFigFile(loaded)
    const reloaded = await parseFigFile(bytes.buffer as ArrayBuffer, { populate: 'first-page' })
    populateWholeDocument(reloaded)

    const g2After = [...reloaded.getAllNodes()].find((n) => n.name === 'G2')
    expectDefined(g2After, 'reloaded G2')
    expect(reloaded.getChildren(g2After.id)).toHaveLength(11) // 10 + G2Box
    const boxAfter = reloaded.getChildren(g2After.id).find((c) => c.name === 'G2Box')
    expectDefined(boxAfter, 'G2Box')
    expect(reloaded.getChildren(boxAfter.id)).toHaveLength(1)
    expect(reloaded.getAllNodes().some((n) => n.name === 'Btn instance')).toBe(true)
  })

  test('complex UI build (login screen) on an imported doc survives write/reload', async () => {
    // Mirrors designs/openpencil-login-v3.js: build ~25 nodes via FigmaAPI then write back.
    const baseBytes = await exportFigFile(buildBaseGraph())
    const graph = await parseFigFile(baseBytes.buffer as ArrayBuffer, { populate: 'first-page' })
    populateWholeDocument(graph)

    const { FigmaAPI } = await import('@open-pencil/core/figma-api')
    const figma = new FigmaAPI(graph)
    const page = figma.currentPage

    const solid = (c: { r: number; g: number; b: number }) => [{ type: 'SOLID', color: c }]
    const makeText = (str: string, size: number, weight: number | null, color: { r: number; g: number; b: number }) => {
      const t = figma.createText()
      t.characters = str
      t.fontSize = size
      if (weight) t.fontWeight = weight
      t.fills = solid(color)
      t.resize(str.length * size, Math.round(size * 1.4))
      return t
    }

    const screen = figma.createFrame()
    screen.name = '登录页 v3'
    screen.resize(390, 844)
    screen.fills = solid({ r: 0.96, g: 0.97, b: 0.98 })
    screen.clipsContent = true
    page.appendChild(screen)

    const logo = makeText('✦ 产品名', 22, 700, { r: 0.25, g: 0.46, b: 0.98 })
    screen.appendChild(logo)
    const title = makeText('欢迎回来', 30, 700, { r: 0.11, g: 0.12, b: 0.14 })
    screen.appendChild(title)
    const sub = makeText('登录你的账户继续使用', 14, null, { r: 0.55, g: 0.57, b: 0.62 })
    screen.appendChild(sub)

    const input = figma.createFrame()
    input.name = '邮箱输入框'
    input.resize(350, 52)
    screen.appendChild(input)
    const icon = figma.createVector()
    icon.name = 'mail-icon'
    icon.svgPathString = 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z'
    input.appendChild(icon)
    input.appendChild(makeText('邮箱', 15, null, { r: 0.55, g: 0.57, b: 0.62 }))

    const btn = figma.createFrame()
    btn.name = '登录按钮'
    btn.resize(350, 52)
    screen.appendChild(btn)
    btn.appendChild(makeText('登 录', 16, 600, { r: 1, g: 1, b: 1 }))

    // screen tree: logo + title + sub + input + btn = 5 direct children
    const expectedScreen = 5
    const totalBefore = [...graph.getAllNodes()].length

    const bytes = await exportFigFile(graph)
    const reloaded = await parseFigFile(bytes.buffer as ArrayBuffer, { populate: 'first-page' })
    populateWholeDocument(reloaded)

    const screenAfter = [...reloaded.getAllNodes()].find((n) => n.name === '登录页 v3')
    expectDefined(screenAfter, 'reloaded screen')
    expect(reloaded.getChildren(screenAfter.id)).toHaveLength(expectedScreen)
    // Original imported nodes (G + 30 children + sibling) must all survive.
    const gAfter = [...reloaded.getAllNodes()].find((n) => n.name === 'G')
    expectDefined(gAfter, 'reloaded G')
    expect(reloaded.getChildren(gAfter.id)).toHaveLength(30)
    expect(reloaded.getAllNodes().some((n) => n.name === 'sibling')).toBe(true)
    // Reload must contain every node the session had before write.
    expect([...reloaded.getAllNodes()].length).toBe(totalBefore)
  })
})
