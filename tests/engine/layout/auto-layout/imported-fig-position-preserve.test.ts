import { beforeAll, describe, expect, test } from 'bun:test'

import { computeAllLayouts, exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

/**
 * P0 回归：加载期（computeAllLayouts）不得把 flex 子节点存储 x/y 改写为 Yoga 计算值，
 * 否则 icon+text 按钮里 Text 的 x 会被左推（133.5→20），且写回会污染 source.editedFields，
 * 导致保存链丢失 rawTransform 把坏值写进磁盘。
 *
 * 场景固定：flex row + justify center + gap 6 + Icon + Text。
 * 收敛条件：仅当父容器 source.editedFields 不含布局键时保留存储坐标。
 */

/** 构造 icon+text 按钮：父 flex row、居中、gap 6；text 存储 x=133.5。 */
function buildIconTextButton(graph: SceneGraph) {
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    name: 'Button',
    x: 0,
    y: 0,
    width: 200,
    height: 44,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    itemSpacing: 6,
    paddingLeft: 0,
    paddingRight: 0
  })
  const icon = graph.createNode('RECTANGLE', frame.id, {
    name: 'Icon',
    x: 0,
    y: 0,
    width: 16,
    height: 16
  })
  const text = graph.createNode('TEXT', frame.id, {
    name: 'Label',
    x: 133.5,
    y: 12,
    width: 100,
    height: 20,
    text: 'Button',
    textAutoResize: 'NONE',
    figmaDerivedLayout: { width: 100, height: 20 }
  })

  graph.updateNode(frame.id, { source: { ...frame.source, format: 'fig' } })
  graph.updateNode(icon.id, { source: { ...icon.source, format: 'fig' } })
  graph.updateNode(text.id, { source: { ...text.source, format: 'fig' } })

  return { frameId: frame.id, iconId: icon.id, textId: text.id }
}

describe('imported fig child position preservation (P0)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('flex row + justify center + gap 6 + Icon + Text: Text x keeps pre-load value', () => {
    const graph = new SceneGraph()
    const { textId } = buildIconTextButton(graph)

    computeAllLayouts(graph)

    // 存储 x=133.5 必须保留；Yoga 居中公式会把它算成 61（无修复时被改写）。
    expect(graph.getNode(textId)?.x).toBe(133.5)
  })

  test('load-time write-back no longer pollutes source.editedFields with x/y', () => {
    const graph = new SceneGraph()
    const { textId, iconId } = buildIconTextButton(graph)

    computeAllLayouts(graph)

    for (const id of [textId, iconId]) {
      const edited = expectDefined(graph.getNode(id), `node ${id}`).source.editedFields
      expect(edited).not.toContain('x')
      expect(edited).not.toContain('y')
    }
  })

  test('save → reimport round trip keeps stored coordinates (disk not corrupted)', async () => {
    const graph = new SceneGraph()
    const { textId } = buildIconTextButton(graph)

    computeAllLayouts(graph)
    expect(graph.getNode(textId)?.x).toBe(133.5)

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(
      exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)
    )

    const reimportedText = expectDefined(
      reimported.getAllNodes().find((node) => node.name === 'Label'),
      'reimported text'
    )
    expect(reimportedText.x).toBe(133.5)

    // 再次走浏览器加载路径（computeAllLayouts）坐标仍不变。
    computeAllLayouts(reimported)
    expect(reimported.getNode(reimportedText.id)?.x).toBe(133.5)
  })

  test('converges: after parent layout edit, Yoga recompute restores (x no longer preserved)', () => {
    const graph = new SceneGraph()
    const { frameId, textId } = buildIconTextButton(graph)

    computeAllLayouts(graph)
    expect(graph.getNode(textId)?.x).toBe(133.5)

    // 用户经 layout-mode/属性面板编辑父容器 → editedFields 标记 itemSpacing。
    graph.updateNode(frameId, { itemSpacing: 12 })

    computeAllLayouts(graph)

    // 收敛条件：父被布局编辑后恢复重排，text 回落到 Yoga 居中位置（64）。
    expect(graph.getNode(textId)?.x).toBe(64)
  })
})
