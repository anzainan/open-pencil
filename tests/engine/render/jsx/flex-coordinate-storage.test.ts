import { beforeAll, describe, expect, test } from 'bun:test'

import {
  exportFigFile,
  initCodec,
  parseFigFile,
  renderTree,
  SceneGraph,
  Frame,
  Rectangle
} from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

/**
 * flex 子节点「存储坐标」与「布局坐标」一致性回归（ARCH-flex-store-vs-layout §8）。
 *
 * - Task 3（B2）：渲染进「已编辑 flex 父」后，布局结果必须成为存储结果；
 *   未编辑的导入父容器保持 P0「存储值权威」语义。
 * - Task 4（JSX 导出）：flex 内 ABSOLUTE 子节点必须带 position="absolute" + x/y
 *   导出，往返后坐标一致。
 */

/** 构造 fig 导入来源的 flex 父容器（可选 editedFields 标记布局已编辑）。 */
function buildImportedFlexParent(graph: SceneGraph, edited: string[]) {
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    name: 'copy-btn',
    x: 0,
    y: 0,
    width: 296,
    height: 32,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    itemSpacing: 6
  })
  graph.updateNode(frame.id, { source: { ...frame.source, format: 'fig', editedFields: edited } })
  return frame
}

/** fig 导入来源的 FRAME 子节点，携带陈旧 rawTransform（x=20）。 */
function addStaleImportedFrameChild(graph: SceneGraph, parentId: string): SceneNodeLike {
  const child = graph.createNode('FRAME', parentId, {
    name: 'IconFrame',
    x: 20,
    y: 9,
    width: 14,
    height: 14
  })
  graph.updateNode(child.id, {
    source: {
      ...child.source,
      format: 'fig',
      editedFields: [],
      fig: {
        ...child.source.fig,
        rawTransform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 9 }
      }
    }
  })
  return child
}

type SceneNodeLike = { id: string }

describe('render stores layout coordinates into edited flex parents (B2)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('flex row + justify center render: stored x == yoga computed left', async () => {
    const graph = new SceneGraph()
    const result = await renderTree(
      graph,
      Frame({
        name: 'copy-btn',
        w: 296,
        h: 32,
        flex: 'row',
        justify: 'center',
        items: 'center',
        gap: 6,
        children: [
          Rectangle({ name: 'Icon', w: 14, h: 14, bg: '#000' }),
          Rectangle({ name: 'Text', w: 60, h: 20, bg: '#fff' })
        ]
      })
    )
    const btn = expectDefined(graph.getNode(result.id), 'button frame')
    const icon = expectDefined(graph.getNode(btn.childIds[0]), 'icon child')
    const text = expectDefined(graph.getNode(btn.childIds[1]), 'text child')
    const layoutX = { icon: icon.x, text: text.x }

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(
      exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)
    )
    const rBtn = expectDefined(
      reimported.getAllNodes().find((n) => n.name === 'copy-btn'),
      'reimported button'
    )
    const rIcon = expectDefined(reimported.getNode(rBtn.childIds[0]), 'reimported icon')
    const rText = expectDefined(reimported.getNode(rBtn.childIds[1]), 'reimported text')

    expect(Math.abs(rIcon.x - layoutX.icon)).toBeLessThan(0.001)
    expect(Math.abs(rText.x - layoutX.text)).toBeLessThan(0.001)
  })

  test('render into edited fig flex parent: stale imported child position is refreshed', async () => {
    const graph = new SceneGraph()
    const btn = buildImportedFlexParent(graph, ['itemSpacing'])
    const icon = addStaleImportedFrameChild(graph, btn.id)

    await renderTree(graph, Frame({ name: 'Text', w: 60, h: 20, bg: '#fff' }), {
      parentId: btn.id
    })

    // 父已编辑 → 布局结果必须写回陈旧导入子节点（原来恒 20）。
    const iconAfter = expectDefined(graph.getNode(icon.id), 'icon after render')
    expect(iconAfter.x).toBeGreaterThan(20)
    expect(iconAfter.source.editedFields).toContain('x')

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(
      exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)
    )
    const rIcon = expectDefined(
      reimported.getAllNodes().find((n) => n.name === 'IconFrame'),
      'reimported icon'
    )
    expect(Math.abs(rIcon.x - iconAfter.x)).toBeLessThan(0.001)
    expect(Math.abs(rIcon.y - iconAfter.y)).toBeLessThan(0.001)
  })

  test('render into unedited fig flex parent keeps stored positions (P0 not re-broken)', async () => {
    const graph = new SceneGraph()
    const btn = buildImportedFlexParent(graph, [])
    const icon = addStaleImportedFrameChild(graph, btn.id)

    await renderTree(graph, Frame({ name: 'Text', w: 60, h: 20, bg: '#fff' }), {
      parentId: btn.id
    })

    // P0 收敛：父未编辑 → 存储坐标是权威，保持 20。
    expect(expectDefined(graph.getNode(icon.id), 'icon').x).toBe(20)

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(
      exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)
    )
    const rIcon = expectDefined(
      reimported.getAllNodes().find((n) => n.name === 'IconFrame'),
      'reimported icon'
    )
    expect(rIcon.x).toBe(20)
  })
})
