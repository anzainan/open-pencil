import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from '#mcp/server'

interface RpcResponse {
  ok?: boolean
  result?: unknown
  target?: unknown
  error?: string
}

interface TreeNodeResult {
  children: unknown[]
}

describe('MCP server headless fallback (no browser connected)', () => {
  let dir: string | null = null
  let closeHandle: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (closeHandle) await closeHandle().catch(() => undefined)
    closeHandle = null
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  test('/health is no_app but /rpc tool calls work through the Node session', async () => {
    dir = await mkdtemp(join(tmpdir(), 'op-mcp-fallback-'))
    const mcpRoot = join(dir, 'design')
    await mkdir(mcpRoot, { recursive: true })
    const authToken = 'fallback-token'

    const handle = await startServer({
      httpPort: 0,
      withTcp: true,
      socketPath: null,
      authToken,
      enableEval: true,
      mcpRoot
    })
    closeHandle = handle.close
    const port = handle.httpPort
    expect(port).toBeGreaterThan(0)

    const base = `http://127.0.0.1:${port}`

    // No browser → health says no_app
    const health = (await (await fetch(`${base}/health`)).json()) as { status: string }
    expect(health.status).toBe('no_app')

    const post = async (body: unknown): Promise<RpcResponse> => {
      const resp = await fetch(`${base}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body)
      })
      expect(resp.status).toBe(200)
      return (await resp.json()) as RpcResponse
    }

    // 建 + 改 + 质检 + 落盘 via /rpc (headless)
    const created = await post({ command: 'new_document', args: { path: join(mcpRoot, 'x.fig') } })
    expect(created.ok).toBe(true)
    const documentId = (created.target as { document_id?: string }).document_id
    expect(documentId).toBeDefined()

    const render = await post({
      command: 'tool',
      args: {
        document_id: documentId,
        name: 'render',
        args: { jsx: '<Frame name="Card" w={120} h={80} bg="#FFF"><Text>Hi</Text></Frame>' }
      }
    })
    expect(render.ok).toBe(true)
    const frameId = (render.result as { id: string }).id

    const describe = await post({
      command: 'tool',
      args: { document_id: documentId, name: 'describe', args: { id: frameId } }
    })
    expect(describe.ok).toBe(true)

    const saved = await post({
      command: 'save_file',
      args: { document_id: documentId, path: join(mcpRoot, 'x.fig') }
    })
    expect(saved.ok).toBe(true)

    // Browser reconnecting later must NOT change the browser-forwarded path —
    // covered by the existing browser-rpc tests; here we assert headless worked.
    const tree = await post({ command: 'tree', args: {} })
    expect(tree.ok).toBe(true)
    const result = tree.result as TreeNodeResult
    expect(Array.isArray(result.children)).toBe(true)
  })
})
