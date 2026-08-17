import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Server } from 'bun'

type ServerOptions = {
  port: number
  distDir: string
  designRoot: string
  stateDir: string
  token: string
}

let startServer: ((options: ServerOptions) => Server) | null = null
let deriveRoomId: ((secret: string, path: string) => string) | null = null
beforeAll(async () => {
  const serverModule = await import(
    join(import.meta.dir, '..', '..', '..', '..', 'custom', 'file-bridge', 'server.ts')
  )
  const startServerExport = serverModule.startServer as (options: ServerOptions) => Server
  startServer = startServerExport
  const roomIdModule = await import(
    join(import.meta.dir, '..', '..', '..', '..', 'custom', 'file-bridge', 'lib', 'room-id.ts')
  )
  deriveRoomId = roomIdModule.deriveRoomId as (secret: string, path: string) => string
})

/**
 * P0 官方实时协作服务端（custom/file-bridge/server.ts）断言：
 * - GET /api/v1/collab/room：未鉴权 401 / 无编辑权限 403 / 正常 200 + 稳定派生 roomId；
 * - 同一 path 不同用户拿到同一房间号（同文件聚同房）；异 path 不同房间；
 * - /api/v1/config 扩展 collab 字段：env 注入下发 / 未配置 null（保持向后兼容）。
 *
 * 起真实 file-bridge 进程内 http server（Bun.serve），走网络层全链路验证。
 */
const DEFAULT_OWNER = { name: '安在南', password: 'zhangzainan' }

let currentServer: Server | null = null
let currentBase = ''
let currentEnvBackup = new Map<string, string | undefined>()
let currentInjectedKeys: string[] = []

function tempRoot(): string {
  const dir = join(tmpdir(), `op-collab-test-${process.pid}-${randomUUID()}`)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  mkdirSync(join(dir, 'design'), { recursive: true })
  mkdirSync(join(dir, 'state'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'index.html'), '<html>collab test</html>')
  return dir
}

async function startTestServer(env: Record<string, string> = {}): Promise<string> {
  if (currentServer) await stopTestServer()
  if (!startServer) throw new Error('startServer not loaded')
  const root = tempRoot()
  // 备份并注入测试 env（config 路由在请求期读 env，需在测试期间保持注入）。
  currentEnvBackup = new Map(Object.entries(process.env))
  currentInjectedKeys = Object.keys(env)
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  const server = startServer({
    port: 0,
    distDir: join(root, 'dist'),
    designRoot: join(root, 'design'),
    stateDir: join(root, 'state'),
    token: 'test-bridge-token'
  })
  currentServer = server
  currentBase = `http://127.0.0.1:${server.port}`
  return currentBase
}

async function stopTestServer(): Promise<void> {
  if (currentServer) {
    currentServer.stop(true)
    currentServer = null
  }
  // 恢复进程 env（残留注入不得污染其它测试）。
  for (const key of currentInjectedKeys) Reflect.deleteProperty(process.env, key)
  for (const [k, v] of currentEnvBackup) {
    if (v === undefined) Reflect.deleteProperty(process.env, k)
    else process.env[k] = v
  }
  currentInjectedKeys = []
  currentEnvBackup = new Map()
  currentBase = ''
}

async function login(name: string, password: string): Promise<string> {
  const response = await fetch(`${currentBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  })
  const data = (await response.json()) as { token?: string }
  if (!response.ok || !data.token) throw new Error(`login failed for ${name}`)
  return data.token
}

async function createMember(token: string, name: string, password: string): Promise<string> {
  const response = await fetch(`${currentBase}/api/v1/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, password, role: 'member' })
  })
  const data = (await response.json()) as { user?: { id?: string } }
  if (!response.ok || !data.user?.id) throw new Error(`create member failed for ${name}`)
  return data.user.id
}

async function joinRoom(token: string | null, path: string): Promise<Response> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${currentBase}/api/v1/collab/room?path=${encodeURIComponent(path)}`, { headers })
}

afterEach(async () => {
  await stopTestServer()
})

describe('GET /api/v1/collab/room（P0 官方实时协作房间门控派生）', () => {
  test('未鉴权 → 401（游客不泄露房间号）', async () => {
    await startTestServer()
    const response = await joinRoom(null, 'PixelMob/login.fig')
    expect(response.status).toBe(401)
    const body = (await response.json()) as { ok?: boolean }
    expect(body.ok).toBe(false)
  })

  test('已登录但无编辑权限（成员对未授权路径）→ 403', async () => {
    await startTestServer()
    const ownerToken = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    await createMember(ownerToken, 'collab viewer', 'viewerpass1')
    const memberToken = await login('collab viewer', 'viewerpass1')

    // 成员未被加进任意文件/文件夹权限 → resolvePermission 默认无权限 → 403。
    const response = await joinRoom(memberToken, 'PixelMob/private.fig')
    expect(response.status).toBe(403)
  })

  test('已登录 + 编辑权限（owner 对任意路径）→ 200 + 稳定派生 roomId', async () => {
    await startTestServer()
    const ownerToken = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)

    const response = await joinRoom(ownerToken, 'PixelMob/login.fig')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok?: boolean; roomId?: string }
    expect(body.ok).toBe(true)
    expect(body.roomId).toMatch(/^[a-z0-9]{8}$/)
  })

  test('同一 path 不同用户 → 同一房间号（同文件聚同房）', async () => {
    await startTestServer()
    const ownerToken = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    const editorUserId = await createMember(ownerToken, 'collab editor', 'editorpass1')
    // 给该成员该文件编辑权限（分享面板同款：文件级 entry + 成员 edit）。
    const permResponse = await fetch(`${currentBase}/api/v1/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        path: 'PixelMob/login.fig',
        scope: 'team',
        members: [{ userId: editorUserId, permission: 'edit' }]
      })
    })
    expect(permResponse.status).toBe(200)
    const memberToken = await login('collab editor', 'editorpass1')

    const ownerBody = (await (await joinRoom(ownerToken, 'PixelMob/login.fig')).json()) as {
      roomId?: string
    }
    const memberBody = (await (await joinRoom(memberToken, 'PixelMob/login.fig')).json()) as {
      roomId?: string
    }
    expect(memberBody.roomId).toBe(ownerBody.roomId)
    expect(ownerBody.roomId).toMatch(/^[a-z0-9]{8}$/)
  })

  test('异 path → 异房间号（HMAC 雪崩，同用户不同文件不串房）', async () => {
    await startTestServer()
    const ownerToken = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    const roomA = (await (await joinRoom(ownerToken, 'PixelMob/login.fig')).json()) as {
      roomId?: string
    }
    const roomB = (await (await joinRoom(ownerToken, 'PixelMob/home.fig')).json()) as {
      roomId?: string
    }
    expect(roomA.roomId).not.toBe(roomB.roomId)
  })

  test('服务端派生与 room-id.ts 直算一致（同 secret 同 path 同结果）', async () => {
    // 测试服务端与客户端 SHA256 8 字节映射逻辑一致：COLLAB_ROOM_SECRET 即当前 secret。
    await startTestServer({ COLLAB_ROOM_SECRET: 'test-room-secret' })
    const ownerToken = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    const body = (await (await joinRoom(ownerToken, 'PixelMob/login.fig')).json()) as {
      roomId?: string
    }
    expect(body.roomId).toBe(
      (deriveRoomId as (secret: string, path: string) => string)(
        'test-room-secret',
        'PixelMob/login.fig'
      )
    )
  })

  test('空 path / 非法 path → 400（不派生）', async () => {
    await startTestServer()
    const ownerToken = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    const response = await joinRoom(ownerToken, '')
    expect(response.status).toBe(400)
    const badPath = await joinRoom(ownerToken, '../escape.fig')
    expect(badPath.status).toBe(400)
  })
})

describe('/api/v1/config collab 字段（P0 传输配置下发）', () => {
  test('env 注入 → 下发 collabBrokerUrl / collabIceServers / collabWsRelayUrl', async () => {
    await startTestServer({
      COLLAB_BROKER_URL: 'wss://collab.local:9001/mqtt',
      COLLAB_ICE_SERVERS_JSON:
        '[{"urls":["stun:10.0.0.1:3478"]},{"urls":["stun:stun.local:3478"]}]',
      COLLAB_WS_RELAY_URL: 'wss://hub.local/collab-ws'
    })
    const token = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    const response = await fetch(`${currentBase}/api/v1/config`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      collab?: {
        collabBrokerUrl: string | null
        collabIceServers: { urls: string | string[] }[] | null
        collabWsRelayUrl: string | null
      }
    }
    expect(body.collab).toBeDefined()
    expect(body.collab?.collabBrokerUrl).toBe('wss://collab.local:9001/mqtt')
    expect(body.collab?.collabIceServers).toEqual([
      { urls: ['stun:10.0.0.1:3478'] },
      { urls: ['stun:stun.local:3478'] }
    ])
    expect(body.collab?.collabWsRelayUrl).toBe('wss://hub.local/collab-ws')
  })

  test('未配置 → collab 字段为 null（浏览器回退官方默认传输，向后兼容）', async () => {
    await startTestServer()
    const token = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    const response = await fetch(`${currentBase}/api/v1/config`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const body = (await response.json()) as {
      collab: {
        collabBrokerUrl: string | null
        collabIceServers: null
        collabWsRelayUrl: string | null
      }
    }
    expect(body.collab.collabBrokerUrl).toBeNull()
    expect(body.collab.collabIceServers).toBeNull()
    expect(body.collab.collabWsRelayUrl).toBeNull()
  })

  test('非法 COLLAB_ICE_SERVERS_JSON → collabIceServers 为 null（不崩溃、不误配）', async () => {
    await startTestServer({ COLLAB_ICE_SERVERS_JSON: '{not-json' })
    const token = await login(DEFAULT_OWNER.name, DEFAULT_OWNER.password)
    const response = await fetch(`${currentBase}/api/v1/config`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const body = (await response.json()) as { collab: { collabIceServers: null } }
    expect(body.collab.collabIceServers).toBeNull()
  })

  test('未登录 /config 不泄露 collab 传输配置（P0 安全收紧）', async () => {
    await startTestServer({
      COLLAB_BROKER_URL: 'wss://collab.local:9001/mqtt'
    })
    const response = await fetch(`${currentBase}/api/v1/config`)
    const body = (await response.json()) as { collab?: unknown }
    expect(body.collab).toBeUndefined()
  })
})

describe('REQ-4/5：active 按用户隔离 + bridge MCP 标注 owner 活动文件', () => {
  const OWNER = { name: '安在南', password: 'zhangzainan' }

  async function postActive(token: string | null, path: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(`${currentBase}/api/v1/active`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path })
    })
  }

  async function getActive(token: string | null): Promise<Response> {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(`${currentBase}/api/v1/active`, { headers })
  }

  test('A/B 两人并发：各自记录互不覆盖；无 session（AI/桥接）默认看到 owner（安在南）', async () => {
    await startTestServer()
    const ownerToken = await login(OWNER.name, OWNER.password)
    // 成员 B：创建账号（副作用），登录后也打开一个文件。
    await createMember(ownerToken, 'collab B', 'bpass123')
    const memberToken = await login('collab B', 'bpass123')

    // owner（A）打开 PixelMob/login.fig
    expect((await postActive(ownerToken, 'PixelMob/login.fig')).status).toBe(200)
    // 成员 B 打开自己的文件（不覆盖 owner）
    expect((await postActive(memberToken, 'PixelMob/b.fig')).status).toBe(200)

    // 各自 session 读回自己的记录。
    const ownerBody = (await (await getActive(ownerToken)).json()) as { path?: string }
    expect(ownerBody.path).toBe('PixelMob/login.fig')
    const memberBody = (await (await getActive(memberToken)).json()) as { path?: string }
    expect(memberBody.path).toBe('PixelMob/b.fig')

    // 无 session（AI / op 脚本走 BRIDGE_TOKEN）→ 默认视窗 = owner（安在南）的记录。
    const anonBody = (await (await getActive(null)).json()) as { path?: string }
    expect(anonBody.path).toBe('PixelMob/login.fig')
  })

  test('AI 显式指定文件能力不变：list_documents（bridge MCP）列出并标注 owner 活动文件', async () => {
    await startTestServer()
    const ownerToken = await login(OWNER.name, OWNER.password)
    expect((await postActive(ownerToken, 'PixelMob/login.fig')).status).toBe(200)
    // 写一个真实存在的文件，让 bridge_list_files 能扫到。
    const writeRes = await fetch(`${currentBase}/api/v1/files/PixelMob%2Flogin.fig`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${ownerToken}`
      },
      body: new Uint8Array([1, 2, 3, 4])
    })
    expect(writeRes.status).toBe(200)

    // 通过 bridge MCP 调用 bridge_list_files（带 BRIDGE_TOKEN，无 session = AI 视角）。
    // 测试环境未开上游 MCP（MCP_AUTH_TOKEN 空）→ 桥接工具挂载在 /mcp。
    const mcpRes = await fetch(`${currentBase}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'bridge_list_files', arguments: {} }
      })
    })
    expect(mcpRes.status).toBe(200)
    const mcpBody = (await mcpRes.json()) as {
      result?: { content?: Array<{ type: string; text?: string }> }
    }
    const text = mcpBody.result?.content?.[0]?.text ?? ''
    const listing = JSON.parse(text) as {
      flat: Array<{ path: string; active: boolean }>
      activePath: string | null
    }
    expect(listing.activePath).toBe('PixelMob/login.fig')
    const loginEntry = listing.flat.find((f) => f.path === 'PixelMob/login.fig')
    expect(loginEntry?.active).toBe(true)
  })
})
