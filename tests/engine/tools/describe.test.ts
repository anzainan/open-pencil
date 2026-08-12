import { describe, expect, test } from 'bun:test'

import type { Color, Stroke } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'
import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

const NAVY: Color = { r: 2 / 255, g: 26 / 255, b: 59 / 255, a: 1 }

const HIDDEN_STROKE: Stroke = {
  color: { r: 1, g: 0, b: 0, a: 1 },
  weight: 4,
  opacity: 1,
  visible: false,
  align: 'CENTER',
  cap: 'NONE',
  join: 'MITER'
}

const VISIBLE_STROKE: Stroke = {
  color: NAVY,
  weight: 10.126,
  opacity: 1,
  visible: true,
  align: 'CENTER',
  cap: 'NONE',
  join: 'MITER'
}

interface ChildSummary {
  summary: string
}

function setupStrokedChild() {
  const { figma, graph } = setupToolTest()
  const frame = figma.createFrame()
  frame.name = 'Outline'
  frame.resize(200, 200)

  const outline = figma.createRectangle()
  outline.resize(100, 4)
  frame.appendChild(outline)
  graph.updateNode(outline.id, {
    fills: [],
    strokes: [HIDDEN_STROKE, VISIBLE_STROKE]
  })

  return { figma, frameId: frame.id, outlineId: outline.id }
}

describe('describe stroke summaries', () => {
  test('reports the first visible stroke in a child summary', () => {
    const { figma, frameId } = setupStrokedChild()
    const result = getTool('describe').execute(figma, { id: frameId }) as ToolResult
    const children = result.children as ChildSummary[]
    const summary = expectDefined(children[0], 'stroked child summary').summary

    expect(summary).toContain('#021A3B 10.13px stroke')
  })

  test('reports the first visible stroke in the node visual summary', () => {
    const { figma, outlineId } = setupStrokedChild()
    const result = getTool('describe').execute(figma, { id: outlineId }) as ToolResult

    expect(result.visual).toContain('#021A3B 10.13px stroke')
  })
})

interface DescribeIssuesResult extends ToolResult {
  issues?: Array<{ message?: string }>
}

function growInHugMessages(result: DescribeIssuesResult): string[] {
  const issues = result.issues ?? []
  return issues
    .map((issue) => issue.message ?? '')
    .filter((message) => /grow=\d+ inside HUG/i.test(message))
}

/** HUG 父（row）+ 单个子节点；返回父 frame id。 */
function setupHugRowChild(
  childType: 'FILL' | 'FIXED',
  name: string
): { figma: ReturnType<typeof setupToolTest>['figma']; graph: ReturnType<typeof setupToolTest>['graph']; frameId: string } {
  const { figma, graph } = setupToolTest()
  const frame = figma.createFrame()
  frame.name = 'HugParent'
  frame.resize(300, 40)
  graph.updateNode(frame.id, {
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED'
  })

  const child = figma.createRectangle()
  child.name = name
  child.resize(childType === 'FILL' ? 80 : 80, 20)
  frame.appendChild(child)
  graph.updateNode(child.id, {
    layoutGrow: 1,
    primaryAxisSizing: childType
  })

  return { figma, graph, frameId: frame.id }
}

describe('describe grow-in-hug layout issues', () => {
  test('does not warn when a fill child sits inside a HUG parent', () => {
    const { figma, frameId } = setupHugRowChild('FILL', 'FillChild')
    const result = getTool('describe').execute(figma, { id: frameId }) as DescribeIssuesResult

    expect(growInHugMessages(result)).toHaveLength(0)
  })

  test('still warns when a FIXED child with grow sits inside a HUG parent', () => {
    const { figma, frameId } = setupHugRowChild('FIXED', 'FixedGrowChild')
    const result = getTool('describe').execute(figma, { id: frameId }) as DescribeIssuesResult

    expect(growInHugMessages(result)).toEqual([
      expect.stringMatching(/grow=1 inside HUG parent "HugParent"/)
    ])
  })
})
