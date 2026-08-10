import { safeDestr } from 'destr'

import type { FigmaNodeProxy } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

interface BatchOp {
  id: string
  props: Record<string, unknown>
}

/** applyBatchProps 支持的白名单；表外键会被忽略，需向调用方告警而不是静默丢弃。 */
const BATCH_PROP_KEYS = [
  'spacing',
  'padding',
  'padding_horizontal',
  'padding_vertical',
  'counter_align',
  'align',
  'sizing_horizontal',
  'sizing_vertical',
  'grow',
  'name',
  'visible',
  'corner_radius',
  'opacity',
  'auto_resize',
  'direction'
]

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function applyBatchProps(
  node: FigmaNodeProxy,
  props: Record<string, unknown>
): { updated: string[]; ignored: string[] } {
  const updated: string[] = []
  const ignored = Object.keys(props).filter((key) => !BATCH_PROP_KEYS.includes(key))

  if (props.spacing !== undefined) {
    node.itemSpacing = num(props.spacing)
    updated.push('spacing')
  }
  if (props.padding !== undefined) {
    const value = num(props.padding)
    node.paddingTop = value
    node.paddingRight = value
    node.paddingBottom = value
    node.paddingLeft = value
    updated.push('padding')
  }
  if (props.padding_horizontal !== undefined) {
    node.paddingLeft = num(props.padding_horizontal)
    node.paddingRight = num(props.padding_horizontal)
    updated.push('padding_horizontal')
  }
  if (props.padding_vertical !== undefined) {
    node.paddingTop = num(props.padding_vertical)
    node.paddingBottom = num(props.padding_vertical)
    updated.push('padding_vertical')
  }
  if (props.counter_align !== undefined) {
    node.counterAxisAlignItems = str(props.counter_align)
    updated.push('counter_align')
  }
  if (props.align !== undefined) {
    node.primaryAxisAlignItems = str(props.align)
    updated.push('align')
  }
  if (props.sizing_horizontal !== undefined) {
    node.layoutSizingHorizontal = str(props.sizing_horizontal)
    updated.push('sizing_horizontal')
  }
  if (props.sizing_vertical !== undefined) {
    node.layoutSizingVertical = str(props.sizing_vertical)
    updated.push('sizing_vertical')
  }
  if (props.grow !== undefined) {
    node.layoutGrow = num(props.grow)
    updated.push('grow')
  }
  if (props.name !== undefined) {
    node.name = str(props.name)
    updated.push('name')
  }
  if (props.visible !== undefined) {
    node.visible = Boolean(props.visible)
    updated.push('visible')
  }
  if (props.corner_radius !== undefined) {
    node.cornerRadius = num(props.corner_radius)
    updated.push('corner_radius')
  }
  if (props.opacity !== undefined) {
    node.opacity = num(props.opacity)
    updated.push('opacity')
  }
  if (props.auto_resize !== undefined) {
    node.textAutoResize = str(props.auto_resize)
    updated.push('auto_resize')
  }
  if (props.direction !== undefined) {
    node.layoutMode = str(props.direction) as 'HORIZONTAL' | 'VERTICAL'
    updated.push('direction')
  }

  return { updated, ignored }
}

export const batchUpdate = defineTool({
  name: 'batch_update',
  mutates: true,
  description:
    'Execute multiple modifications in one call. Each operation is {id, props} where props can include: spacing, padding, padding_horizontal, padding_vertical, counter_align, sizing_horizontal, sizing_vertical, grow, name, visible, corner_radius, auto_resize (for text), direction. Runs all updates with one layout recompute. Unsupported props are reported in warnings instead of being silently ignored.',
  params: {
    operations: {
      type: 'string',
      description:
        'JSON array: [{"id":"0:5","props":{"spacing":8}},{"id":"0:6","props":{"sizing_horizontal":"FILL","grow":1}}]',
      required: true
    }
  },
  execute: (figma, { operations }) => {
    let ops: BatchOp[]
    try {
      ops = safeDestr<BatchOp[]>(String(operations))
    } catch {
      throw new Error('Invalid JSON in operations')
    }
    if (!Array.isArray(ops)) throw new Error('operations must be a JSON array')

    const results: Array<{ id: string; updated: string[] }> = []
    const errors: string[] = []
    const warnings: string[] = []

    for (const op of ops) {
      const node = figma.getNodeById(op.id)
      if (!node) {
        errors.push(`Node "${op.id}" not found`)
        continue
      }
      const { updated, ignored } = applyBatchProps(node, op.props)
      if (updated.length > 0) results.push({ id: op.id, updated })
      if (ignored.length > 0) {
        warnings.push(
          `操作 ${op.id} 的属性 ${ignored.join('、')} 不被 batch_update 支持（白名单：${BATCH_PROP_KEYS.join(
            ', '
          )}），已忽略`
        )
      } else if (updated.length === 0 && Object.keys(op.props).length > 0) {
        warnings.push(`操作 ${op.id} 没有任何属性被更新`)
      }
    }

    const out: Record<string, unknown> = { updated: results.length }
    if (results.length > 0) out.results = results
    if (errors.length > 0) out.errors = errors
    if (warnings.length > 0) out.warnings = warnings
    return out
  }
})
