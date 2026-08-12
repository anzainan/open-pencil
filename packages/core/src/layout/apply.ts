import type { Node as YogaNode } from 'yoga-layout'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { usesDetachedDerivedLayout } from './derived'

export type ComputeLayoutFn = (graph: SceneGraph, frameId: string) => void

function preservesImportedHugCrossSize(
  graph: SceneGraph,
  frame: SceneNode,
  axis: 'width' | 'height'
): boolean {
  if (frame.source.format !== 'fig' || frame.counterAxisSizing !== 'HUG') return false
  const expectedMode = axis === 'width' ? 'VERTICAL' : 'HORIZONTAL'
  if (frame.layoutMode !== expectedMode) return false
  return graph
    .getChildren(frame.id)
    .some(
      (child) =>
        child.layoutAlignSelf === 'STRETCH' && child.figmaDerivedLayout?.[axis] !== undefined
    )
}

function applyFrameSize(graph: SceneGraph, frame: SceneNode, yogaNode: YogaNode): void {
  if (frame.layoutMode === 'GRID') {
    if (frame.gridTemplateRows.length === 0) {
      graph.updateNode(frame.id, { height: yogaNode.getComputedHeight() })
    }
    return
  }

  if (frame.primaryAxisSizing !== 'HUG' && frame.counterAxisSizing !== 'HUG') return

  const computedW = yogaNode.getComputedWidth()
  const computedH = yogaNode.getComputedHeight()
  const updates: Partial<SceneNode> = {}

  const derived = frame.figmaDerivedLayout
  if (frame.primaryAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL') updates.width = derived?.width ?? computedW
    else updates.height = derived?.height ?? computedH
  }
  if (frame.counterAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL') {
      updates.height = preservesImportedHugCrossSize(graph, frame, 'height')
        ? frame.height
        : (derived?.height ?? computedH)
    } else {
      updates.width = preservesImportedHugCrossSize(graph, frame, 'width')
        ? frame.width
        : (derived?.width ?? computedW)
    }
  }

  graph.updateNode(frame.id, updates)
}

function frameSourceIsFig(graph: SceneGraph, parentId: string | null): boolean {
  return parentId ? graph.getNode(parentId)?.source.format === 'fig' : false
}

/** 父容器上的布局键：被编辑过则存储的子坐标不再可信，恢复 Yoga 重排。 */
const PARENT_LAYOUT_EDIT_KEYS: ReadonlySet<string> = new Set([
  'width',
  'height',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'itemSpacing',
  'counterAxisSpacing',
  'primaryAxisAlign',
  'counterAxisAlign',
  'counterAxisAlignContent',
  'layoutWrap',
  'layoutMode',
  'layoutDirection',
  'primaryAxisSizing',
  'counterAxisSizing',
  'layoutGrow',
  'layoutAlignSelf',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight'
])

function preservesImportedFigChildPosition(graph: SceneGraph, child: SceneNode): boolean {
  if (child.type === 'INSTANCE') return false
  if (child.source.format !== 'fig' || !frameSourceIsFig(graph, child.parentId)) return false
  const parent = child.parentId ? graph.getNode(child.parentId) : undefined
  if (!parent) return false
  const edited = parent.source.editedFields
  return !edited.some((key) => PARENT_LAYOUT_EDIT_KEYS.has(key))
}

function computedChildPosition(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'x' | 'y',
  preservesImportedGeometry: boolean
): number {
  if (preservesImportedGeometry) return child[axis]
  const computed = axis === 'x' ? yogaChild.getComputedLeft() : yogaChild.getComputedTop()
  if (child.type === 'INSTANCE') return computed
  return child.figmaDerivedLayout?.[axis] ?? computed
}

function preservesStaleImportedTextSize(child: SceneNode, axis: 'width' | 'height'): boolean {
  const derivedSize = child.figmaDerivedLayout?.[axis]
  return (
    child.type === 'TEXT' &&
    child.source.format === 'fig' &&
    derivedSize !== undefined &&
    Math.abs(child[axis] - derivedSize) > 0.001
  )
}

function computedChildSize(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'width' | 'height',
  preservesImportedFrameGeometry: boolean
): number {
  if (preservesImportedFrameGeometry || preservesStaleImportedTextSize(child, axis)) {
    return child[axis]
  }
  const computed = axis === 'width' ? yogaChild.getComputedWidth() : yogaChild.getComputedHeight()
  if (child.type === 'TEXT' && child.source.format === 'fig') {
    return computed > 0 ? computed : child[axis]
  }
  return child.figmaDerivedLayout?.[axis] ?? computed
}

function updateChildFromYoga(graph: SceneGraph, child: SceneNode, yogaChild: YogaNode): void {
  if (!child.visible || child.layoutPositioning === 'ABSOLUTE') return

  const preservesImportedFrameGeometry =
    child.type === 'FRAME' &&
    child.source.format === 'fig' &&
    frameSourceIsFig(graph, child.parentId)
  const preservesImportedPosition =
    preservesImportedFrameGeometry ||
    (child.source.format === 'fig' && Math.abs(child.rotation) > 0.001) ||
    preservesImportedFigChildPosition(graph, child)

  const x = computedChildPosition(child, yogaChild, 'x', preservesImportedPosition)
  const y = computedChildPosition(child, yogaChild, 'y', preservesImportedPosition)
  const width = computedChildSize(child, yogaChild, 'width', preservesImportedFrameGeometry)
  const height = computedChildSize(child, yogaChild, 'height', preservesImportedFrameGeometry)

  const updates: Partial<SceneNode> = {}
  // 仅在值实际变化时写回：加载期坐标保留场景下（值不变）不再调用 updateNode，
  // 避免把 x/y 标记进 source.editedFields → 保存链丢失 rawTransform 写坏磁盘（P0）。
  if (Math.abs(x - child.x) > 0.001) updates.x = x
  if (Math.abs(y - child.y) > 0.001) updates.y = y
  if (Math.abs(width - child.width) > 0.001) updates.width = width
  if (Math.abs(height - child.height) > 0.001) updates.height = height
  if (Object.keys(updates).length > 0) graph.updateNode(child.id, updates)
}

function preservesImportedInstanceInternals(child: SceneNode): boolean {
  return child.type === 'INSTANCE' && child.source.format === 'fig'
}

function recomputeGridChild(
  graph: SceneGraph,
  child: SceneNode,
  computeLayout: ComputeLayoutFn
): void {
  const updated = graph.getNode(child.id)
  if (!updated || updated.layoutMode === 'NONE') return

  const savedPrimary = updated.primaryAxisSizing
  const savedCounter = updated.counterAxisSizing
  const updates: Partial<SceneNode> = {}

  if (savedPrimary === 'HUG') updates.primaryAxisSizing = 'FIXED'
  if (savedCounter === 'HUG') updates.counterAxisSizing = 'FIXED'
  if (Object.keys(updates).length > 0) graph.updateNode(child.id, updates)

  computeLayout(graph, child.id)

  const restore: Partial<SceneNode> = {}
  if (updates.primaryAxisSizing) restore.primaryAxisSizing = savedPrimary
  if (updates.counterAxisSizing) restore.counterAxisSizing = savedCounter
  if (Object.keys(restore).length > 0) graph.updateNode(child.id, restore)
}

export function applyYogaLayout(
  graph: SceneGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
  computeLayout: ComputeLayoutFn
): void {
  applyFrameSize(graph, frame, yogaNode)

  const children = graph.getChildren(frame.id)
  let yogaIndex = 0
  for (const child of children) {
    if (yogaIndex >= yogaNode.getChildCount()) continue
    const yogaChild = yogaNode.getChild(yogaIndex)
    yogaIndex++

    updateChildFromYoga(graph, child, yogaChild)

    if (!child.visible) continue
    if (preservesImportedInstanceInternals(child)) continue

    if (usesDetachedDerivedLayout(child)) {
      computeLayout(graph, child.id)
      continue
    }

    if (child.layoutMode !== 'NONE') {
      if (child.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        computeLayout(graph, child.id)
      } else if (frame.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        recomputeGridChild(graph, child, computeLayout)
      } else {
        applyYogaLayout(graph, child, yogaChild, computeLayout)
      }
    }
  }
}
