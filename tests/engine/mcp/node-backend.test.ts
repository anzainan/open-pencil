import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNodeRpcBackend } from '#mcp/node-rpc-backend'

import { expectDefined } from '#tests/helpers/assert'

interface RpcResponse {
  ok: boolean
  result?: unknown
  target?: { document_id?: string; page_id?: string }
  error?: string
}

interface TreeNodeResult {
  children: unknown[]
}

interface DocumentListResult {
  documents: Array<{ name: string; pages: unknown[] }>
}

let dirs: string[] = []

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'op-mcp-node-backend-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('node-rpc-backend (headless MCP editing without a browser)', () => {
  test('new_document → tool render → describe → save_file → reopen', async () => {
    const root = await tmpDir()
    const backend = createNodeRpcBackend({ mcpRoot: root })
    const savePath = join(root, 'login.fig')

    const created = (await backend.sendRpc({
      command: 'new_document',
      args: { path: savePath }
    })) as RpcResponse
    expect(created.ok).toBe(true)
    const documentId = expectDefined(created.target?.document_id, 'document_id')

    const render = (await backend.sendRpc({
      command: 'tool',
      args: {
        document_id: documentId,
        name: 'render',
        args: {
          jsx: '<Frame name="Card" w={200} h={100} bg="#FFF"><Text>Hello</Text></Frame>'
        }
      }
    })) as RpcResponse
    expect(render.ok).toBe(true)
    const frameId = (render.result as { id: string }).id

    const describe = (await backend.sendRpc({
      command: 'tool',
      args: { document_id: documentId, name: 'describe', args: { id: frameId } }
    })) as RpcResponse
    expect(describe.ok).toBe(true)
    const report = describe.result as { name: string }
    expect(report.name).toBe('Card')

    const saved = (await backend.sendRpc({
      command: 'save_file',
      args: { document_id: documentId, path: savePath }
    })) as RpcResponse
    expect(saved.ok).toBe(true)
    const bytes = await readFile(savePath)
    expect(bytes.byteLength).toBeGreaterThan(100)

    // reopen from disk in a fresh backend
    const backend2 = createNodeRpcBackend({ mcpRoot: root })
    const opened = (await backend2.sendRpc({
      command: 'open_file',
      args: { path: savePath }
    })) as RpcResponse
    expect(opened.ok).toBe(true)
    const listed = (await backend2.sendRpc({ command: 'list_documents', args: {} })) as RpcResponse
    const documents = (listed.result as DocumentListResult).documents
    expect(documents.length).toBe(1)
    expect(documents[0].name).toBe('login.fig')
    expect(documents[0].pages.length).toBe(1)
  })

  test('tool without an open document auto-opens the first .fig under mcpRoot', async () => {
    const root = await tmpDir()
    // seed a file via a first backend
    const seed = createNodeRpcBackend({ mcpRoot: root })
    const savePath = join(root, 'seed.fig')
    await seed.sendRpc({ command: 'new_document', args: { path: savePath } })
    await seed.sendRpc({
      command: 'save_file',
      args: { document_id: `file:${savePath}`, path: savePath }
    })
    seed.close()

    const backend = createNodeRpcBackend({ mcpRoot: root })
    const tree = (await backend.sendRpc({
      command: 'tree',
      args: {}
    })) as RpcResponse
    expect(tree.ok).toBe(true)
    const result = tree.result as TreeNodeResult
    expect(Array.isArray(result.children)).toBe(true)
  })

  test('eval and selection command shapes work headlessly', async () => {
    const backend = createNodeRpcBackend({ mcpRoot: null })
    const created = (await backend.sendRpc({ command: 'new_document', args: {} })) as RpcResponse
    expect(created.ok).toBe(true)
    const documentId = expectDefined(created.target?.document_id, 'document_id')

    const evalResult = (await backend.sendRpc({
      command: 'eval',
      args: { document_id: documentId, code: 'const f = figma.createFrame(); f.name = "X"; return 1' }
    })) as RpcResponse
    expect(evalResult.ok).toBe(true)

    const selection = (await backend.sendRpc({
      command: 'selection',
      args: { document_id: documentId }
    })) as RpcResponse
    expect(selection.ok).toBe(true)
    expect(selection.result).toEqual([])

    const unknown = (await backend.sendRpc({ command: 'nope', args: {} })) as RpcResponse
    expect(unknown.ok).toBe(false)
    backend.close()
  })
})
