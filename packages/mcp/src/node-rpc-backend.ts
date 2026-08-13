import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import { encodeBase64 } from '@open-pencil/core/bytes'
import { HeadlessEditSession } from '@open-pencil/core/editor'
import { BUILTIN_IO_FORMATS, IORegistry, headlessRenderNodes } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { executeRPCCommand } from '@open-pencil/core/rpc'
import { registerWorkspaceFontFiles, scanFontDirectory } from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const DESIGN_EXTENSIONS = new Set(['.fig', '.pen'])
const READ_COMMANDS = new Set([
  'tree',
  'find',
  'query',
  'node',
  'pages',
  'info',
  'describe',
  'variables'
])

export interface NodeRPCBackendOptions {
  /** Workspace root; used to discover/auto-open .fig/.pen files. */
  mcpRoot?: string | null
}

interface SessionRecord {
  session: HeadlessEditSession
  path: string | null
  createdAt: number
}

export interface RPCResponse {
  ok: boolean
  result?: unknown
  target?: { document_id?: string; page_id?: string }
  error?: string
}

/**
 * Node-side RPC backend that runs the same pure-core tool engine as the
 * browser automation bridge, against in-memory SceneGraph sessions. Used by
 * the MCP server when the browser app is offline (or an RPC times out), so
 * render/batch_update/describe/save_file etc. keep working headlessly.
 */
export function createNodeRPCBackend(options: NodeRPCBackendOptions) {
  const mcpRoot = options.mcpRoot ? resolve(options.mcpRoot) : null
  const sessions = new Map<string, SessionRecord>()
  let defaultSessionId: string | null = null

  // Register workspace fonts before any session measures text, so headless
  // Node edits use real glyph metrics (CJK ≈1em/char) instead of the 0.6×
  // estimate fallback. Mirrors the CLI eval/export font registration path.
  const fontsReady = registerWorkspaceFontDirectories([
    ...(mcpRoot ? [resolve(mcpRoot, 'fonts')] : []),
    resolve(process.cwd(), 'fonts')
  ])

  function sessionDocumentId(path: string): string {
    return `file:${resolve(path)}`
  }

  async function loadGraphFromFile(path: string): Promise<SceneGraph> {
    const bytes = new Uint8Array(await readFile(path))
    const { graph } = await io.readDocument({ name: path, data: bytes })
    computeAllLayouts(graph)
    return graph
  }

  async function openFileIntoSession(
    path: string
  ): Promise<{ documentId: string; pageId: string }> {
    const absPath = resolve(path)
    const documentId = sessionDocumentId(absPath)
    const existing = sessions.get(documentId)
    if (existing) {
      defaultSessionId = documentId
      return { documentId, pageId: existing.session.currentPageId }
    }
    const graph = await loadGraphFromFile(absPath)
    const session = new HeadlessEditSession({ graph, filePath: absPath })
    sessions.set(documentId, { session, path: absPath, createdAt: Date.now() })
    defaultSessionId = documentId
    return { documentId, pageId: session.currentPageId }
  }

  function createEmptySession(path: string | null): { documentId: string; pageId: string } {
    const graph = new SceneGraph()
    const session = new HeadlessEditSession({ graph, filePath: path })
    const documentId = path ? sessionDocumentId(path) : `session:${randomUUID()}`
    sessions.set(documentId, { session, path, createdAt: Date.now() })
    defaultSessionId = documentId
    return { documentId, pageId: session.currentPageId }
  }

  /** Resolve the target session: explicit document_id, default, or first file under mcpRoot. */
  async function resolveSession(
    documentId?: string
  ): Promise<{ record: SessionRecord; documentId: string } | null> {
    if (documentId && sessions.has(documentId)) {
      return { record: sessions.get(documentId) as SessionRecord, documentId }
    }
    if (defaultSessionId && sessions.has(defaultSessionId)) {
      return {
        record: sessions.get(defaultSessionId) as SessionRecord,
        documentId: defaultSessionId
      }
    }
    if (mcpRoot) {
      const { readdir } = await import('node:fs/promises')
      let names: string[] = []
      try {
        names = await readdir(mcpRoot)
      } catch {
        return null
      }
      const first = names.find((name) => DESIGN_EXTENSIONS.has(extname(name).toLowerCase()))
      if (first) {
        const opened = await openFileIntoSession(join(mcpRoot, first))
        return {
          record: sessions.get(opened.documentId) as SessionRecord,
          documentId: opened.documentId
        }
      }
    }
    return null
  }

  function targetOf(documentId: string, pageId: string): RPCResponse['target'] {
    return { document_id: documentId, page_id: pageId }
  }

  async function handleListDocuments(): Promise<RPCResponse> {
    const documents: Array<{
      id: string
      name: string
      path?: string
      active: boolean
      current_page_id: string
      current_page_name: string
      pages: Array<{ id: string; name: string }>
    }> = []
    for (const [documentId, record] of sessions) {
      const page = record.session.graph.getNode(record.session.currentPageId)
      documents.push({
        id: documentId,
        name: record.path ? basename(record.path) : documentId,
        ...(record.path ? { path: record.path } : {}),
        active: documentId === defaultSessionId,
        current_page_id: record.session.currentPageId,
        current_page_name: page?.name ?? 'Page 1',
        pages: record.session.pages()
      })
    }
    if (documents.length === 0 && mcpRoot) {
      const { readdir } = await import('node:fs/promises')
      try {
        const names = (await readdir(mcpRoot)).filter((name) =>
          DESIGN_EXTENSIONS.has(extname(name).toLowerCase())
        )
        for (const name of names) {
          const id = sessionDocumentId(join(mcpRoot, name))
          documents.push({
            id,
            name,
            path: join(mcpRoot, name),
            active: false,
            current_page_id: '',
            current_page_name: '',
            pages: []
          })
        }
      } catch (error) {
        // mcpRoot unreadable → empty document list
        console.warn('[node-rpc-backend] 无法读取 mcpRoot 目录:', error)
      }
    }
    return { ok: true, result: { documents } }
  }

  async function handleTool(
    documentId: string | undefined,
    pageId: string | undefined,
    name: string,
    args: Record<string, unknown>
  ): Promise<RPCResponse> {
    const resolved = await resolveSession(documentId)
    if (!resolved) {
      return {
        ok: false,
        error:
          'No open document. Use new_document (to create) or open_file (to open an existing .fig) first.'
      }
    }
    if (pageId && !resolved.record.session.setCurrentPage(pageId)) {
      return { ok: false, error: `Page "${pageId}" not found` }
    }
    const result = await resolved.record.session.applyTool(name, args)
    return {
      ok: result.ok,
      result: result.result,
      error: result.error,
      target: targetOf(resolved.documentId, resolved.record.session.currentPageId)
    }
  }

  async function handleEval(documentId: string | undefined, code: string): Promise<RPCResponse> {
    const resolved = await resolveSession(documentId)
    if (!resolved) {
      return {
        ok: false,
        error: 'No open document. Use new_document or open_file first.'
      }
    }
    const result = await resolved.record.session.eval(code)
    return {
      ok: result.ok,
      result: result.result,
      error: result.error,
      target: targetOf(resolved.documentId, resolved.record.session.currentPageId)
    }
  }

  async function handleReadCommand(
    documentId: string | undefined,
    command: string,
    args: Record<string, unknown>
  ): Promise<RPCResponse> {
    const resolved = await resolveSession(documentId)
    if (!resolved) {
      return {
        ok: false,
        error: 'No open document. Use new_document or open_file first.'
      }
    }
    try {
      const result = executeRPCCommand(resolved.record.session.graph, command, args)
      return {
        ok: true,
        result: await result,
        target: targetOf(resolved.documentId, resolved.record.session.currentPageId)
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async function handleExport(
    documentId: string | undefined,
    nodeIds: string[],
    scale: number,
    format: string
  ): Promise<RPCResponse> {
    const resolved = await resolveSession(documentId)
    if (!resolved) return { ok: false, error: 'No open document.' }
    const { session } = resolved.record
    if (nodeIds.length === 0) {
      return { ok: false, error: 'No nodes to export' }
    }
    const data = await headlessRenderNodes(session.graph, session.currentPageId, nodeIds, {
      scale,
      format: format.toUpperCase() as 'PNG' | 'JPG' | 'WEBP'
    })
    if (!data) return { ok: false, error: 'Export failed' }
    return {
      ok: true,
      result: { base64: encodeBase64(data), mimeType: `image/${format.toLowerCase()}` }
    }
  }

  async function handleSave(
    documentId: string | undefined,
    path: string | undefined
  ): Promise<RPCResponse> {
    const resolved = await resolveSession(documentId)
    if (!resolved) return { ok: false, error: 'No open document.' }
    const { session } = resolved.record
    const savePath = path ?? session.filePath
    if (!savePath) return { ok: false, error: 'No path provided and the session has no file path' }
    const bytes = await session.exportBytes()
    const absPath = resolve(savePath)
    await mkdir(join(absPath, '..'), { recursive: true })
    await writeFile(absPath, bytes)
    session.filePath = absPath
    return {
      ok: true,
      result: { saved: true },
      target: targetOf(resolved.documentId, session.currentPageId)
    }
  }

  async function handleNewDocument(path: string | undefined): Promise<RPCResponse> {
    const absPath = path ? resolve(path) : null
    const { documentId, pageId } = createEmptySession(absPath)
    return { ok: true, result: { created: true }, target: targetOf(documentId, pageId) }
  }

  async function handleOpenFile(path: string): Promise<RPCResponse> {
    const { documentId, pageId } = await openFileIntoSession(path)
    return { ok: true, result: { opened: true }, target: targetOf(documentId, pageId) }
  }

  interface RPCContext {
    documentId?: string
    pageId?: string
    path?: string
    args: Record<string, unknown>
  }

  const commandHandlers: Record<string, (ctx: RPCContext) => Promise<unknown>> = {
    list_documents: () => handleListDocuments(),
    new_document: ({ path }) => handleNewDocument(path),
    open_file: ({ path }) =>
      path
        ? handleOpenFile(path)
        : Promise.resolve({ ok: false, error: 'open_file requires a "path" argument' }),
    save_file: ({ documentId, path }) => handleSave(documentId, path),
    selection: () => Promise.resolve({ ok: true, result: [] }),
    tool: ({ documentId, pageId, args }) => {
      const name = typeof args.name === 'string' ? args.name : ''
      if (!name) return Promise.resolve({ ok: false, error: 'tool requires a "name" argument' })
      return handleTool(documentId, pageId, name, isRecord(args.args) ? args.args : {})
    },
    eval: ({ documentId, args }) => {
      const code = typeof args.code === 'string' ? args.code : ''
      if (!code) return Promise.resolve({ ok: false, error: 'eval requires "code"' })
      return handleEval(documentId, code)
    },
    export: ({ documentId, args }) => {
      const nodeIds = Array.isArray(args.nodeIds) ? (args.nodeIds as string[]) : []
      const scale = typeof args.scale === 'number' ? args.scale : 1
      const format = typeof args.format === 'string' ? args.format : 'PNG'
      return handleExport(documentId, nodeIds, scale, format)
    }
  }

  /** Dispatch an RPC body with the same shape the browser automation bridge uses. */
  async function sendRPC(body: Record<string, unknown>): Promise<unknown> {
    await fontsReady
    const command = typeof body.command === 'string' ? body.command : ''
    const args = isRecord(body.args) ? body.args : {}
    if (command in commandHandlers) {
      return commandHandlers[command]({
        documentId: typeof args.document_id === 'string' ? args.document_id : undefined,
        pageId: typeof args.page_id === 'string' ? args.page_id : undefined,
        path: typeof args.path === 'string' && args.path ? args.path : undefined,
        args
      })
    }
    if (READ_COMMANDS.has(command)) {
      return handleReadCommand(
        typeof args.document_id === 'string' ? args.document_id : undefined,
        command,
        args
      )
    }
    return { ok: false, error: `Unknown RPC command: ${command}` }
  }

  function close(): void {
    sessions.clear()
    defaultSessionId = null
  }

  return { sendRPC, close, sessionCount: () => sessions.size }
}

export type NodeRPCBackend = ReturnType<typeof createNodeRPCBackend>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function registerWorkspaceFontDirectories(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    const files = await scanFontDirectory(dir)
    if (files.length === 0) continue
    registerWorkspaceFontFiles(files)
  }
}
