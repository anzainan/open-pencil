import { beforeAll, describe, expect, test } from 'bun:test'

import { createEditor, exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'

import { getNodeOrThrow } from '#tests/helpers/assert'

describe('page background persistence (⑦ setPageColor write-back / read-back)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('setPageColor stores the color on the page node for export', async () => {
    const graph = new SceneGraph()
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const pageId = graph.getPages()[0].id

    editor.setPageColor({ r: 0.2, g: 0.4, b: 0.6, a: 1 })

    const page = getNodeOrThrow(graph, pageId)
    const fields = page.source.fig.rawNodeFields
    expect(fields.backgroundColor).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 })
    expect(Array.isArray(fields.backgroundPaints)).toBe(true)
    expect(editor.state.pageColor.r).toBeCloseTo(0.2, 2)
  })

  test('page color survives export → re-import → page switch', async () => {
    const graph = new SceneGraph()
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    editor.setPageColor({ r: 0.2, g: 0.4, b: 0.6, a: 1 })

    const bytes = await exportFigFile(graph)
    const reImported = await parseFigFile(bytes)

    const editor2 = createEditor({ graph: reImported, skipInitialGraphSetup: true })
    const reimportedPageId = reImported.getPages()[0].id
    await editor2.switchPage(reimportedPageId)

    expect(editor2.state.pageColor.r).toBeCloseTo(0.2, 2)
    expect(editor2.state.pageColor.g).toBeCloseTo(0.4, 2)
    expect(editor2.state.pageColor.b).toBeCloseTo(0.6, 2)
  })

  test('new pages without a background keep the default canvas color', async () => {
    const graph = new SceneGraph()
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const pageId = graph.addPage('Blank')
    await editor.switchPage(pageId)
    expect(editor.state.pageColor.r).toBeCloseTo(0.96, 2)
  })
})
