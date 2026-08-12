import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'
import { headlessRenderNodes, initCanvasKit } from '@open-pencil/core/io'
import { fontManager } from '@open-pencil/core/text'
import {
  isFontFileExtension,
  parseSfntNameTable,
  registerWorkspaceFontFiles,
  resolveWorkspaceFontFace,
  scanFontDirectory
} from '@open-pencil/core/text/workspace-fonts'
import type { CanvasKit } from 'canvaskit-wasm'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

setDefaultTimeout(120_000)

const FONTS_DIR = repoPath('tests/fixtures/fonts')

let ck: CanvasKit

beforeAll(async () => {
  ck = await initCanvasKit()
  // No network in this sandbox: keep headless renders from retrying remote font fetches.
  fontManager.setOnlineFontProviders({})
})

function solidFill(r: number, g: number, b: number, a = 1) {
  return [{ type: 'SOLID', color: { r, g, b, a }, opacity: 1, visible: true }]
}

async function countNonTransparentPixels(png: Uint8Array): Promise<number> {
  const image = ck.MakeImageFromEncoded(png)
  expectDefined(image, 'png image')
  try {
    const pixels = expectDefined(
      image.readPixels(0, 0, {
        alphaType: ck.AlphaType.Unpremul,
        colorType: ck.ColorType.RGBA_8888,
        colorSpace: ck.ColorSpace.SRGB,
        width: image.width(),
        height: image.height()
      }),
      'pixels'
    )
    let count = 0
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) count++
    }
    return count
  } finally {
    image.delete()
  }
}

describe('headless workspace fonts + transparent root background', () => {
  test('resolves sfnt family/subfamily from a real OTF fixture', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const bytes = await readFile(join(FONTS_DIR, 'NotoSansCJK-Test.otf'))
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const parsed = parseSfntNameTable(data)
    expectDefined(parsed, 'parsed name table')
    expect(parsed.family).toBe('Noto Sans CJK SC')
    expect(parsed.subfamily?.toLowerCase()).toContain('regular')
    const face = resolveWorkspaceFontFace('NotoSansCJK-Test.otf', 'otf', data)
    expect(face.family).toBe('Noto Sans CJK SC')
    expect(face.style.toLowerCase()).toContain('regular')
    expect(isFontFileExtension('NotoSansSC-Regular.ttf')).toBe(true)
    expect(isFontFileExtension('readme.txt')).toBe(false)
  })

  test('scanFontDirectory + registerWorkspaceFontFiles registers CJK faces', async () => {
    const files = await scanFontDirectory(FONTS_DIR)
    const fontFiles = files.filter((f) => isFontFileExtension(f.name))
    expect(fontFiles.length).toBeGreaterThanOrEqual(1)
    const families = registerWorkspaceFontFiles(fontFiles)
    expect(families).toContain('Noto Sans CJK SC')
    expect(fontManager.isStyleLoaded('Noto Sans CJK SC', 'Regular')).toBe(true)
  })

  test('CJK text renders visible pixels with a locally-registered font', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'CJK',
      x: 0,
      y: 0,
      width: 300,
      height: 120,
      fills: solidFill(1, 1, 1)
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Title',
      x: 16,
      y: 30,
      width: 260,
      height: 60,
      text: '欢迎回来',
      fontSize: 40,
      fontFamily: 'Noto Sans CJK SC',
      fontWeight: 400,
      fills: solidFill(0, 0, 0)
    })

    const png = expectDefined(
      await headlessRenderNodes(graph, page.id, [frame.id], { scale: 1, format: 'PNG' }),
      'png'
    )
    expect(await countNonTransparentPixels(png)).toBeGreaterThan(100)
  })

  test('transparent root node composites page background color', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    // Root frame with NO fills (transparent) plus a small opaque child.
    const frame = graph.createNode('FRAME', page.id, {
      name: 'TransparentRoot',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fills: []
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Dot',
      x: 45,
      y: 45,
      width: 10,
      height: 10,
      fills: solidFill(1, 0, 0)
    })

    const png = expectDefined(
      await headlessRenderNodes(graph, page.id, [frame.id], { scale: 1, format: 'PNG' }),
      'png'
    )
    const image = expectDefined(ck.MakeImageFromEncoded(png), 'image')
    try {
      const pixels = expectDefined(
        image.readPixels(0, 0, {
          alphaType: ck.AlphaType.Unpremul,
          colorType: ck.ColorType.RGBA_8888,
          colorSpace: ck.ColorSpace.SRGB,
          width: image.width(),
          height: image.height()
        }),
        'pixels'
      )
      // Corner pixel: fully opaque page background (alpha 255, light gray), not transparent.
      expect(pixels[3]).toBe(255)
      expect(pixels[0]).toBeGreaterThan(220)
      expect(pixels[1]).toBeGreaterThan(220)
      expect(pixels[2]).toBeGreaterThan(220)
      // Everything must be non-transparent now that page background is composited.
      let transparent = 0
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) transparent++
      }
      expect(transparent).toBe(0)
    } finally {
      image.delete()
    }
  })

  test('opaque root node keeps transparent export background', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'OpaqueRoot',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fills: solidFill(0.2, 0.4, 0.8)
    })
    const png = expectDefined(
      await headlessRenderNodes(graph, page.id, [frame.id], { scale: 1, format: 'PNG' }),
      'png'
    )
    // Opaque fill → nothing transparent anywhere.
    expect(await countNonTransparentPixels(png)).toBe(100 * 100)
  })
})
