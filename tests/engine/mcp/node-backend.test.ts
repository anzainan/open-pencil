import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNodeRPCBackend } from '#mcp/node-rpc-backend'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

interface RPCResponse {
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
    const backend = createNodeRPCBackend({ mcpRoot: root })
    const savePath = join(root, 'login.fig')

    const created = (await backend.sendRPC({
      command: 'new_document',
      args: { path: savePath }
    })) as RPCResponse
    expect(created.ok).toBe(true)
    const documentId = expectDefined(created.target?.document_id, 'document_id')

    const render = (await backend.sendRPC({
      command: 'tool',
      args: {
        document_id: documentId,
        name: 'render',
        args: {
          jsx: '<Frame name="Card" w={200} h={100} bg="#FFF"><Text>Hello</Text></Frame>'
        }
      }
    })) as RPCResponse
    expect(render.ok).toBe(true)
    const frameId = (render.result as { id: string }).id

    const describe = (await backend.sendRPC({
      command: 'tool',
      args: { document_id: documentId, name: 'describe', args: { id: frameId } }
    })) as RPCResponse
    expect(describe.ok).toBe(true)
    const report = describe.result as { name: string }
    expect(report.name).toBe('Card')

    const saved = (await backend.sendRPC({
      command: 'save_file',
      args: { document_id: documentId, path: savePath }
    })) as RPCResponse
    expect(saved.ok).toBe(true)
    const bytes = await readFile(savePath)
    expect(bytes.byteLength).toBeGreaterThan(100)

    // reopen from disk in a fresh backend
    const backend2 = createNodeRPCBackend({ mcpRoot: root })
    const opened = (await backend2.sendRPC({
      command: 'open_file',
      args: { path: savePath }
    })) as RPCResponse
    expect(opened.ok).toBe(true)
    const listed = (await backend2.sendRPC({ command: 'list_documents', args: {} })) as RPCResponse
    const documents = (listed.result as DocumentListResult).documents
    expect(documents.length).toBe(1)
    expect(documents[0].name).toBe('login.fig')
    expect(documents[0].pages.length).toBe(1)
  })

  test('tool without an open document auto-opens the first .fig under mcpRoot', async () => {
    const root = await tmpDir()
    // seed a file via a first backend
    const seed = createNodeRPCBackend({ mcpRoot: root })
    const savePath = join(root, 'seed.fig')
    await seed.sendRPC({ command: 'new_document', args: { path: savePath } })
    await seed.sendRPC({
      command: 'save_file',
      args: { document_id: `file:${savePath}`, path: savePath }
    })
    seed.close()

    const backend = createNodeRPCBackend({ mcpRoot: root })
    const tree = (await backend.sendRPC({
      command: 'tree',
      args: {}
    })) as RPCResponse
    expect(tree.ok).toBe(true)
    const result = tree.result as TreeNodeResult
    expect(Array.isArray(result.children)).toBe(true)
  })

  test('eval and selection command shapes work headlessly', async () => {
    const backend = createNodeRPCBackend({ mcpRoot: null })
    const created = (await backend.sendRPC({ command: 'new_document', args: {} })) as RPCResponse
    expect(created.ok).toBe(true)
    const documentId = expectDefined(created.target?.document_id, 'document_id')

    const evalResult = (await backend.sendRPC({
      command: 'eval',
      args: { document_id: documentId, code: 'const f = figma.createFrame(); f.name = "X"; return 1' }
    })) as RPCResponse
    expect(evalResult.ok).toBe(true)

    const selection = (await backend.sendRPC({
      command: 'selection',
      args: { document_id: documentId }
    })) as RPCResponse
    expect(selection.ok).toBe(true)
    expect(selection.result).toEqual([])

    const unknown = (await backend.sendRPC({ command: 'nope', args: {} })) as RPCResponse
    expect(unknown.ok).toBe(false)
    backend.close()
  })

  test('registers workspace fonts so CJK text measures with real glyph metrics', async () => {
    const root = await tmpDir()
    // Seed a fonts/ dir next to mcpRoot the way a real workspace does.
    await mkdir(join(root, 'fonts'))
    await copyFile(
      repoPath('tests/fixtures/fonts/NotoSansCJK-Test.otf'),
      join(root, 'fonts', 'NotoSansCJK-Test.otf')
    )

    const backend = createNodeRPCBackend({ mcpRoot: root })
    const created = (await backend.sendRPC({
      command: 'new_document',
      args: { path: join(root, 'cjk.fig') }
    })) as RPCResponse
    expect(created.ok).toBe(true)
    const documentId = expectDefined(created.target?.document_id, 'document_id')

    // Build an auto-layout frame containing a CJK text node with WIDTH_AND_HEIGHT.
    const built = (await backend.sendRPC({
      command: 'eval',
      args: {
        document_id: documentId,
        code: `
          const frame = figma.createFrame()
          frame.name = 'CJK'
          frame.resize(300, 200)
          frame.layoutMode = 'VERTICAL'
          frame.primaryAxisSizing = 'HUG'
          frame.counterAxisSizing = 'HUG'
          const text = figma.createText()
          text.name = 'Title'
          text.characters = '欢迎回来'
          text.fontSize = 40
          text.fontName = { family: 'Noto Sans CJK SC', style: 'Regular' }
          text.textAutoResize = 'WIDTH_AND_HEIGHT'
          frame.appendChild(text)
        `
      }
    })) as RPCResponse
    expect(built.ok).toBe(true)

    // Read back the measured text node size after computeAllLayouts.
    const read = (await backend.sendRPC({
      command: 'eval',
      args: {
        document_id: documentId,
        code: `
          const frame = figma.currentPage.children[0]
          const text = frame.children[0]
          return { width: text.width, height: text.height }
        `
      }
    })) as RPCResponse
    expect(read.ok).toBe(true)
    const measured = read.result as { width: number; height: number }

    // 4 full-width CJK chars at 40px ≈ 160px wide (1.0em/char), not the 0.6×
    // fallback estimate (96px). Line height uses real font metrics (≈58px).
    expect(measured.width).toBe(160)
    expect(measured.height).toBeGreaterThan(40)
    expect(measured.height).toBeLessThan(90)
    backend.close()
  })
})
