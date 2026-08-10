/**
 * Tool definition schema.
 *
 * Each tool is defined once with typed params and an execute function
 * that operates on FigmaAPI. Adapters for AI chat (valibot), CLI (citty),
 * and MCP (JSON Schema) are generated from these definitions.
 */

import type { SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI, FigmaNodeProxy } from '#core/figma-api'

export type ParamType = 'string' | 'number' | 'boolean' | 'color' | 'string[]'

export interface ParamDef {
  type: ParamType
  description: string
  required?: boolean
  default?: unknown
  enum?: string[]
  min?: number
  max?: number
}

/**
 * Tool execution result.
 *
 * Tools return plain objects; `warnings` is an optional array used to surface
 * non-fatal problems (e.g. a property that was silently ignored, or a size
 * that the layout engine overwrote) so the AI caller never sees fake success.
 */
export interface ToolResult {
  [key: string]: unknown
  warnings?: string[]
}

export interface ToolDef {
  name: string
  description: string
  mutates?: boolean
  params: Record<string, ParamDef>
  execute: (figma: FigmaAPI, args: Record<string, unknown>) => unknown
}

type ResolvedType<T extends ParamType> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'color'
        ? string
        : T extends 'string[]'
          ? string[]
          : never

type ResolvedParams<P extends Record<string, ParamDef>> = {
  [K in keyof P as P[K]['required'] extends true ? K : never]: ResolvedType<P[K]['type']>
} & {
  [K in keyof P as P[K]['required'] extends true ? never : K]?: ResolvedType<P[K]['type']>
}

export function defineTool<P extends Record<string, ParamDef>>(def: {
  name: string
  description: string
  mutates?: boolean
  params: P
  execute: (figma: FigmaAPI, args: ResolvedParams<P>) => unknown
}): ToolDef {
  return def as ToolDef
}

export class NodeNotFoundError extends Error {
  constructor(id: string) {
    super(`Node not found: ${id}`)
    this.name = 'NodeNotFoundError'
  }
}

/** 统一工具错误构造：execute 失败一律 throw，由 MCP 层转 isError:true（P0-3）。 */
export function toolError(message: string): never {
  throw new Error(message)
}

export function requireNode(figma: FigmaAPI, id: string): ReturnType<FigmaAPI['getNodeById']> {
  const node = figma.getNodeById(id)
  if (!node) throw new NodeNotFoundError(id)
  return node
}

export function nodeNotFound(id: string): never {
  throw new NodeNotFoundError(id)
}

export function getRawNodeOrError(figma: FigmaAPI, id: string): SceneNode {
  const node = figma.graph.getNode(id)
  if (!node) throw new NodeNotFoundError(id)
  return node
}

export function nodeToResult(node: FigmaNodeProxy, maxDepth?: number): Record<string, unknown> {
  return node.toJSON(maxDepth)
}

export function nodeSummary(node: FigmaNodeProxy): { id: string; name: string; type: string } {
  return { id: node.id, name: node.name, type: node.type }
}

/**
 * Merge `warnings` into a tool result object without losing existing fields.
 * Returns a new object; keeps the original when there is nothing to add.
 */
export function withWarnings(result: unknown, warnings: string[]): unknown {
  if (warnings.length === 0) return result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const existing = Array.isArray((result as ToolResult).warnings)
      ? ((result as ToolResult).warnings as string[])
      : []
    return { ...result, warnings: [...existing, ...warnings] }
  }
  return { result, warnings }
}

function isPureErrorResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === 'error' && typeof (value as ToolResult).error === 'string'
}

/**
 * Post-layout verification hook (second line of defense for fake success).
 *
 * `computeAllLayouts` runs after the tool's execute in the app wrapper layer
 * and may overwrite a resize back to the Yoga-computed size (flex HUG axis).
 * Call this after recompute to diff requested vs actual size for node_resize
 * and update_node width/height, and surface any divergence as a warning.
 */
export function appendPostComputeWarnings(
  figma: FigmaAPI,
  defName: string,
  args: Record<string, unknown>,
  execResult: unknown
): unknown {
  if (isPureErrorResult(execResult)) return execResult
  const warnings: string[] = []

  if (defName === 'node_resize') {
    const { id, width, height } = args
    if (typeof id === 'string' && typeof width === 'number' && typeof height === 'number') {
      const node = figma.getNodeById(id)
      if (node) {
        const actualWidth = node.width
        const actualHeight = node.height
        if (
          Math.abs(actualWidth - width) > 0.001 ||
          Math.abs(actualHeight - height) > 0.001
        ) {
          warnings.push(
            `尺寸被布局引擎覆盖（flex HUG），实际 width=${actualWidth} height=${actualHeight}`
          )
        }
      }
    }
  } else if (defName === 'update_node') {
    const { id, width, height } = args
    if (typeof id === 'string' && (typeof width === 'number' || typeof height === 'number')) {
      const node = figma.getNodeById(id)
      if (node) {
        const requestedWidth = typeof width === 'number' ? width : node.width
        const requestedHeight = typeof height === 'number' ? height : node.height
        if (
          Math.abs(node.width - requestedWidth) > 0.001 ||
          Math.abs(node.height - requestedHeight) > 0.001
        ) {
          warnings.push(
            `尺寸被布局引擎覆盖（flex HUG），实际 width=${node.width} height=${node.height}`
          )
        }
      }
    }
  }

  return withWarnings(execResult, warnings)
}
