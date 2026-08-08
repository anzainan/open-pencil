import { statSync } from 'node:fs'

import { scanDesignRoot, fileMeta } from './lib/design'
import { isSafeRelativePath, resolveDesignPath } from './lib/paths'
import type { StateStore } from './lib/state'

/**
 * file-bridge 内置 MCP 端点（零依赖，Streamable HTTP 传输子集）。
 *
 * 设计原则：CLI 脚本（scripts/ai/op-*）仍是 AI 协作主路径；MCP 是可选加分项，
 * 让 AI 工具链（OpenClaw / Claude / Cursor 等）原生感知文件状态。
 * 不引入 @modelcontextprotocol/sdk 依赖（避免重型 npm install），手写最小 JSON-RPC。
 *
 * 路径：默认挂载在 `/mcp`；当容器开启了上游 MCP server（`MCP_AUTH_TOKEN` 非空，
 * 见 `mcp-proxy.ts`）时，`/mcp` 让位给上游（110 个画布工具），本桥接工具改挂
 * `/bridge-mcp`，两者并存。
 *
 * 暴露工具：
 *   bridge_get_active   → { path?, openedAt?, updatedAt? }            只读
 *   bridge_get_recent   → { recents: [{path, openedAt}] }             只读
 *   bridge_list_files   → { groups, flat }                            只读
 *   bridge_read_file    → { content(base64), size, mtime, text? }     只读
 *   bridge_write_file   → { path, size }（需 BRIDGE_TOKEN）           写
 *   bridge_set_active   → active 记录（需 BRIDGE_TOKEN）               写
 *
 * OpenClaw 注册示例（openclaw 配置的 MCP servers）：
 *   "openpencil-bridge": {
 *     "type": "http",
 *     "url": "http://<openpencil-host>:8080/mcp",
 *     "headers": { "Authorization": "Bearer <BRIDGE_TOKEN>" }
 *   }
 * 注：不同客户端对 Streamable HTTP 的支持程度不一，写类工具需要服务端同一 token。
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18'

export interface McpDeps {
  designRoot: string
  state: StateStore
  token: string
}

const SERVER_INFO = { name: 'openpencil-file-bridge', version: '0.2.0' }

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

const TOOL_DEFS = [
  {
    name: 'bridge_get_active',
    description: 'Get the currently active design file (the one open in the web editor). Returns { path?, openedAt?, updatedAt? }.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'bridge_get_recent',
    description: 'List recently opened design files, newest first. Returns { recents: [{ path, openedAt }] }.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'bridge_list_files',
    description: 'List all design files under the design root, grouped by brand. Returns { groups, flat }.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'bridge_read_file',
    description: 'Read a design file (relative path like PixelMob/login.fig). Returns base64 content + metadata; .pen also gets a text preview. Prefer the openpencil CLI (op eval/op tree) for scene-level reads.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path under design root, e.g. PixelMob/login.fig' } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'bridge_write_file',
    description: 'Write raw bytes (base64) to a design file (relative path). Requires BRIDGE_TOKEN. Prefer openpencil CLI eval --write for scene-level edits.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path under design root, e.g. PixelMob/login.fig' },
        data: { type: 'string', description: 'File bytes encoded as base64' }
      },
      required: ['path', 'data'],
      additionalProperties: false
    }
  },
  {
    name: 'bridge_set_active',
    description: 'Mark a file as the currently active design file. Requires BRIDGE_TOKEN.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path under design root, e.g. PixelMob/login.fig' } },
      required: ['path'],
      additionalProperties: false
    }
  }
]

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function textContent(text: string) {
  return { content: [{ type: 'text', text }] }
}

function isAuthorized(header: string | null, token: string): boolean {
  if (!token) return false
  return header === `Bearer ${token}`
}

/** 处理单个 JSON-RPC 消息；notification 返回 null（无需响应体）。 */
async function handleMessage(msg: JsonRpcRequest, deps: McpDeps, authHeader: string): Promise<unknown> {
  const { id, method, params = {} } = msg

  switch (method) {
    case 'initialize': {
      const version = MCP_PROTOCOL_VERSION
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO
      })
    }
    case 'notifications/initialized':
      return null
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: TOOL_DEFS })
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const tool = TOOL_DEFS.find((t) => t.name === name)
      if (!tool) return rpcError(id, -32601, `Unknown tool: ${name}`)

      try {
        switch (name) {
          case 'bridge_get_active':
            return rpcResult(id, textContent(JSON.stringify(deps.state.getActive(), null, 2)))
          case 'bridge_get_recent':
            return rpcResult(id, textContent(JSON.stringify({ recents: deps.state.getRecent() }, null, 2)))
          case 'bridge_list_files': {
            const listing = scanDesignRoot(deps.designRoot)
            return rpcResult(id, textContent(JSON.stringify(listing, null, 2)))
          }
          case 'bridge_read_file': {
            const rel = typeof args.path === 'string' ? args.path : ''
            if (!isSafeRelativePath(rel)) return rpcResult(id, textContent('ERROR: invalid path'))
            const full = resolveDesignPath(deps.designRoot, rel)
            if (!full) return rpcResult(id, textContent('ERROR: unsafe path'))
            try {
              const meta = fileMeta(deps.designRoot, rel)
              if (!meta) return rpcResult(id, textContent('ERROR: not found'))
              const buf = await Bun.file(full).arrayBuffer()
              const bytes = new Uint8Array(buf)
              const b64 = Buffer.from(bytes).toString('base64')
              const isPen = /\.pen$/i.test(rel)
              const payload: Record<string, unknown> = {
                path: rel,
                size: meta.size,
                mtime: meta.mtime,
                contentBase64: b64
              }
              if (isPen) {
                payload.text = new TextDecoder().decode(bytes)
              }
              return rpcResult(id, textContent(JSON.stringify(payload, null, 2)))
            } catch (error) {
              return rpcResult(id, textContent(`ERROR: read failed: ${String(error)}`))
            }
          }
          case 'bridge_write_file': {
            const rel = typeof args.path === 'string' ? args.path : ''
            const data = typeof args.data === 'string' ? args.data : ''
            if (!isSafeRelativePath(rel)) return rpcResult(id, textContent('ERROR: invalid path'))
            if (!isAuthorized(authHeader, deps.token)) {
              return rpcResult(id, textContent('ERROR: unauthorized (BRIDGE_TOKEN required)'))
            }
            const full = resolveDesignPath(deps.designRoot, rel)
            if (!full) return rpcResult(id, textContent('ERROR: unsafe path'))
            try {
              const bytes = Buffer.from(data, 'base64')
              await Bun.write(full, bytes)
              const meta = fileMeta(deps.designRoot, rel)
              return rpcResult(id, textContent(JSON.stringify({ path: rel, size: meta?.size ?? bytes.length })))
            } catch (error) {
              return rpcResult(id, textContent(`ERROR: write failed: ${String(error)}`))
            }
          }
          case 'bridge_set_active': {
            const rel = typeof args.path === 'string' ? args.path : ''
            if (!isSafeRelativePath(rel)) return rpcResult(id, textContent('ERROR: invalid path'))
            if (!isAuthorized(authHeader, deps.token)) {
              return rpcResult(id, textContent('ERROR: unauthorized (BRIDGE_TOKEN required)'))
            }
            const active = deps.state.setActive(rel)
            return rpcResult(id, textContent(JSON.stringify(active, null, 2)))
          }
          default:
            return rpcError(id, -32601, `Unknown tool: ${name}`)
        }
      } catch (error) {
        return rpcError(id, -32603, `Tool execution failed: ${String(error)}`)
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

/**
 * 处理 POST /mcp 请求。
 * 返回 200 JSON-RPC 响应；notification 返回 202 空响应；解析失败 400。
 */
export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'MCP endpoint requires POST' } }, { status: 405 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization') ?? ''

  if (Array.isArray(body)) {
    // 批量消息：逐个处理
    const responses: unknown[] = []
    for (const msg of body) {
      const m = msg as JsonRpcRequest
      if (!m || typeof m.method !== 'string') continue
      const result = await handleMessage(m, deps, authHeader)
      if (result !== null && result !== undefined) responses.push(result)
    }
    if (responses.length === 0) return new Response(null, { status: 202 })
    return Response.json(responses, { headers: { 'Content-Type': 'application/json' } })
  }

  const msg = body as JsonRpcRequest
  if (!msg || typeof msg.method !== 'string') {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, { status: 400 })
  }

  const result = await handleMessage(msg, deps, authHeader)

  if (result === null || result === undefined) {
    return new Response(null, { status: 202 })
  }
  return Response.json(result, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id'
    }
  })
}

/** 轻量校验：statSync 存在即可（用于 server 路由处判定设计文件）。 */
export function mcpFileExists(full: string): boolean {
  try {
    return statSync(full).isFile()
  } catch {
    return false
  }
}
