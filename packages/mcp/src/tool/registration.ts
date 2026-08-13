import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { encodeBase64 } from '@open-pencil/core/bytes'
import { ALL_TOOLS, CODEGEN_PROMPT } from '@open-pencil/core/tools'

import type { RPCJSONObject } from '#mcp/json'
import { MAX_RESULT_BYTES, fail, ok, resultTooLargeMessage } from '#mcp/result'
import type { MCPResult } from '#mcp/result'
import { resolveSafePath, writeToolOutput } from '#mcp/tool/output'
import { paramToZod } from '#mcp/tool/schema'

export type RPCSender = (body: Record<string, unknown>) => Promise<unknown>

/** RPC 响应中的 graphReplaced 标记：浏览器 replaceGraph 重建后首个响应带它（P0-1 方案 b）。 */
interface RPCResponse {
  ok?: boolean
  result?: unknown
  error?: string
  graphReplaced?: boolean
}

/** 兼容旧工具的双保险：sendRPC 成功但 result 是纯 {error} 对象时转 fail（P0-3）。 */
function isPureErrorResult(value: unknown): value is { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  if (keys.length !== 1 || keys[0] !== 'error') return false
  return typeof (value as { error: unknown }).error === 'string'
}

/**
 * set_image_fill 的 image_path 模式：服务端从 MCP root 读图文件转 base64，
 * 绕开「base64 经 SSH 命令行内联传参」的截断限制（P1）。返回替换后的 args。
 */
async function resolveImagePathArg(
  toolArgs: Record<string, unknown>,
  root: string | null
): Promise<Record<string, unknown>> {
  if (toolArgs.image_path === undefined || !root) return toolArgs
  const imagePath = toolArgs.image_path
  if (typeof imagePath !== 'string') return toolArgs
  const { realPath } = await resolveSafePath(imagePath, root)
  const bytes = await readFile(realPath)
  const base64 = encodeBase64(bytes)
  const { image_path: _omit, ...rest } = toolArgs
  return { ...rest, image_data: base64 }
}

/** 重建通知：把 graphReplaced 提示拼进 ok() 结果，提醒 AI 重取 id 表。 */
function withGraphReplacedNotice(result: MCPResult): MCPResult {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  return {
    ...result,
    content: [
      {
        type: 'text' as const,
        text: `${text}\n\n⚠️ graph:replaced — 文档已重建，节点 id 已重排。请重新调用 get_page_tree 获取最新 id，再引用节点。`
      }
    ]
  }
}

/** 把 warning 追加进文本结果（不回滚、不阻断，仅提示）。 */
function withWarning(result: MCPResult, warning: string): MCPResult {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  return {
    ...result,
    content: [{ type: 'text' as const, text: `${text}\n\n⚠️ ${warning}` }]
  }
}

/** 取浏览器当前打开目标文档的绝对 path；查不到/失败时返回 undefined（不阻断保存）。 */
async function openDocumentPath(
  sendRPC: RPCSender,
  target: { document_id?: string },
  resolvedRoot: string
): Promise<string | undefined> {
  try {
    const result = (await sendRPC({ command: 'list_documents', args: {} })) as {
      ok?: boolean
      result?: {
        documents?: Array<{ id?: string; path?: string; active?: boolean }>
      }
    }
    if (result.ok === false) return undefined
    const docs = result.result?.documents ?? []
    const doc = target.document_id
      ? docs.find((d) => d.id === target.document_id)
      : (docs.find((d) => d.active) ?? docs[0])
    if (!doc?.path) return undefined
    return resolve(isAbsolute(doc.path) ? doc.path : resolve(resolvedRoot, doc.path))
  } catch {
    return undefined
  }
}

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
  sendRPC: RPCSender
}

export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions) {
  const { enableEval, sendRPC } = options
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
          const resolvedArgs =
            def.name === 'set_image_fill'
              ? await resolveImagePathArg(toolArgs, resolvedRoot)
              : toolArgs
          const result = await sendRPC({
            command: 'tool',
            args: { ...target, name: def.name, args: resolvedArgs }
          })
          const res = result as RPCResponse
          if (res.ok === false) return fail(new Error(res.error ?? 'Tool failed'))
          const r = res.result as RPCJSONObject | undefined
          // 双保险：旧工具仍可能返回纯 {error} 对象 → 转 fail（P0-3）。
          if (isPureErrorResult(r)) return fail(new Error(r.error))
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
          const out = ok(r, def.name)
          if (res.graphReplaced) return withGraphReplacedNotice(out)
          return out
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
        const result = await sendRPC({ command: 'list_documents', args: {} })
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

        // 路径一致性校验：浏览器已打开文档时，相对 path 按 MCP root 解析可能写到新文件，
        // 刷新会回到旧文件（假象「图片全丢」）。仅提示，不回滚不阻断。
        let pathWarning: string | undefined
        if (safePath && resolvedRoot) {
          const currentPath = await openDocumentPath(sendRPC, target, resolvedRoot)
          if (currentPath && resolve(safePath.realPath) !== currentPath) {
            pathWarning = `保存路径 ${safePath.resolved} 与浏览器当前打开文件 ${currentPath} 不一致，将写入新文件；覆盖当前文档请不传 path`
          }
        }

        const result = await sendRPC({
          command: 'save_file',
          args: { ...target, path: safePath?.realPath }
        })
        const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
        const out = ok({
          saved: true,
          ...(safePath ? { path: safePath.resolved } : {}),
          ...(res.target ? { target: res.target } : {})
        })
        return pathWarning ? withWarning(out, pathWarning) : out
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
          const result = await sendRPC({
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
          const result = await sendRPC({
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
    async (args: { steps?: unknown; document_id?: string; page_id?: string }) => {
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
          const toolArgs =
            tool === 'set_image_fill' ? await resolveImagePathArg(resolvedArgs, resolvedRoot) : resolvedArgs
          const result = await sendRPC({
            command: 'tool',
            args: { ...target, name: tool, args: toolArgs }
          })
          const res = result as RPCResponse
          if (res.ok === false) {
            results.push({ index, tool, ok: false, error: res.error ?? 'tool failed' })
            continue
          }
          const r = res.result as RPCJSONObject | undefined
          if (isPureErrorResult(r)) {
            results.push({ index, tool, ok: false, error: r.error })
            continue
          }
          results.push({ index, tool, ok: true, id: extractResultId(r), result: r })
          if (res.graphReplaced) {
            results.push({
              index,
              tool: 'graph:replaced',
              ok: false,
              error: '文档已重建，节点 id 已重排。请停止当前 batch，重新 get_page_tree 获取最新 id 后再继续。'
            })
          }
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
function extractResultId(result: RPCJSONObject | undefined): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  if (typeof result.id === 'string') return result.id
  if (Array.isArray(result.results)) {
    for (const item of result.results) {
      if (item && typeof item === 'object' && typeof (item as RPCJSONObject).id === 'string') {
        return (item as RPCJSONObject).id as string
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
