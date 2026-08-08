import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

import { fileMeta, scanDesignRoot, scanFontsRoot } from './lib/design'
import { EventBus, FileWatcher, sseResponse } from './lib/events'
import { createMcpProxy, type McpProxyHandle } from './mcp-proxy'
import { handleMcpRequest, type McpDeps } from './mcp'
import {
  ALLOWED_DESIGN_EXTENSIONS,
  isSafeBrand,
  isSafeFontRelPath,
  isSafeRelativePath,
  resolveDesignPath,
  resolveFontPath
} from './lib/paths'
import { StateStore } from './lib/state'

export interface BridgeServerOptions {
  port: number
  distDir?: string
  designRoot?: string
  stateDir?: string
  token?: string
}

const VERSION = '0.3.0'
const RECONCILE_MS = 60_000
const SSE_PING_MS = 25_000
const MAX_BODY_BYTES = 512 * 1024 * 1024

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8'
}

function extensionOf(path: string): string {
  const last = path.lastIndexOf('.')
  return last >= 0 ? path.slice(last).toLowerCase() : ''
}

function mimeFor(path: string): string {
  return MIME_TYPES[extensionOf(path)] ?? 'application/octet-stream'
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function resolveWithin(root: string, rel: string): string | null {
  const rootResolved = resolve(root)
  const full = resolve(rootResolved, `.${rel.startsWith('/') ? rel : `/${rel}`}`)
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) return null
  return full
}

function serveFileResponse(fullPath: string, cacheControl: string): Response {
  if (!existsSync(fullPath)) return new Response('Not Found', { status: 404 })
  return new Response(Bun.file(fullPath), {
    headers: {
      'Content-Type': mimeFor(fullPath),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

function serveStatic(urlPath: string, distDir: string): Response {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '')
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const indexFile = join(distDir, 'index.html')
  if (rel === '') return serveFileResponse(indexFile, 'no-cache')

  const safe = resolveWithin(distDir, rel)
  if (!safe) return new Response('Not Found', { status: 404 })

  if (isDirectory(safe)) {
    const candidate = join(safe, 'index.html')
    if (!existsSync(candidate)) return new Response('Not Found', { status: 404 })
    return serveFileResponse(candidate, 'no-cache')
  }

  if (!existsSync(safe)) {
    return serveFileResponse(indexFile, 'no-cache')
  }

  const cacheControl = rel.startsWith('assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  return serveFileResponse(safe, cacheControl)
}

function serveDesignFileRel(rel: string, designRoot: string): Response {
  const fullPath = resolveDesignPath(designRoot, rel)
  if (!fullPath) return new Response('Forbidden', { status: 403 })
  if (!existsSync(fullPath) || isDirectory(fullPath)) {
    return new Response('Not Found', { status: 404 })
  }

  const isPen = /\.pen$/i.test(rel)
  return new Response(Bun.file(fullPath), {
    headers: {
      'Content-Type': isPen ? 'application/json; charset=utf-8' : 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

/** 流式写入请求体到文件（Bun.write 不接受 web ReadableStream，需逐块写入）。 */
async function writeRequestBody(full: string, request: Request): Promise<void> {
  const body = request.body
  if (!body) {
    await Bun.write(full, new Uint8Array(0))
    return
  }
  const writer = Bun.file(full).writer()
  try {
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) await writer.write(value)
    }
  } finally {
    await writer.end()
  }
}

function decodeRelPath(raw: string): string | null {
  try {
    return raw
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

/** 推导 web 静态资源目录：显式配置（options/env）优先；默认从 file-bridge 目录向上兼容查找 dist。 */
function resolveDistDir(explicit: string | undefined): string {
  if (explicit) return explicit
  const candidates = [join(import.meta.dir, '../dist'), join(import.meta.dir, '../../dist')]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return candidate
  }
  return candidates[0]
}

/** 从 file-bridge 目录向上找仓库根（含 packages/mcp/src/index.ts 的目录）。 */
function resolveRepoRoot(fileBridgeDir: string): string {
  for (const candidate of [join(fileBridgeDir, '..', '..'), join(fileBridgeDir, '..')]) {
    if (existsSync(join(candidate, 'packages', 'mcp', 'src', 'index.ts'))) return candidate
  }
  return join(fileBridgeDir, '..', '..')
}

function methodNotAllowed(): Response {
  return json({ ok: false, error: 'method not allowed' }, 405)
}

/** 校验写操作鉴权。返回 null 表示通过，否则返回拒绝响应。 */
function checkAuth(request: Request, token: string): Response | null {
  if (!token) {
    return json({ ok: false, error: 'BRIDGE_TOKEN not configured on server' }, 401)
  }
  const header = request.headers.get('authorization') ?? ''
  if (!constantTimeEqual(header, `Bearer ${token}`)) {
    return json({ ok: false, error: 'Unauthorized' }, 401)
  }
  return null
}

export function startServer(options: BridgeServerOptions) {
  const distDir = resolveDistDir(options.distDir ?? process.env.DIST_DIR)
  const designRoot = options.designRoot ?? process.env.DESIGN_ROOT ?? '/data/design'
  const stateDir = options.stateDir ?? process.env.STATE_DIR ?? '/data/state'
  const token = options.token ?? process.env.BRIDGE_TOKEN ?? ''

  mkdirSync(designRoot, { recursive: true })
  mkdirSync(stateDir, { recursive: true })

  const state = new StateStore(stateDir)
  const bus = new EventBus(SSE_PING_MS)
  const watcher = new FileWatcher(designRoot, (event) => {
    bus.broadcast(event.type, { path: event.path, brand: event.brand })
  })

  watcher.seed(scanDesignRoot(designRoot).flat.map((file) => file.path))
  const watcherActive = watcher.start()

  const reconcileTimer = setInterval(() => {
    watcher.reconcile(scanDesignRoot(designRoot).flat)
  }, RECONCILE_MS)

  const mcpDeps: McpDeps = { designRoot, state, token }

  // ---- 可选的上游 MCP server（内存级实时协作：纯 JSON-RPC 转发，不解析画布）----
  const mcpAuthToken = process.env.MCP_AUTH_TOKEN?.trim() || ''
  const mcpEnabled = mcpAuthToken !== ''
  const mcpHttpPort = Number(process.env.MCP_PORT ?? '7600')
  const mcpHttpUrl = process.env.MCP_HTTP_URL?.trim() || `http://127.0.0.1:${mcpHttpPort}`
  const mcpWsUrl = mcpHttpUrl.replace(/^http/, 'ws')
  const mcpServerCmd = process.env.MCP_SERVER_CMD?.trim() || null
  const mcpProxy: McpProxyHandle = createMcpProxy({
    enabled: mcpEnabled,
    authToken: mcpAuthToken || null,
    httpUrl: mcpHttpUrl,
    wsUrl: mcpWsUrl,
    serverCmd: mcpServerCmd,
    spawnCwd: resolveRepoRoot(import.meta.dir),
    designRoot,
    stateDir
  })
  const mcpPath = mcpEnabled ? '/bridge-mcp' : '/mcp'

  // ---- 文件 API ----

  function listFiles(): Response {
    return json(scanDesignRoot(designRoot))
  }

  async function createFileEntry(request: Request): Promise<Response> {
    let payload: { brand?: unknown; name?: unknown; format?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const brand = typeof payload.brand === 'string' ? payload.brand.trim() : ''
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    const format = typeof payload.format === 'string' ? payload.format.toLowerCase() : 'fig'

    if (!isSafeBrand(brand)) return json({ ok: false, error: 'invalid brand (must be a single directory name)' }, 400)
    if (!name) return json({ ok: false, error: 'name is required' }, 400)
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      return json({ ok: false, error: 'invalid name' }, 400)
    }
    if (format !== 'fig' && format !== 'pen') {
      return json({ ok: false, error: "format must be 'fig' or 'pen'" }, 400)
    }

    let fileName = name
    if (!ALLOWED_DESIGN_EXTENSIONS.test(fileName)) fileName = `${fileName}.${format}`
    const rel = `${brand}/${fileName}`
    const full = resolveDesignPath(designRoot, rel)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (existsSync(full)) return json({ ok: false, error: `already exists: ${rel}` }, 409)

    try {
      mkdirSync(dirname(full), { recursive: true })
      await writeRequestBody(full, request)
    } catch (error) {
      return json({ ok: false, error: `write failed: ${String(error)}` }, 500)
    }
    return json({ path: rel }, 201)
  }

  async function saveFile(request: Request, rel: string, overwrite: boolean): Promise<Response> {
    const full = resolveDesignPath(designRoot, rel)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!overwrite && existsSync(full)) {
      return json({ ok: false, error: `already exists: ${rel}` }, 409)
    }
    try {
      mkdirSync(dirname(full), { recursive: true })
      await writeRequestBody(full, request)
    } catch (error) {
      return json({ ok: false, error: `write failed: ${String(error)}` }, 500)
    }
    const meta = fileMeta(designRoot, rel)
    return json({ path: rel, size: meta?.size ?? 0 }, overwrite ? 200 : 201)
  }

  function deleteFile(rel: string): Response {
    const full = resolveDesignPath(designRoot, rel)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    try {
      if (!existsSync(full)) return json({ ok: false, error: `not found: ${rel}` }, 404)
      if (!statSync(full).isFile()) return json({ ok: false, error: 'not a file' }, 400)
      rmSync(full)
    } catch (error) {
      return json({ ok: false, error: `delete failed: ${String(error)}` }, 500)
    }
    return json({ path: rel, deleted: true })
  }

  // ---- 工作区字体（fonts/ 文件夹）----

  function listFonts(): Response {
    return json({ fonts: scanFontsRoot(designRoot) })
  }

  function serveFont(rel: string): Response {
    const full = resolveFontPath(designRoot, rel)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(full) || isDirectory(full)) {
      return json({ ok: false, error: `not found: ${rel}` }, 404)
    }
    return new Response(Bun.file(full), {
      headers: {
        'Content-Type': mimeFor(full),
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  }

  // ---- active / recent ----

  function getActive(): Response {
    return json(state.getActive())
  }

  async function setActive(request: Request): Promise<Response> {
    let payload: { path?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const path = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (!isSafeRelativePath(path)) return json({ ok: false, error: 'invalid path' }, 400)

    state.setActive(path)
    bus.broadcast('active.changed', { path })
    return json(state.getActive())
  }

  function getRecent(): Response {
    return json({ recents: state.getRecent() })
  }

  async function setRecent(request: Request): Promise<Response> {
    let payload: { path?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const path = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (!isSafeRelativePath(path)) return json({ ok: false, error: 'invalid path' }, 400)

    state.addRecent(path)
    return json({ recents: state.getRecent() })
  }

  // ---- 路由 ----

  async function route(
    request: Request,
    server: Parameters<Parameters<typeof Bun.serve>[0]['fetch']>[1]
  ): Promise<Response | undefined> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    if (method === 'GET' && path === '/api/v1/health') {
      return json({ ok: true, version: VERSION, designRoot })
    }

    if (method === 'GET' && path === '/api/v1/config') {
      // 供同源 SPA 获取写接口 token（安全基线见 deploy-plan §8：LAN 信任 + 外网 NPM Basic Auth）
      // MCP 可用时下发独立的 MCP auth token（与 BRIDGE_TOKEN 分离），浏览器据此连接 automation。
      return json({
        ok: true,
        version: VERSION,
        designRoot,
        token: token || null,
        ...(mcpEnabled && mcpProxy.isReady()
          ? { mcpAuthToken, mcpWsPath: '/ws', mcpHealthPath: '/health', mcpMcpPath: mcpPath }
          : {})
      })
    }

    // ---- 上游 MCP server 反代（MCP 开启时接管 /mcp；否则 /mcp 仍走桥接工具）----
    if (mcpEnabled && (path === '/mcp' || path === '/rpc' || path === '/health')) {
      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id, X-MCP-Token',
            'Access-Control-Max-Age': '86400'
          }
        })
      }
      return mcpProxy.forward(request)
    }

    if (mcpEnabled && path === '/ws') {
      if (method === 'GET') {
        if (mcpProxy.upgrade(request, server)) return undefined
        return new Response('MCP WebSocket proxy not ready', { status: 502 })
      }
      return methodNotAllowed()
    }

    if (path === mcpPath) {
      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
            'Access-Control-Max-Age': '86400'
          }
        })
      }
      if (method === 'POST') return handleMcpRequest(request, mcpDeps)
      return methodNotAllowed()
    }

    if (path === '/api/v1/files') {
      if (method === 'GET') return listFiles()
      if (method === 'POST') {
        const denied = checkAuth(request, token)
        if (denied) return denied
        return createFileEntry(request)
      }
      return methodNotAllowed()
    }

    if (path === '/api/v1/fonts') {
      if (method !== 'GET') return methodNotAllowed()
      return listFonts()
    }

    const fontMatch = path.match(/^\/api\/v1\/fonts\/(.+)$/)
    if (fontMatch) {
      if (method !== 'GET') return methodNotAllowed()
      const raw = fontMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      if (!isSafeFontRelPath(`fonts/${rel}`)) return json({ ok: false, error: 'unsafe path' }, 403)
      return serveFont(`fonts/${rel}`)
    }

    if (path === '/api/v1/events') {
      if (method === 'GET') return sseResponse(bus, { session: state.session })
      return methodNotAllowed()
    }

    if (path === '/api/v1/active') {
      if (method === 'GET') return getActive()
      if (method === 'POST') {
        const denied = checkAuth(request, token)
        if (denied) return denied
        return setActive(request)
      }
      return methodNotAllowed()
    }

    if (path === '/api/v1/recent') {
      if (method === 'GET') return getRecent()
      if (method === 'POST') {
        const denied = checkAuth(request, token)
        if (denied) return denied
        return setRecent(request)
      }
      return methodNotAllowed()
    }

    const metaMatch = path.match(/^\/api\/v1\/files\/(.+)\/meta$/)
    if (metaMatch) {
      if (method !== 'GET') return methodNotAllowed()
      const raw = metaMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      if (!isSafeRelativePath(rel)) return json({ ok: false, error: 'unsafe path' }, 403)
      const meta = fileMeta(designRoot, rel)
      if (!meta) return json({ ok: false, error: 'not found' }, 404)
      return json(meta)
    }

    const fileMatch = path.match(/^\/api\/v1\/files\/(.+)$/)
    if (fileMatch) {
      const raw = fileMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      if (method === 'GET') return serveDesignFileRel(rel, designRoot)
      const denied = checkAuth(request, token)
      if (denied) return denied
      if (method === 'PUT') return saveFile(request, rel, true)
      if (method === 'POST') return saveFile(request, rel, false)
      if (method === 'DELETE') return deleteFile(rel)
      return methodNotAllowed()
    }

    if (path.startsWith('/api/')) return json({ ok: false, error: 'not found' }, 404)

    return serveStatic(path, distDir)
  }

  const server = Bun.serve({
    port: options.port,
    maxRequestBodySize: MAX_BODY_BYTES,
    fetch: route,
    websocket: {
      open(ws: Bun.ServerWebSocket) {
        mcpProxy.pipe(ws)
      },
      message(ws: Bun.ServerWebSocket, message: string | Buffer) {
        mcpProxy.forwardMessage(ws, message)
      },
      close(ws: Bun.ServerWebSocket) {
        const client = (ws.data as { client?: WebSocket } | undefined)?.client
        try {
          client?.close()
        } catch {
          // 已关闭
          // oxlint-ignore-next-line no-silent-catch
          void ws
        }
      }
    }
  })

  const shutdown = () => {
    clearInterval(reconcileTimer)
    watcher.stop()
    bus.close()
    mcpProxy.close()
    try {
      server.stop(true)
    } catch {
      // 忽略重复停止
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log(`[file-bridge] v${VERSION} listening on ${server.url.hostname}:${server.port}`)
  console.log(
    `[file-bridge] designRoot=${designRoot} stateDir=${stateDir} token=${token ? 'configured' : 'NOT SET (writes denied)'} watcher=${watcherActive ? 'on' : 'off'} mcp=${mcpEnabled ? `enabled (${mcpHttpUrl}, path=${mcpPath})` : 'off'}`
  )
  return server
}
