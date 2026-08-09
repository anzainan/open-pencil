import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ALL_TOOLS, CODEGEN_PROMPT } from '@open-pencil/core/tools'

import type { RpcJsonObject } from '#mcp/json'
import { MAX_RESULT_BYTES, fail, ok, resultTooLargeMessage } from '#mcp/result'
import { resolveSafePath, writeToolOutput } from '#mcp/tool/output'
import { paramToZod } from '#mcp/tool/schema'

export type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

const automationTargetSchema = {
  document_id: z.string().describe('Optional OpenPencil document/tab ID to target').optional(),
  page_id: z.string().describe('Optional page ID to target within the document').optional()
}

function splitAutomationTarget(args: Record<string, unknown>): {
  target: { document_id?: string; page_id?: string }
  args: Record<string, unknown>
} {
  const { document_id, page_id, ...rest } = args
  return {
    target: {
      ...(typeof document_id === 'string' ? { document_id } : {}),
      ...(typeof page_id === 'string' ? { page_id } : {})
    },
    args: rest
  }
}

export interface RegisterToolsOptions {
  enableEval: boolean
  mcpRoot?: string | null
  sendRpc: RpcSender
}

export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions) {
  const { enableEval, sendRpc } = options
  const resolvedRoot = options.mcpRoot ? resolve(options.mcpRoot) : null
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void

  for (const def of ALL_TOOLS) {
    if (!enableEval && def.name === 'eval') continue
    const shape: Record<string, z.ZodType> = {}
    for (const [key, param] of Object.entries(def.params)) {
      shape[key] = paramToZod(param)
    }
    register(
      def.name,
      {
        description: def.description,
        inputSchema: z.object({ ...shape, ...automationTargetSchema })
      },
      async (args: Record<string, unknown>) => {
        try {
          const { target, args: toolArgs } = splitAutomationTarget(args)
          const result = await sendRpc({
            command: 'tool',
            args: { ...target, name: def.name, args: toolArgs }
          })
          const res = result as { ok?: boolean; result?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
          const r = res.result as RpcJsonObject | undefined
          const filePath = typeof toolArgs.path === 'string' ? toolArgs.path : null
          if (r && filePath && resolvedRoot) {
            const written = await writeToolOutput(def.name, r, filePath, resolvedRoot)
            if (written) return written
          }
          if (r && 'base64' in r && 'mimeType' in r) {
            const base64 = String(r.base64)
            const bytes = Buffer.byteLength(base64, 'utf8')
            if (bytes > MAX_RESULT_BYTES) {
              return fail(
                new Error(
                  resultTooLargeMessage(
                    `Image from "${def.name}"`,
                    bytes,
                    'Export a smaller region or lower the scale/resolution.'
                  )
                )
              )
            }
            return {
              content: [
                {
                  type: 'image' as const,
                  data: base64,
                  mimeType: r.mimeType as string
                }
              ]
            }
          }
          return ok(r, def.name)
        } catch (e) {
          return fail(e)
        }
      }
    )
  }

  register(
    'list_documents',
    {
      description:
        'List open OpenPencil documents/tabs with their IDs, file paths, current pages, and pages.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const result = await sendRpc({ command: 'list_documents', args: {} })
        const res = result as { ok?: boolean; result?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
        return ok(res.result ?? {})
      } catch (e) {
        return fail(e)
      }
    }
  )

  register(
    'save_file',
    {
      description: resolvedRoot
        ? `Save the current document to disk. If path is provided, it must be inside ${resolvedRoot}.`
        : 'Save the current document to disk. Uses the existing file path if available, otherwise prompts for a location.',
      inputSchema: resolvedRoot
        ? z.object({
            path: z
              .string()
              .min(1)
              .describe('Path for the .fig file, absolute or relative to the MCP root')
              .optional(),
            ...automationTargetSchema
          })
        : z.object({ ...automationTargetSchema })
    },
    async (args: { path?: string; document_id?: string; page_id?: string }) => {
      try {
        const safePath =
          args.path !== undefined && resolvedRoot
            ? await resolveSafePath(args.path, resolvedRoot)
            : undefined
        const { target } = splitAutomationTarget(args)
        const result = await sendRpc({
          command: 'save_file',
          args: { ...target, path: safePath?.realPath }
        })
        const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
        return ok({
          saved: true,
          ...(safePath ? { path: safePath.resolved } : {}),
          ...(res.target ? { target: res.target } : {})
        })
      } catch (e) {
        return fail(e)
      }
    }
  )

  if (resolvedRoot) {
    register(
      'open_file',
      {
        description: `Open a .fig or .pen file from disk into a new tab. Path must be inside ${resolvedRoot}.`,
        inputSchema: z.object({
          path: z
            .string()
            .min(1)
            .describe('Path to the design file, absolute or relative to the MCP root'),
          ...automationTargetSchema
        })
      },
      async (args: { path: string; document_id?: string; page_id?: string }) => {
        try {
          const safe = await resolveSafePath(args.path, resolvedRoot)
          const { target } = splitAutomationTarget(args)
          const result = await sendRpc({
            command: 'open_file',
            args: { ...target, path: safe.realPath }
          })
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
          return ok({ opened: true, ...(res.target ? { target: res.target } : {}) })
        } catch (e) {
          return fail(e)
        }
      }
    )

    register(
      'new_document',
      {
        description: `Create a new empty document. Optionally set a save path inside ${resolvedRoot}.`,
        inputSchema: z.object({
          path: z
            .string()
            .min(1)
            .describe('Path for the new file, absolute or relative to the MCP root')
            .optional(),
          ...automationTargetSchema
        })
      },
      async (args: { path?: string; document_id?: string; page_id?: string }) => {
        try {
          const safePath =
            args.path !== undefined ? await resolveSafePath(args.path, resolvedRoot) : undefined
          const { target } = splitAutomationTarget(args)
          const result = await sendRpc({
            command: 'new_document',
            args: { ...target, path: safePath?.realPath }
          })
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
          return ok({ created: true, ...(res.target ? { target: res.target } : {}) })
        } catch (e) {
          return fail(e)
        }
      }
    )
  }

  register(
    'get_codegen_prompt',
    {
      description:
        'Get design-to-code generation guidelines. Call before generating frontend code.',
      inputSchema: z.object({})
    },
    async () => ok({ prompt: CODEGEN_PROMPT })
  )

  register(
    'batch',
    {
      description:
        'Run multiple tools sequentially in one session. Each step may reference the previous step result id via "$1"/"$2"... in string args (1-based step number). Returns ordered results including ids. Steps that fail are reported individually and do not abort later steps.',
      inputSchema: z.object({
        steps: z
          .array(
            z.object({
              tool: z.string().describe('Tool name, e.g. create_shape'),
              args: z
                .record(z.string(), z.unknown())
                .describe('Tool arguments. Use "$N" to reference the id returned by step N (1-based).')
                .default({})
            })
          )
          .min(1)
          .describe('Ordered list of tool calls to run'),
        ...automationTargetSchema
      })
    },
    async (args) => {
      const { target, args: rest } = splitAutomationTarget(args)
      const steps = Array.isArray(rest.steps) ? (rest.steps as unknown[]) : []
      const results: unknown[] = []
      try {
        for (let index = 0; index < steps.length; index++) {
          const candidate = steps[index]
          if (!isBatchStep(candidate)) {
            results.push({ index, tool: '', ok: false, error: 'invalid step' })
            continue
          }
          const step: BatchStep = candidate
          const tool = typeof step.tool === 'string' ? step.tool : ''
          const stepArgs = isBatchStep(step.args) ? step.args : {}
          if (!tool) {
            results.push({ index, tool: '', ok: false, error: 'missing "tool"' })
            continue
          }
          const resolvedArgs = resolveStepReferences(stepArgs, results)
          const result = await sendRpc({
            command: 'tool',
            args: { ...target, name: tool, args: resolvedArgs }
          })
          const res = result as { ok?: boolean; result?: unknown; error?: string }
          if (res.ok === false) {
            results.push({ index, tool, ok: false, error: res.error ?? 'tool failed' })
            continue
          }
          const r = res.result as RpcJsonObject | undefined
          results.push({ index, tool, ok: true, id: extractResultId(r), result: r })
        }
        return ok({ results })
      } catch (e) {
        return fail(e)
      }
    }
  )
}

interface BatchStep {
  tool?: unknown
  args?: unknown
}

/** args 里的 "$N" 引用替换依赖工具结果的 id（见 batch 工具）。 */
function isBatchStep(value: unknown): value is BatchStep {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** 提取工具结果里的节点 id（与 apply.ts extractNodeIds 同形）。 */
function extractResultId(result: RpcJsonObject | undefined): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  if (typeof result.id === 'string') return result.id
  if (Array.isArray(result.results)) {
    for (const item of result.results) {
      if (item && typeof item === 'object' && typeof (item as RpcJsonObject).id === 'string') {
        return (item as RpcJsonObject).id as string
      }
    }
  }
  return undefined
}

/** 把 args 里的 "$N"（N=步骤序号，1 起）替换成该步结果 id。只替换字符串值。 */
function resolveStepReferences(
  args: BatchStep,
  results: unknown[]
): Record<string, unknown> {
  const byIndex = new Map<number, string | undefined>()
  results.forEach((result, index) => {
    const r = result as { ok?: boolean; id?: string }
    byIndex.set(index, r.ok ? r.id : undefined)
  })
  const substitute = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(/\$(\d+)/g, (match, num: string) => {
        const stepIndex = Number(num) - 1
        const id = byIndex.get(stepIndex)
        return id ?? match
      })
    }
    if (Array.isArray(value)) return value.map(substitute)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(value)) {
        out[key] = substitute(child)
      }
      return out
    }
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) out[key] = substitute(value)
  return out
}
