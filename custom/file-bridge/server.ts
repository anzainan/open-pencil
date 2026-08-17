import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'

import {
  fileMeta,
  listingFromFiles,
  scanFontsRoot,
  scanManifestDirs,
  scanManifestFiles,
  scanTrashRoot
} from './lib/design'
import { EventBus, FileWatcher, sseResponse } from './lib/events'
import { createMcpProxy, type McpProxyHandle } from './mcp-proxy'
import { handleMcpRequest, type McpDeps } from './mcp'
import { decryptPassword } from './lib/crypto'
import { AuthStore, isAdminRole, type User, type UserRole } from './lib/auth'
import { NotificationStore } from './lib/notifications'
import { PresenceStore } from './lib/presence'
import { PermissionStore } from './lib/permissions'
import {
  generateRandomPassword,
  ShareStore,
  type SharePermission,
  type ShareScope
} from './lib/share'
import { Manifest } from './lib/manifest'
import {
  ALLOWED_DESIGN_EXTENSIONS,
  isSafeBrand,
  isSafeFontRelPath,
  isSafeRelativePath,
  isSafeWorkspaceName,
  isSafeWorkspaceRelPath,
  OPENPENCIL_REL_DIR,
  resolveDesignPath,
  resolveFontPath,
  TRASH_REL_DIR
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
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

/** 原子写盘：先写同目录临时文件，再 rename 覆盖目标。中途失败/并发时目标文件始终完整。 */
async function writeFileAtomic(full: string, request: Request): Promise<void> {
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
  try {
    await writeRequestBody(tmp, request)
    renameSync(tmp, full)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch (cleanupError) {
      console.warn('[file-bridge] temp cleanup failed', cleanupError)
    }
    throw error
  }
}

/** 每个目标文件一把 FIFO 写锁：并发 PUT 串行化，杜绝交错写坏文件。 */
const writeQueues = new Map<string, Promise<unknown>>()

function withWriteQueue<T>(full: string, fn: () => Promise<T>): Promise<T> {
  const key = full
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(fn)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  writeQueues.set(key, tail)
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key)
    return undefined
  })
  return run
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
  const header = request.headers.get('authorization') ?? ''
  if (token && constantTimeEqual(header, `Bearer ${token}`)) return null
  // checkAuth 升级（Phase A）：BRIDGE_TOKEN 或有效 session token 二选一。
  if (authStore && sessionUser(request)) return null
  return json({ ok: false, error: 'Unauthorized' }, 401)
}

// ---- 账号会话（Phase A：登录/成员）。checkAuth 与登录态路由共享。 ----
let authStore: AuthStore | null = null

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
}

/** 从 Authorization: Bearer <session-token> 解析当前登录用户（无/失效返回 null）。 */
function sessionUser(request: Request): User | null {
  if (!authStore) return null
  const token = bearerToken(request)
  if (!token) return null
  return authStore.getSessionUser(token)
}

/** 登录态用户（非 owner/admin 返回 null）。 */
function adminUser(request: Request): User | null {
  const user = sessionUser(request)
  if (!user || !isAdminRole(user.role)) return null
  return user
}

/** C-live 在线台账周期清理：按 path 聚合被移除用户，逐个 path 广播最新快照（含离开后清空）。 */
function sweepExpiredPresence(presence: PresenceStore, bus: EventBus): void {
  const removedByPath = new Map<string, { path: string; userId: string }[]>()
  for (const item of presence.sweep()) {
    const list = removedByPath.get(item.path) ?? []
    list.push(item)
    removedByPath.set(item.path, list)
  }
  for (const path of removedByPath.keys()) {
    bus.broadcast('online.changed', { path, users: presence.snapshot(path) })
  }
}

/** 启动在线台账周期清理定时器（15s 无心跳 → 下线并广播离开）。 */
function startPresenceSweep(presence: PresenceStore, bus: EventBus): ReturnType<typeof setInterval> {
  const PRESENCE_SWEEP_MS = 15_000
  return setInterval(() => {
    sweepExpiredPresence(presence, bus)
  }, PRESENCE_SWEEP_MS)
}

/**
 * POST /api/v1/online（login）→ {path} 心跳上报。返回该 path 最新在线快照
 * （上报即广播，其它 SSE 客户端实时感知新协作者）。
 */
async function reportOnline(request: Request, presence: PresenceStore): Promise<Response> {
  const user = sessionUser(request)
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
  let payload: { path?: unknown }
  try {
    payload = JSON.parse(await request.text())
  } catch {
    return json({ ok: false, error: 'invalid JSON body' }, 400)
  }
  const path = typeof payload.path === 'string' ? payload.path.trim() : ''
  if (!isSafeRelativePath(path)) return json({ ok: false, error: 'invalid path' }, 400)
  const users = presence.upsert(path, {
    userId: user.id,
    name: user.name,
    avatar: { ...user.avatar }
  })
  return json({ ok: true, users })
}

/** GET /api/v1/online?path=（login）→ 该 path 当前在线快照（前端挂载时拉取自愈）。 */
function getOnline(request: Request, presence: PresenceStore): Response {
  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  if (!isSafeRelativePath(path)) return json({ ok: false, error: 'invalid path' }, 400)
  return json({ users: presence.snapshot(path) })
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
  // 文档在线台账（C-live 方案二）：心跳 upsert + 15s 超时 sweep，变更经 bus 广播 online.changed。
  const presence = new PresenceStore(bus)
  // 账号/会话台账（Phase A）：users.json seed 默认管理员，sessions.json 跨容器持久化。
  authStore = new AuthStore(designRoot)
  // 权限台账 + 通知台账（Phase B）：permissions.json 权限引擎，notifications.json 权限申请落库。
  const permissions = new PermissionStore(designRoot)
  const notifications = new NotificationStore(designRoot)
  // 外链台账（Phase C）：share.json 存外链（token/密码/internet scope），成员权限仍走 permissions.json。
  const shares = new ShareStore(designRoot)
  // homepage 可见性白名单台账：只展示经首页/工作区创建链路登记的内容（方案 A）。
  const manifest = new Manifest(designRoot)
  const watcher = new FileWatcher(
    designRoot,
    (event) => {
      bus.broadcast(event.type, { path: event.path, brand: event.brand })
    },
    { shouldTrack: (rel) => manifest.isFileRegistered(rel) }
  )

  watcher.seed(scanManifestFiles(designRoot, manifest.files).map((file) => file.path))
  const watcherActive = watcher.start()

  const reconcileTimer = setInterval(() => {
    watcher.reconcile(scanManifestFiles(designRoot, manifest.files))
  }, RECONCILE_MS)

  // C-live：在线台账周期清理（15s 无心跳 → 下线；有移除则广播离开）。
  const presenceSweepTimer = startPresenceSweep(presence, bus)

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
    wsURL: mcpWsUrl,
    serverCmd: mcpServerCmd,
    spawnCwd: resolveRepoRoot(import.meta.dir),
    designRoot,
    stateDir
  })
  const mcpPath = mcpEnabled ? '/bridge-mcp' : '/mcp'

  // ---- 文件 API ----

  /** 台账 join 后清单：只返回经首页/工作区创建链路登记且实盘存在的文件。 */
  function listFiles(): Response {
    return json(listingFromFiles(scanManifestFiles(designRoot, manifest.files)))
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
      await withWriteQueue(full, () => writeFileAtomic(full, request))
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
    // 新文件首次写盘（新建白板保存 / MCP save_file / op-eval --write）→ 登记台账，
    // 首页文件区可见；既有文件再次保存不新登记（台账保持「首页创建内容」语义）。
    const existedBefore = existsSync(full)
    try {
      mkdirSync(dirname(full), { recursive: true })
      await withWriteQueue(full, () => writeFileAtomic(full, request))
    } catch (error) {
      return json({ ok: false, error: `write failed: ${String(error)}` }, 500)
    }
    if (!existedBefore) manifest.registerFile(rel)
    const meta = fileMeta(designRoot, rel)
    return json(
      { path: rel, size: meta?.size ?? 0, mtime: meta?.mtime ?? null, updatedAt: meta?.mtime ?? null },
      overwrite ? 200 : 201
    )
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
    manifest.removePath(rel)
    return json({ path: rel, deleted: true })
  }

  // ---- 文件夹 / 重命名 / 移动 / 回收站（Phase 2/3 新增端点）----

  /** 台账 join 后目录清单：只返回经「新建项目」登记且实盘存在的文件夹。 */
  function listDirs(): Response {
    return json({ dirs: scanManifestDirs(designRoot, manifest.folders) })
  }

  async function createDir(request: Request): Promise<Response> {
    let payload: { path?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const path = typeof payload.path === 'string' ? payload.path.trim().replace(/\/+$/, '') : ''
    if (!isSafeWorkspaceRelPath(path)) return json({ ok: false, error: 'invalid dir path' }, 400)
    const full = resolveWithin(designRoot, `/${path}`)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (existsSync(full)) return json({ ok: false, error: `already exists: ${path}` }, 409)
    try {
      mkdirSync(full, { recursive: true })
    } catch (error) {
      return json({ ok: false, error: `create dir failed: ${String(error)}` }, 500)
    }
    manifest.registerFolder(path)
    return json({ path }, 201)
  }

  function isTrashRel(rel: string): boolean {
    return rel === TRASH_REL_DIR || rel.startsWith(`${TRASH_REL_DIR}/`)
  }

  function safeResolve(rel: string): string | null {
    if (!isSafeWorkspaceRelPath(rel)) return null
    const full = resolveWithin(designRoot, `/${rel}`)
    if (!full) return null
    return full
  }

  /** 目录内新文件名：目标必须是设计根内，且含 `.trash` 前导段时拒绝（避免从回收站外翻越）。 */
  function resolveForOp(rel: string): string | null {
    if (isTrashRel(rel)) return null
    return safeResolve(rel)
  }

  async function renameEntry(request: Request, rel: string): Promise<Response> {
    let payload: { name?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!isSafeWorkspaceName(name)) return json({ ok: false, error: 'invalid name' }, 400)
    const full = resolveForOp(rel)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(full)) return json({ ok: false, error: `not found: ${rel}` }, 404)
    const isFile = statSync(full).isFile()
    let newName = name
    if (isFile && !ALLOWED_DESIGN_EXTENSIONS.test(newName)) {
      const oldExt = extensionOf(rel) || '.fig'
      newName = `${name}${oldExt}`
    }
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : ''
    const newRel = `${dir}${newName}`
    const newFull = resolveForOp(newRel)
    if (!newFull) return json({ ok: false, error: 'unsafe path' }, 403)
    if (existsSync(newFull)) return json({ ok: false, error: `already exists: ${newRel}` }, 409)
    try {
      renameSync(full, newFull)
    } catch (error) {
      return json({ ok: false, error: `rename failed: ${String(error)}` }, 500)
    }
    manifest.renamePath(rel, newRel)
    bus.broadcast('file.deleted', { path: rel, brand: rel.split('/')[0] ?? '' })
    bus.broadcast('file.created', { path: newRel, brand: newRel.split('/')[0] ?? '' })
    return json({ path: newRel })
  }

  async function moveEntry(request: Request, rel: string): Promise<Response> {
    let payload: { to?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const to = typeof payload.to === 'string' ? payload.to.trim().replace(/\/+$/, '') : ''
    if (to && !isSafeWorkspaceRelPath(to)) return json({ ok: false, error: 'invalid target dir' }, 400)
    const full = resolveForOp(rel)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(full)) return json({ ok: false, error: `not found: ${rel}` }, 404)
    const fileName = rel.split('/').pop() ?? ''
    const newRel = to ? `${to}/${fileName}` : fileName
    const newFull = resolveForOp(newRel)
    if (!newFull) return json({ ok: false, error: 'unsafe path' }, 403)
    if (existsSync(newFull)) return json({ ok: false, error: `already exists: ${newRel}` }, 409)
    try {
      mkdirSync(dirname(newFull), { recursive: true })
      renameSync(full, newFull)
    } catch (error) {
      return json({ ok: false, error: `move failed: ${String(error)}` }, 500)
    }
    manifest.renamePath(rel, newRel)
    bus.broadcast('file.deleted', { path: rel, brand: rel.split('/')[0] ?? '' })
    bus.broadcast('file.created', { path: newRel, brand: newRel.split('/')[0] ?? '' })
    return json({ path: newRel })
  }

  function trashEntry(rel: string): Response {
    const full = resolveForOp(rel)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(full)) return json({ ok: false, error: `not found: ${rel}` }, 404)
    const trashRel = `${TRASH_REL_DIR}/${rel}`
    const trashFull = safeResolve(trashRel)
    if (!trashFull) return json({ ok: false, error: 'unsafe path' }, 403)
    if (existsSync(trashFull)) return json({ ok: false, error: `already in trash: ${rel}` }, 409)
    try {
      mkdirSync(dirname(trashFull), { recursive: true })
      renameSync(full, trashFull)
    } catch (error) {
      return json({ ok: false, error: `trash failed: ${String(error)}` }, 500)
    }
    // 移入回收站 = 不再展示 → 从台账移除（恢复端点再登记回来）。
    manifest.removePath(rel)
    bus.broadcast('file.deleted', { path: rel, brand: rel.split('/')[0] ?? '' })
    return json({ path: rel, trashed: true })
  }

  function listTrash(): Response {
    return json({ files: scanTrashRoot(designRoot) })
  }

  async function restoreTrashEntry(request: Request): Promise<Response> {
    let payload: { path?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const rel = typeof payload.path === 'string' ? payload.path.trim() : ''
    const trashFull = safeResolve(`${TRASH_REL_DIR}/${rel}`)
    if (!trashFull) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(trashFull)) return json({ ok: false, error: `not found in trash: ${rel}` }, 404)
    const targetFull = resolveForOp(rel)
    if (!targetFull) return json({ ok: false, error: 'unsafe path' }, 403)
    if (existsSync(targetFull)) {
      return json({ ok: false, error: `already exists: ${rel}` }, 409)
    }
    try {
      mkdirSync(dirname(targetFull), { recursive: true })
      renameSync(trashFull, targetFull)
    } catch (error) {
      return json({ ok: false, error: `restore failed: ${String(error)}` }, 500)
    }
    // 台账同步恢复：按被恢复条目类型重新登记，首页重新可见。
    if (statSync(targetFull).isFile()) manifest.registerFile(rel)
    else manifest.registerFolder(rel)
    bus.broadcast('file.created', { path: rel, brand: rel.split('/')[0] ?? '' })
    return json({ path: rel, restored: true })
  }

  function deleteTrashEntry(rel: string): Response {
    const trashFull = safeResolve(`${TRASH_REL_DIR}/${rel}`)
    if (!trashFull) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(trashFull)) return json({ ok: false, error: `not found in trash: ${rel}` }, 404)
    try {
      rmSync(trashFull, { recursive: true, force: true })
    } catch (error) {
      return json({ ok: false, error: `delete failed: ${String(error)}` }, 500)
    }
    manifest.removePath(rel)
    return json({ path: rel, deleted: true })
  }

  // ---- 文件夹置顶（Phase 5：可取消 / 多文件夹 / 时间倒序 / 台账持久化）----

  /** 置顶台账清单（pinnedAt 倒序）。 */
  function listPins(): Response {
    return json({ pins: manifest.pins })
  }

  /** 置顶文件夹（幂等：重复置顶刷新 pinnedAt 为最新）。 */
  async function pinEntry(request: Request): Promise<Response> {
    let payload: { path?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const path = typeof payload.path === 'string' ? payload.path.trim().replace(/\/+$/, '') : ''
    if (!isSafeWorkspaceRelPath(path)) return json({ ok: false, error: 'invalid dir path' }, 400)
    const full = resolveWithin(designRoot, `/${path}`)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(full) || !isDirectory(full)) {
      return json({ ok: false, error: `not a folder: ${path}` }, 404)
    }
    const pin = manifest.pinFolder(path)
    return json({ pin })
  }

  /** 取消置顶。 */
  function unpinEntry(rel: string): Response {
    if (!isSafeWorkspaceRelPath(rel)) return json({ ok: false, error: 'invalid dir path' }, 400)
    const full = resolveWithin(designRoot, `/${rel}`)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    manifest.unpinFolder(rel)
    return json({ path: rel, unpinned: true })
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

  // ---- 账号会话与成员管理（Phase A：登录 / session 恢复 / 成员 CRUD）----

  async function login(request: Request): Promise<Response> {
    if (!authStore) return json({ ok: false, error: 'auth not ready' }, 500)
    let payload: { name?: unknown; password?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    const password = typeof payload.password === 'string' ? payload.password : ''
    if (!name || !password) return json({ ok: false, error: 'name and password are required' }, 400)
    const user = authStore.verifyCredentials(name, password)
    if (!user) return json({ ok: false, error: 'invalid credentials' }, 401)
    const token = authStore.createSession(user.id)
    return json({ token, user: authStore.toPublicUser(user) })
  }

  function logout(request: Request): Response {
    if (!authStore) return json({ ok: false, error: 'auth not ready' }, 500)
    const token = bearerToken(request)
    if (!token || !authStore.getSessionUser(token)) {
      return json({ ok: false, error: 'Unauthorized' }, 401)
    }
    authStore.destroySession(token)
    return json({ ok: true })
  }

  function session(request: Request): Response {
    if (!authStore) return json({ ok: false, error: 'auth not ready' }, 500)
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    return json({ user: authStore.toPublicUser(user) })
  }

  /** GET /members：admin/owner → 附成员明文密码（withPassword）；member → 无密码字段。 */
  function listMembers(withPassword: boolean): Response {
    if (!authStore) return json({ ok: false, error: 'auth not ready' }, 500)
    return json({ members: authStore.listUsers({ withPassword }) })
  }

  async function createMember(request: Request): Promise<Response> {
    if (!authStore) return json({ ok: false, error: 'auth not ready' }, 500)
    let payload: { name?: unknown; password?: unknown; role?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    const password = typeof payload.password === 'string' ? payload.password : ''
    const role = payload.role === 'admin' || payload.role === 'member' ? payload.role : 'member'
    let result
    try {
      result = authStore.createUser({ name, password, role })
    } catch (error) {
      return json({ ok: false, error: `persist failed: ${String(error)}` }, 500)
    }
    if (!result.ok) {
      if (result.error.startsWith('user already exists')) {
        return json({ ok: false, error: result.error }, 409)
      }
      return json({ ok: false, error: result.error }, 400)
    }
    // 添加成员返回含明文密码（「添加并复制」用）；其余场景密码字段绝不出现在响应里。
    return json({ user: result.user, password: result.password }, 201)
  }

  async function updateMember(request: Request, id: string): Promise<Response> {
    if (!authStore) return json({ ok: false, error: 'auth not ready' }, 500)
    let payload: { password?: unknown; role?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const input: { password?: string; role?: UserRole } = {}
    if (typeof payload.password === 'string') input.password = payload.password
    if (payload.role === 'admin' || payload.role === 'member') input.role = payload.role
    if (input.password === undefined && input.role === undefined) {
      return json({ ok: false, error: 'nothing to update' }, 400)
    }
    // owner 拒绝修改（不区分 admin 提权，直接 403）。
    if (authStore.isOwner(id)) return json({ ok: false, error: 'owner cannot be modified' }, 403)
    let result
    try {
      result = authStore.updateUser(id, input)
    } catch (error) {
      return json({ ok: false, error: `persist failed: ${String(error)}` }, 500)
    }
    if (!result.ok) {
      return result.error === 'not found'
        ? json({ ok: false, error: result.error }, 404)
        : json({ ok: false, error: result.error }, 400)
    }
    return json({ user: result.user })
  }

  function deleteMember(id: string): Response {
    if (!authStore) return json({ ok: false, error: 'auth not ready' }, 500)
    // owner 拒绝删除（固定账号，REQ §2.5）。
    if (authStore.isOwner(id)) return json({ ok: false, error: 'owner cannot be removed' }, 403)
    let result
    try {
      result = authStore.deleteUser(id)
    } catch (error) {
      return json({ ok: false, error: `persist failed: ${String(error)}` }, 500)
    }
    if (!result.ok) {
      return result.error === 'not found'
        ? json({ ok: false, error: result.error }, 404)
        : json({ ok: false, error: result.error }, 400)
    }
    return json({ deleted: true })
  }

  // ---- 头像（Phase G：真实图片上传，存 designRoot/.openpixel/avatars/，隐藏系统目录）----

  const AVATAR_REL_DIR = 'avatars'
  const MAX_AVATAR_BYTES = 5 * 1024 * 1024

  /** 校验解码字节的 magic bytes 与扩展名是否匹配（拒绝伪装成图片的任意文件）。 */
  function matchesImageSignature(ext: string, bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false
    if (ext === 'png') {
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    }
    if (ext === 'webp') {
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
    }
    return false
  }

  /** POST /api/v1/avatars（login，本人）：base64 图片上传 → 写 .openpixel/avatars/ → 更新 users.json。 */
  async function uploadAvatar(request: Request): Promise<Response> {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    let payload: { data?: unknown; ext?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    if (typeof payload.data !== 'string' || !payload.data) {
      return json({ ok: false, error: 'image data is required' }, 400)
    }
    const ext = typeof payload.ext === 'string' ? payload.ext.toLowerCase().replace(/^\./, '') : ''
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return json({ ok: false, error: 'ext must be png/jpg/jpeg/webp' }, 400)
    }
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(atob(payload.data), (char) => char.charCodeAt(0))
    } catch {
      return json({ ok: false, error: 'invalid base64 image data' }, 400)
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
      return json({ ok: false, error: 'image must be 1 byte to 5MB' }, 400)
    }
    if (!matchesImageSignature(ext, bytes)) {
      return json({ ok: false, error: 'image signature does not match extension' }, 400)
    }
    // 文件名带版本号（userId-mtime）：同名覆盖重传时 relPath 变化 → 前端 useAvatarURL watch 天然触发重拉
    // （否则同 ext 覆盖路径不变，旧 objectURL 不失效，见 ARCH-usersys-pw-disappear §6.2b/C3）。
    const fileName = `${user.id}-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`
    const oldRel = user.avatar?.image
    const avatarDir = join(designRoot, OPENPENCIL_REL_DIR, AVATAR_REL_DIR)
    try {
      mkdirSync(avatarDir, { recursive: true })
      await Bun.write(join(avatarDir, fileName), bytes)
      // 清理旧头像文件（防同一用户多次上传堆积；仅删本人头像目录内文件）。
      if (oldRel && oldRel.startsWith(`${AVATAR_REL_DIR}/`) && oldRel !== `${AVATAR_REL_DIR}/${fileName}`) {
        const oldFile = join(designRoot, OPENPENCIL_REL_DIR, oldRel)
        const rootResolved = resolve(avatarDir)
        const fullResolved = resolve(oldFile)
        if (fullResolved.startsWith(rootResolved + sep) && existsSync(fullResolved) && !isDirectory(fullResolved)) {
          rmSync(fullResolved, { force: true })
        }
      }
    } catch (error) {
      return json({ ok: false, error: `write failed: ${String(error)}` }, 500)
    }
    const relPath = `${AVATAR_REL_DIR}/${fileName}`
    let result
    try {
      result = authStore?.setAvatarImage(user.id, relPath)
    } catch (error) {
      return json({ ok: false, error: `persist failed: ${String(error)}` }, 500)
    }
    if (!result || !result.ok) {
      return json({ ok: false, error: result?.error ?? 'avatar update failed' }, 500)
    }
    return json({ ok: true, user: result.user, avatar: result.user.avatar })
  }

  /** GET /api/v1/avatars/:file（login）：仅放行 .openpixel/avatars/ 内图片，防遍历其他 .openpixel 内容。 */
  function serveAvatar(request: Request, fileName: string): Response {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    if (!/^[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/i.test(fileName)) {
      return json({ ok: false, error: 'invalid avatar file' }, 400)
    }
    const avatarDir = join(designRoot, OPENPENCIL_REL_DIR, AVATAR_REL_DIR)
    const rootResolved = resolve(avatarDir)
    const full = resolve(avatarDir, fileName)
    if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
      return json({ ok: false, error: 'unsafe path' }, 403)
    }
    if (!existsSync(full) || isDirectory(full)) {
      return json({ ok: false, error: 'not found' }, 404)
    }
    return new Response(Bun.file(full), {
      headers: {
        'Content-Type': mimeFor(full),
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  }

  // ---- 权限模型（Phase B：真实拦截。文件权限 > 文件夹权限 > 默认，16:28 拍板）----

  /** 解析当前登录用户对某路径的权限（打开/编辑前真实校验；path 空 → 根默认）。 */
  function getPermissions(request: Request): Response {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    const url = new URL(request.url)
    const path = url.searchParams.get('path') ?? ''
    if (path !== '' && !isSafeWorkspaceRelPath(path)) {
      return json({ ok: false, error: 'invalid path' }, 400)
    }
    const resolved = permissions.resolvePermission(path, user)
    // Phase C：附带最近命中 entry 的成员列表（分享面板成员行用：文件级优先，否则父文件夹继承）。
    const entry = permissions.getEntryForPath(path)
    return json({ ...resolved, members: entry?.members ?? [], membersPath: entry?.path ?? '' })
  }

  /** 无编辑权用户申请编辑权限 → 通知 owner + 所有 admin（同人同路径未读去重）。 */
  async function createPermissionRequest(request: Request): Promise<Response> {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    let payload: { path?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const path = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (path !== '' && !isSafeWorkspaceRelPath(path)) {
      return json({ ok: false, error: 'invalid path' }, 400)
    }
    // 去重：同人同路径已有未读申请 → 不再追加（返回成功，幂等）。
    if (notifications.hasUnreadPermissionRequest(user.id, path)) {
      return json({ ok: true, deduped: true })
    }
    const recipients = authStore?.listUsers().filter((member) => isAdminRole(member.role)) ?? []
    for (const recipient of recipients) {
      notifications.addNotification({
        type: 'permission_request',
        fromUserId: user.id,
        targetUserId: recipient.id,
        path,
        title: `${user.name} 请求编辑权限`,
        detail: `请求编辑 ${path}`,
        action: 'approve'
      })
    }
    return json({ ok: true, sent: recipients.length })
  }

  // ---- 通知中心（Phase D：列表 / action 批准拒绝 / 全部已读）----

  /** GET /api/v1/notifications（login）→ 当前用户通知列表（时间倒序）。 */
  function listNotifications(request: Request): Response {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    return json({ notifications: notifications.listNotificationsFor(user.id) })
  }

  /**
   * POST /api/v1/notifications/:id/action（login）→ {action: approve|reject}。
   * permission_request 批准 → 给申请者写该文件可编辑权限（permissions.json upsert）；
   * join_request 批准 → 解析请求状态（现状无独立注册流，申请者已是成员则无需再添加）；
   * 处理完成后给申请者生成结果通知。
   */
  async function resolveNotificationAction(request: Request, id: string): Promise<Response> {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    let payload: { action?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const action = payload.action === 'approve' || payload.action === 'reject' ? payload.action : ''
    if (!action) return json({ ok: false, error: 'action must be approve or reject' }, 400)

    const item = notifications.getById(id)
    if (!item) return json({ ok: false, error: 'not found' }, 404)
    if (item.targetUserId !== undefined && item.targetUserId !== user.id) {
      return json({ ok: false, error: 'Forbidden' }, 403)
    }
    if (item.status !== 'unread') return json({ ok: false, error: 'already processed' }, 409)

    const applicant = authStore?.getUserById(item.fromUserId) ?? null

    if (action === 'approve' && item.type === 'permission_request' && item.path) {
      // 批准 = 给申请者写该路径可编辑权限（保留既有 entry 的 scope/type，防覆盖文件夹继承）。
      const existing = permissions.getEntry(item.path)
      const members = [
        ...(existing?.members ?? []).filter((member) => member.userId !== item.fromUserId),
        { userId: item.fromUserId, permission: 'edit' as const }
      ]
      const scope = existing?.scope ?? 'team'
      let type = existing?.type ?? 'file'
      if (!existing) {
        // 无既有 entry 时按路径是否为目录决定类型（文件夹级权限继承到内部文件）。
        const full = resolveWithin(designRoot, `/${item.path}`)
        if (full && isDirectory(full)) type = 'folder'
      }
      permissions.upsertEntry(item.path, { type, scope, members })
    }

    notifications.updateStatus(id, action === 'approve' ? 'approved' : 'rejected')

    // 生成结果通知给申请者（非本人处理时才通知，避免自己批准自己时收到冗余通知）。
    if (applicant && applicant.id !== user.id) {
      notifications.addNotification({
        type: 'permission_change',
        fromUserId: user.id,
        targetUserId: applicant.id,
        path: item.path,
        title:
          action === 'approve'
            ? `${user.name} 已批准你的权限申请`
            : `${user.name} 拒绝了你的权限申请`,
        detail: item.path ? `关于 ${item.path}` : '团队申请'
      })
    }
    return json({ ok: true, status: action === 'approve' ? 'approved' : 'rejected' })
  }

  /** POST /api/v1/notifications/read-all（login）→ 当前用户全部已读。 */
  function markNotificationsRead(request: Request): Response {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    notifications.markAllReadFor(user.id)
    return json({ ok: true })
  }

/** 外链域名：SHARE_BASE_URL 环境变量优先（H 子路径起），默认公网域名。 */
function resolveShareBaseURL(): string {
  return process.env.SHARE_BASE_URL?.trim() || 'https://anzainan.iepose.cn'
}

  // ---- 分享/外链（Phase C：真实台账 + 游客外链 + P0 安全收紧）----

  const SHARE_BASE_URL = resolveShareBaseURL()

  function shareURL(token: string): string {
    return `${SHARE_BASE_URL}/Mobai/${token}`
  }

  /** 外链对外视图：绝不暴露密码哈希；非 internet 范围不出 token/url（外链不可访问）。
   *  `password` 为明文副本（AES-256-GCM 解密；无 key / 存量仅哈希 → null），调用方按权限注入。 */
  function shareView(link: {
    path: string
    scope: ShareScope
    permission: SharePermission
    passwordHash: string | null
    token: string
    members: { userId: string; permission: 'view' | 'edit' | 'none' }[]
    createdBy: string
    createdAt: string
  }, password: string | null): Record<string, unknown> {
    return {
      path: link.path,
      scope: link.scope,
      permission: link.permission,
      passwordEnabled: link.passwordHash !== null,
      password,
      token: link.scope === 'internet' ? link.token : null,
      url: link.scope === 'internet' ? shareURL(link.token) : null,
      members: link.members,
      createdBy: link.createdBy,
      createdAt: link.createdAt
    }
  }

  /** admin 判定通用返回：无 session → 401；非 admin 登录 → 403。 */
  function adminDenied(request: Request): Response {
    return sessionUser(request)
      ? json({ ok: false, error: 'Forbidden' }, 403)
      : json({ ok: false, error: 'Unauthorized' }, 401)
  }

  /** GET /api/v1/share?path= → 该文件分享设置（login；无 → 默认空）。
   *  password 明文仅对「该文件协作者」（resolvePermission.canView）下发；非协作者 member 返回
   *  password:null（不 403，防探测）。游客无 session → 401（上方天然拦截）。 */
  function getShare(request: Request): Response {
    const user = sessionUser(request)
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
    const url = new URL(request.url)
    const path = url.searchParams.get('path') ?? ''
    if (path !== '' && !isSafeWorkspaceRelPath(path)) {
      return json({ ok: false, error: 'invalid path' }, 400)
    }
    const link = shares.getLink(path)
    if (!link) {
      return json({
        exists: false,
        path,
        scope: 'self',
        permission: 'view',
        passwordEnabled: false,
        password: null,
        token: null,
        url: null,
        members: []
      })
    }
    const canView = permissions.resolvePermission(path, user).canView
    const password = canView ? decryptPassword(link.passwordCipher) : null
    return json({ exists: true, ...shareView(link, password) })
  }

  /**
   * POST /api/v1/share（admin）→ {path, scope, permission, password?}。
   * scope=internet → 生成/保留外链 token + url；scope 非 internet → 不开放外链（verify 返回 closed）。
   * password 语义：不传 = 保留原密码；'' = 清空密码；非空字符串 = 设置新密码。
   */
  async function createShare(request: Request): Promise<Response> {
    const user = adminUser(request)
    if (!user) return adminDenied(request)
    let payload: { path?: unknown; scope?: unknown; permission?: unknown; password?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const path = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (path === '' || !isSafeWorkspaceRelPath(path)) {
      return json({ ok: false, error: 'invalid path' }, 400)
    }
    const scope: ShareScope =
      payload.scope === 'internet' || payload.scope === 'team' || payload.scope === 'self'
        ? payload.scope
        : 'team'
    const permission: SharePermission = payload.permission === 'edit' ? 'edit' : 'view'

    let password: string | null | undefined
    if (payload.password === undefined) {
      password = undefined // 保留原密码
    } else if (typeof payload.password === 'string') {
      password = payload.password === '' ? 'clear' : payload.password
    } else {
      return json({ ok: false, error: 'invalid password' }, 400)
    }

    let link
    try {
      link = shares.upsertLink(path, { scope, permission, password }, user.id)
    } catch (error) {
      return json({ ok: false, error: `persist failed: ${String(error)}` }, 500)
    }
    // admin 写档后回显明文（同事务刚落盘的副本）。
    return json({ ok: true, link: shareView(link, decryptPassword(link.passwordCipher)) })
  }

  /** DELETE /api/v1/share?path= → 关闭分享（删外链）。 */
  function deleteShare(request: Request): Response {
    const user = adminUser(request)
    if (!user) return adminDenied(request)
    const url = new URL(request.url)
    const path = url.searchParams.get('path') ?? ''
    if (path === '' || !isSafeWorkspaceRelPath(path)) {
      return json({ ok: false, error: 'invalid path' }, 400)
    }
    try {
      shares.deleteLink(path)
    } catch (error) {
      return json({ ok: false, error: `persist failed: ${String(error)}` }, 500)
    }
    return json({ ok: true, path, deleted: true })
  }

  /**
   * GET /api/v1/share/verify（public）→ 游客落地页校验。
   * token 无效/已关 → {exists:false}；有密码未提供或错误 → {exists:true, needPassword:true}；
   * 通过 → {exists:true, path, fileName, permission, scope}。
   */
  function verifyShare(request: Request): Response {
    const url = new URL(request.url)
    const token = url.searchParams.get('token') ?? ''
    const password = url.searchParams.get('password') ?? ''
    if (!token) return json({ exists: false })
    const result = shares.verifyToken(token)
    if (!result) return json({ exists: false })
    const { link } = result
    if (link.passwordHash && link.passwordSalt) {
      if (!password) return json({ exists: true, needPassword: true })
      if (!shares.verifyPassword(link, password)) {
        return json({ exists: true, needPassword: true, wrongPassword: true })
      }
    }
    return json({
      exists: true,
      path: result.path,
      fileName: result.fileName,
      permission: link.permission,
      scope: link.scope
    })
  }

  /** GET /api/v1/share/:token/content（public）→ 游客只读读字节（唯一游客文件读通道）。 */
  function serveShareContent(request: Request, token: string): Response {
    const result = shares.verifyToken(token)
    if (!result) return json({ ok: false, error: 'not found' }, 404)
    const full = resolveDesignPath(designRoot, result.path)
    if (!full) return json({ ok: false, error: 'unsafe path' }, 403)
    if (!existsSync(full) || isDirectory(full)) {
      return json({ ok: false, error: 'not found' }, 404)
    }
    const isPen = /\.pen$/i.test(result.path)
    return new Response(Bun.file(full), {
      headers: {
        'Content-Type': isPen ? 'application/json; charset=utf-8' : 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  }

  /** 随机外链密码生成（供前端「刷新密码」按钮；6 位混合大小写+数字，REQ §9.4）。 */
  function generateSharePassword(): Response {
    return json({ password: generateRandomPassword() })
  }

  /**
   * POST /api/v1/permissions（admin）→ {path, scope?, members?}：写文件级权限条目。
   * 供分享面板保存（成员权限 + 范围落 permissions.json，立即生效；resolvePermission 已读它）。
   */
  async function upsertFilePermission(request: Request): Promise<Response> {
    const user = adminUser(request)
    if (!user) return adminDenied(request)
    let payload: { path?: unknown; scope?: unknown; members?: unknown }
    try {
      payload = JSON.parse(await request.text())
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const path = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (path === '' || !isSafeWorkspaceRelPath(path)) {
      return json({ ok: false, error: 'invalid path' }, 400)
    }
    const scope =
      payload.scope === 'internet' || payload.scope === 'team' || payload.scope === 'self'
        ? payload.scope
        : undefined
    let members: { userId: string; permission: 'view' | 'edit' | 'none' }[] | undefined
    if (Array.isArray(payload.members)) {
      members = payload.members.filter(
        (member): member is { userId: string; permission: 'view' | 'edit' | 'none' } =>
          !!member &&
          typeof member.userId === 'string' &&
          (member.permission === 'view' || member.permission === 'edit' || member.permission === 'none')
      )
    }
    if (scope === undefined && members === undefined) {
      return json({ ok: false, error: 'nothing to update' }, 400)
    }
    const existing = permissions.getEntry(path)
    // 路径为目录 → 文件夹级权限（自动继承到内部文件，REQ §5）；否则文件级。
    let type: 'folder' | 'file' = existing?.type ?? 'file'
    if (!existing) {
      const full = resolveWithin(designRoot, `/${path}`)
      if (full && isDirectory(full)) type = 'folder'
    }
    const entry = permissions.upsertEntry(path, {
      type,
      scope: scope ?? existing?.scope ?? 'self',
      members: members ?? existing?.members ?? []
    })
    return json({ ok: true, entry })
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
      // P0 安全收紧（Phase C）：仅登录态下发完整配置（含 BRIDGE_TOKEN/PEXELS/MCP token）。
      // 未登录 → 只回公开最小配置（游客拿不到写令牌，杜绝借外链写盘）。
      const user = sessionUser(request)
      if (!user) {
        return json({ ok: true, version: VERSION, designRoot, token: null, pexelsKey: null })
      }
      return json({
        ok: true,
        version: VERSION,
        designRoot,
        token: token || null,
        pexelsKey: process.env.PEXELS_API_KEY?.trim() || null,
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

    if (path === '/api/v1/online') {
      if (method === 'GET') {
        const denied = checkAuth(request, token)
        if (denied) return denied
        return getOnline(request, presence)
      }
      if (method === 'POST') {
        const denied = checkAuth(request, token)
        if (denied) return denied
        return reportOnline(request, presence)
      }
      return methodNotAllowed()
    }

    if (path === '/api/v1/dirs') {
      if (method === 'GET') return listDirs()
      if (method === 'POST') {
        const denied = checkAuth(request, token)
        if (denied) return denied
        return createDir(request)
      }
      return methodNotAllowed()
    }

    if (path === '/api/v1/pins') {
      if (method === 'GET') return listPins()
      if (method === 'POST') {
        const denied = checkAuth(request, token)
        if (denied) return denied
        return pinEntry(request)
      }
      return methodNotAllowed()
    }

    const pinMatch = path.match(/^\/api\/v1\/pins\/(.+)$/)
    if (pinMatch) {
      const raw = pinMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'DELETE') return methodNotAllowed()
      const denied = checkAuth(request, token)
      if (denied) return denied
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      return unpinEntry(rel)
    }

    if (path === '/api/v1/trash') {
      if (method === 'GET') return listTrash()
      return methodNotAllowed()
    }

    if (path === '/api/v1/trash/restore') {
      if (method !== 'POST') return methodNotAllowed()
      const denied = checkAuth(request, token)
      if (denied) return denied
      return restoreTrashEntry(request)
    }

    const trashMatch = path.match(/^\/api\/v1\/trash\/(.+)$/)
    if (trashMatch) {
      const raw = trashMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'DELETE') return methodNotAllowed()
      const denied = checkAuth(request, token)
      if (denied) return denied
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      return deleteTrashEntry(rel)
    }

    const renameMatch = path.match(/^\/api\/v1\/files\/(.+)\/rename$/)
    if (renameMatch) {
      const raw = renameMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'POST') return methodNotAllowed()
      const denied = checkAuth(request, token)
      if (denied) return denied
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      return renameEntry(request, rel)
    }

    const moveMatch = path.match(/^\/api\/v1\/files\/(.+)\/move$/)
    if (moveMatch) {
      const raw = moveMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'POST') return methodNotAllowed()
      const denied = checkAuth(request, token)
      if (denied) return denied
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      return moveEntry(request, rel)
    }

    const trashFileMatch = path.match(/^\/api\/v1\/files\/(.+)\/trash$/)
    if (trashFileMatch) {
      const raw = trashFileMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'POST') return methodNotAllowed()
      const denied = checkAuth(request, token)
      if (denied) return denied
      const rel = decodeRelPath(raw)
      if (!rel) return json({ ok: false, error: 'bad path encoding' }, 400)
      return trashEntry(rel)
    }

    const metaMatch = path.match(/^\/api\/v1\/files\/(.+)\/meta$/)
    if (metaMatch) {
      if (method !== 'GET') return methodNotAllowed()
      // P0 安全收紧（Phase C）：文件原始读接口要求 session 或 BRIDGE_TOKEN（游客只走 share/content）。
      const readDenied = checkAuth(request, token)
      if (readDenied) return readDenied
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
      if (method === 'GET') {
        // P0 安全收紧（Phase C）：文件原始读接口要求 session 或 BRIDGE_TOKEN（游客只走 share/content）。
        const readDenied = checkAuth(request, token)
        if (readDenied) return readDenied
        return serveDesignFileRel(rel, designRoot)
      }
      const denied = checkAuth(request, token)
      if (denied) return denied
      if (method === 'PUT') return saveFile(request, rel, true)
      if (method === 'POST') return saveFile(request, rel, false)
      if (method === 'DELETE') return deleteFile(rel)
      return methodNotAllowed()
    }

    // ---- 账号会话与成员管理（Phase A）----

    if (path === '/api/v1/auth/login') {
      if (method !== 'POST') return methodNotAllowed()
      return login(request)
    }

    if (path === '/api/v1/auth/logout') {
      if (method !== 'POST') return methodNotAllowed()
      return logout(request)
    }

    if (path === '/api/v1/auth/session') {
      if (method !== 'GET') return methodNotAllowed()
      return session(request)
    }

    if (path === '/api/v1/members') {
      if (method === 'GET') {
        const user = sessionUser(request)
        if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)
        // 成员明文密码仅 owner/admin 可见；member 调用方维持无密码响应。
        return listMembers(isAdminRole(user.role))
      }
      if (method === 'POST') {
        // 成员权限：仅管理员和所有者可操作。
        const user = adminUser(request)
        if (!user) {
          return sessionUser(request)
            ? json({ ok: false, error: 'Forbidden' }, 403)
            : json({ ok: false, error: 'Unauthorized' }, 401)
        }
        return createMember(request)
      }
      return methodNotAllowed()
    }

    const memberMatch = path.match(/^\/api\/v1\/members\/(.+)$/)
    if (memberMatch) {
      const raw = memberMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      const user = adminUser(request)
      if (!user) {
        return sessionUser(request)
          ? json({ ok: false, error: 'Forbidden' }, 403)
          : json({ ok: false, error: 'Unauthorized' }, 401)
      }
      const id = decodeURIComponent(raw)
      if (method === 'PATCH') return updateMember(request, id)
      if (method === 'DELETE') return deleteMember(id)
      return methodNotAllowed()
    }

    // ---- 头像（Phase G）----

    if (path === '/api/v1/avatars') {
      if (method !== 'POST') return methodNotAllowed()
      return uploadAvatar(request)
    }

    const avatarMatch = path.match(/^\/api\/v1\/avatars\/([^/]+)$/)
    if (avatarMatch) {
      const raw = avatarMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'GET') return methodNotAllowed()
      const fileName = decodeURIComponent(raw)
      return serveAvatar(request, fileName)
    }

    if (path === '/api/v1/permissions') {
      if (method === 'GET') return getPermissions(request)
      // Phase C：POST = 写文件级权限条目（分享面板成员/范围保存）。
      if (method === 'POST') return upsertFilePermission(request)
      return methodNotAllowed()
    }

    if (path === '/api/v1/permission-request') {
      if (method !== 'POST') return methodNotAllowed()
      return createPermissionRequest(request)
    }

    // ---- 通知中心（Phase D）----

    if (path === '/api/v1/notifications') {
      if (method !== 'GET') return methodNotAllowed()
      return listNotifications(request)
    }

    if (path === '/api/v1/notifications/read-all') {
      if (method !== 'POST') return methodNotAllowed()
      return markNotificationsRead(request)
    }

    const notificationMatch = path.match(/^\/api\/v1\/notifications\/([^/]+)\/action$/)
    if (notificationMatch) {
      const raw = notificationMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'POST') return methodNotAllowed()
      const id = decodeURIComponent(raw)
      return resolveNotificationAction(request, id)
    }

    // ---- 分享/外链（Phase C）----

    if (path === '/api/v1/share') {
      if (method === 'GET') return getShare(request)
      if (method === 'POST') return createShare(request)
      if (method === 'DELETE') return deleteShare(request)
      return methodNotAllowed()
    }

    if (path === '/api/v1/share/verify') {
      if (method !== 'GET') return methodNotAllowed()
      return verifyShare(request)
    }

    if (path === '/api/v1/share/password') {
      if (method !== 'GET') return methodNotAllowed()
      // 顺手收紧：随机密码生成仅 admin/owner（member 借接口可爆破探测）。
      const user = adminUser(request)
      if (!user) return adminDenied(request)
      return generateSharePassword()
    }

    const shareContentMatch = path.match(/^\/api\/v1\/share\/([^/]+)\/content$/)
    if (shareContentMatch) {
      const raw = shareContentMatch[1]
      if (raw === undefined) return json({ ok: false, error: 'not found' }, 404)
      if (method !== 'GET') return methodNotAllowed()
      const token = decodeURIComponent(raw)
      return serveShareContent(request, token)
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
    clearInterval(presenceSweepTimer)
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
