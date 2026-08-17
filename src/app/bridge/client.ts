import { AuthError, getSessionToken } from '@/app/auth/session'

export const BRIDGE_PROVIDER_ID = 'bridge-fs'

const DEFAULT_API_BASE = '/api/v1'
const RECENT_WRITE_MS = 1000
const POLL_MS = 2000
const PATH_THROTTLE_MS = 400
/** fetch keepalive 单请求载荷上限（超出时退回普通 fetch，见 putFileNow）。 */
const KEEPALIVE_MAX_BYTES = 64 * 1024

export interface BridgeFileInfo {
  path: string
  name: string
  ext: string
  size: number
  mtime: string
  updatedAt: string
}

export type BridgeFontInfo = BridgeFileInfo

export interface BridgeBrandGroup {
  brand: string
  files: BridgeFileInfo[]
}

export interface BridgeFileList {
  groups: BridgeBrandGroup[]
  flat: BridgeFileInfo[]
}

export interface BridgeActiveState {
  path?: string
  openedAt?: string
  updatedAt?: string
  session: string
}

export interface BridgeRecentEntry {
  path: string
  openedAt: string
}

export interface BridgeTrashEntry {
  path: string
  name: string
  ext: string
  type: 'file' | 'dir'
  size: number
  mtime: string
  updatedAt: string
}

/** 首页文件夹置顶台账条目（pinnedAt 为 ISO 时间，倒序排最前）。 */
export interface BridgePinEntry {
  name: string
  pinnedAt: string
}

/** 当前登录用户对某路径的权限解析结果（Phase B，打开/编辑前真实校验）。 */
export interface BridgePermission {
  canView: boolean
  canEdit: boolean
  scope: 'internet' | 'team' | 'self' | null
  source: 'file' | 'folder' | 'default'
  entryPath?: string
  members?: { userId: string; permission: 'view' | 'edit' | 'none' }[]
}

export interface BridgeFileEvent {
  type: 'file.changed' | 'file.created' | 'file.deleted' | 'active.changed' | 'online.changed'
  path: string
  brand?: string
  /** 仅 online.changed：该 path 的全量在线快照（服务端台账视图，前端无需合并）。 */
  users?: BridgePresenceUser[]
}

/** 在线协作者（POST/GET /api/v1/online 与 SSE online.changed 共用视图）。 */
export interface BridgePresenceUser {
  userId: string
  name: string
  avatar: { char: string; bg: string; image?: string }
}

type BridgeListener = (event: BridgeFileEvent) => void

/** SSE 事件 payload 的领域子集：仅消费 path/brand/users 字段。 */
interface BridgeSsePayload {
  path?: string
  brand?: string
  users?: BridgePresenceUser[]
}

function encodeRelPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** 写接口鉴权（Phase A）：优先用登录 session token，否则退回 BRIDGE_TOKEN。 */
export function authHeader(): string | null {
  const session = getSessionToken()
  return session ? `Bearer ${session}` : null
}

/**
 * file-bridge 浏览器客户端：REST 文件/状态 API + SSE 事件订阅 + 事件去重/防抖。
 * 供 storage provider、保存/重载管线、文件列表页共用。无外部依赖，可直接单测。
 */
export class BridgeClient {
  readonly apiBase: string
  readonly pollMs: number
  readonly recentWriteMs: number

  private configPromise: Promise<{ token?: string | null; designRoot?: string } | null> | null = null
  private eventSource: EventSource | null = null
  private listeners = new Set<BridgeListener>()
  private connected = false
  private seenSeqs = new Set<number>()
  private lastHandledAt = new Map<string, number>()
  /** 本会话发起的写（PUT）目标路径：在途时抑制 reload 自刷。 */
  private selfWriteInFlight = new Set<string>()
  /** 本会话最近一次 PUT 成功落盘后的服务器 mtime 水印（path → mtime）。用于精确自刷抑制，取代 1s 时间窗。 */
  private selfWriteMtime = new Map<string, string>()
  /** 同一路径的 PUT 串行队列：杜绝同一浏览器内 autosave/手动/兜底 PUT 并发覆写。 */
  private putQueues = new Map<string, Promise<BridgeFileInfo | null>>()

  constructor(options?: { apiBase?: string; pollMs?: number; recentWriteMs?: number }) {
    this.apiBase = options?.apiBase ?? DEFAULT_API_BASE
    this.pollMs = options?.pollMs ?? POLL_MS
    this.recentWriteMs = options?.recentWriteMs ?? RECENT_WRITE_MS
  }

  async getConfig(): Promise<{ token?: string | null; designRoot?: string } | null> {
    if (!this.configPromise) {
      this.configPromise = fetch(`${this.apiBase}/config`)
        .then(async (response) => {
          if (!response.ok) return null
          const data = (await response.json()) as { token?: string | null; designRoot?: string }
          return data
        })
        .catch(() => null)
    }
    return this.configPromise
  }

  async getToken(): Promise<string | null> {
    const config = await this.getConfig()
    return config?.token ?? null
  }

  /** 工作区根目录（file-bridge config 下发，如 /data/design），用于把绝对路径换算成相对路径。 */
  async getDesignRoot(): Promise<string | null> {
    const config = await this.getConfig()
    return config?.designRoot ?? null
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const sessionHeader = authHeader()
    if (sessionHeader) return { Authorization: sessionHeader }
    const token = await this.getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async listFiles(): Promise<BridgeFileList> {
    const response = await fetch(`${this.apiBase}/files`)
    if (!response.ok) throw new Error(`Bridge list files failed (${response.status})`)
    return (await response.json()) as BridgeFileList
  }

  async getFile(path: string): Promise<Uint8Array> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}`, {
      headers: await this.authHeaders()
    })
    if (!response.ok) throw new Error(`Bridge read failed (${response.status}): ${path}`)
    return new Uint8Array(await response.arrayBuffer())
  }
  async getFileMeta(path: string): Promise<BridgeFileInfo | null> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}/meta`, {
      headers: await this.authHeaders()
    })
    // B2：401（未登录/会话未就绪）抛 AuthError 不坍缩成 null；null 仅表示真 404。
    if (response.status === 401) throw new AuthError(response.status, `未登录或会话已失效：${path}`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Bridge meta failed (${response.status}): ${path}`)
    return (await response.json()) as BridgeFileInfo
  }

  async putFile(path: string, bytes: Uint8Array): Promise<BridgeFileInfo | null> {
    // 同一路径的写串行化（autosave / 手动保存 / MCP save_file / 兜底 PUT 共用）。
    // 避免多个写路径同时 PUT 同一文件导致服务端交错写坏（配合服务端原子写+队列）。
    const previous = this.putQueues.get(path) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(() => this.putFileNow(path, bytes))
    const tail = run.then(
      () => null,
      () => null
    )
    this.putQueues.set(path, tail)
    void tail.then(() => {
      if (this.putQueues.get(path) === tail) this.putQueues.delete(path)
      return null
    })
    return run
  }

  private async putFileNow(path: string, bytes: Uint8Array): Promise<BridgeFileInfo | null> {
    // Exact ArrayBuffer so fetch/UA can set Content-Length reliably.
    const payload = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    this.selfWriteInFlight.add(path)
    try {
      // keepalive 让「关页/刷新瞬间的 beforeunload flush」尽量送达而不被卸载掐断
      // （C1）。浏览器对 keepalive 请求有 64KiB 载荷上限，超出时退回普通 fetch，
      // 避免超限 TypeError 中断正常保存（autosave/手动保存不受影响）。
      const keepalive = payload.byteLength <= KEEPALIVE_MAX_BYTES
      const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...(await this.authHeaders()) },
        body: payload,
        keepalive
      })
      if (!response.ok) {
        throw new Error(`Bridge write failed (${response.status}): ${path}`)
      }
      // PUT 响应带回服务器落盘后的 mtime，作为本会话自写水印：后续该路径
      // 的任何「文件已变更」echo，只要 mtime 仍等于本次自写值就被视为本会话
      // 自己的写回而忽略（reloadFromDisk / watchPath 均校验此水印）。
      let meta: BridgeFileInfo | null = null
      try {
        const data = (await response.json()) as BridgeFileInfo | null
        if (data && typeof data.mtime === 'string') {
          meta = data
          this.selfWriteMtime.set(path, data.mtime)
        }
      } catch {
        // 旧服务端/非 JSON 响应：不解析 meta，保留时间窗兜底（不静默吞错）。
        console.warn('[bridge] PUT meta parse failed, falling back to time window', path)
      }
      return meta
    } finally {
      this.selfWriteInFlight.delete(path)
    }
  }

  async createFile(brand: string, name: string, format: 'fig' | 'pen' = 'fig'): Promise<string> {
    const response = await fetch(`${this.apiBase}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({ brand, name, format })
    })
    if (!response.ok) throw new Error(`Bridge create failed (${response.status})`)
    const data = (await response.json()) as { path?: string }
    if (!data.path) throw new Error('Bridge create returned no path')
    return data.path
  }

  async deleteFile(path: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}`, {
      method: 'DELETE',
      headers: await this.authHeaders()
    })
    if (!response.ok) throw new Error(`Bridge delete failed (${response.status}): ${path}`)
  }

  /** 创建文件夹（相对路径，可多段，mkdir recursive）。返回创建的目录相对路径。 */
  async createDir(path: string): Promise<string> {
    const response = await fetch(`${this.apiBase}/dirs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({ path })
    })
    if (!response.ok) throw new Error(`Bridge create dir failed (${response.status}): ${path}`)
    const data = (await response.json()) as { path?: string }
    if (!data.path) throw new Error('Bridge create dir returned no path')
    return data.path
  }

  /** 列出工作区所有目录（含空文件夹，排除回收站），相对路径数组。 */
  async listDirs(): Promise<string[]> {
    const response = await fetch(`${this.apiBase}/dirs`)
    if (!response.ok) throw new Error(`Bridge list dirs failed (${response.status})`)
    const data = (await response.json()) as { dirs?: string[] }
    return data.dirs ?? []
  }

  /** 列出置顶文件夹台账（pinnedAt 倒序）。 */
  async listPins(): Promise<BridgePinEntry[]> {
    const response = await fetch(`${this.apiBase}/pins`)
    if (!response.ok) throw new Error(`Bridge list pins failed (${response.status})`)
    const data = (await response.json()) as { pins?: BridgePinEntry[] }
    return data.pins ?? []
  }

  /** 置顶文件夹（幂等：重复置顶刷新 pinnedAt）。返回最新置顶条目。 */
  async pinFolder(path: string): Promise<BridgePinEntry> {
    const response = await fetch(`${this.apiBase}/pins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({ path })
    })
    if (!response.ok) throw new Error(`Bridge pin failed (${response.status}): ${path}`)
    const data = (await response.json()) as { pin?: BridgePinEntry }
    if (!data.pin) throw new Error('Bridge pin returned no pin')
    return data.pin
  }

  /** 取消置顶文件夹。 */
  async unpinFolder(path: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/pins/${encodeRelPath(path)}`, {
      method: 'DELETE',
      headers: await this.authHeaders()
    })
    if (!response.ok) throw new Error(`Bridge unpin failed (${response.status}): ${path}`)
  }

  /** 解析当前登录用户对某路径的权限（打开前校验；canView=false 时不得打开）。 */
  async getPermissions(path: string): Promise<BridgePermission> {
    const response = await fetch(`${this.apiBase}/permissions?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: authHeader() ?? '' }
    })
    if (!response.ok) throw new Error(`Bridge permissions failed (${response.status}): ${path}`)
    return (await response.json()) as BridgePermission
  }

  /** 无编辑权用户申请编辑权限（Phase B：POST → 服务端通知 owner/admin）。 */
  async requestPermission(path: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/permission-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() ?? '' },
      body: JSON.stringify({ path })
    })
    if (!response.ok) throw new Error(`Bridge permission request failed (${response.status}): ${path}`)
  }

  /** 重命名文件/文件夹（name 为单段新名，不含扩展名）。返回新相对路径。 */
  async renameFile(path: string, name: string): Promise<string> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({ name })
    })
    if (!response.ok) throw new Error(`Bridge rename failed (${response.status}): ${path}`)
    const data = (await response.json()) as { path?: string }
    if (!data.path) throw new Error('Bridge rename returned no path')
    return data.path
  }

  /** 移动文件/文件夹到目标目录（to 为相对目录路径，可空=根目录）。返回新相对路径。 */
  async moveFile(path: string, to: string): Promise<string> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({ to })
    })
    if (!response.ok) throw new Error(`Bridge move failed (${response.status}): ${path}`)
    const data = (await response.json()) as { path?: string }
    if (!data.path) throw new Error('Bridge move returned no path')
    return data.path
  }

  /** 移至回收站（软删：移动到工作区 .trash/ 下，保留原相对路径便于恢复）。 */
  async trashFile(path: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}/trash`, {
      method: 'POST',
      headers: await this.authHeaders()
    })
    if (!response.ok) throw new Error(`Bridge trash failed (${response.status}): ${path}`)
  }

  /** 列出回收站内容（path 为原相对路径，type 区分文件/文件夹）。 */
  async listTrash(): Promise<BridgeTrashEntry[]> {
    const response = await fetch(`${this.apiBase}/trash`)
    if (!response.ok) throw new Error(`Bridge list trash failed (${response.status})`)
    const data = (await response.json()) as { files?: BridgeTrashEntry[] }
    return data.files ?? []
  }

  /** 从回收站恢复到原相对路径。 */
  async restoreTrashFile(path: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/trash/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({ path })
    })
    if (!response.ok) throw new Error(`Bridge restore failed (${response.status}): ${path}`)
  }

  /** 彻底删除回收站文件/文件夹（不可恢复）。 */
  async deleteTrashFile(path: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/trash/${encodeRelPath(path)}`, {
      method: 'DELETE',
      headers: await this.authHeaders()
    })
    if (!response.ok) throw new Error(`Bridge trash delete failed (${response.status}): ${path}`)
  }

  /** 列出工作区 fonts/ 文件夹下的字体文件。 */
  async listFonts(): Promise<BridgeFontInfo[]> {
    const response = await fetch(`${this.apiBase}/fonts`)
    if (!response.ok) throw new Error(`Bridge list fonts failed (${response.status})`)
    const data = (await response.json()) as { fonts?: BridgeFontInfo[] }
    return data.fonts ?? []
  }

  /** 读取工作区字体文件字节（path 为 fonts/xxx.ttf 相对路径）。 */
  async getFont(path: string): Promise<Uint8Array> {
    const response = await fetch(`${this.apiBase}/fonts/${encodeRelPath(path.replace(/^fonts\//, ''))}`)
    if (!response.ok) throw new Error(`Bridge font fetch failed (${response.status}): ${path}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  /**
   * 解析协作房间号（P0 官方实时协作）：服务端 session 鉴权 + 编辑权限校验后由文档路径派生。
   * 供打开 bridge 文档后自动进房用；失败（未登录/无权限/网络异常）返回 null，不阻塞打开流程。
   */
  async resolveCollabRoom(path: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.apiBase}/collab/room?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: authHeader() ?? '' }
      })
      if (!response.ok) return null
      const data = (await response.json()) as { roomId?: unknown }
      return typeof data.roomId === 'string' ? data.roomId : null
    } catch {
      return null
    }
  }

  /** 上报活动文件（打开/切换 tab 时）。失败仅警告，不影响编辑。 */
  async reportActive(path: string): Promise<void> {
    await this.postState('/active', path)
  }

  /** 标记为「打开过」，供列表页最近打开排序。 */
  async reportRecent(path: string): Promise<void> {
    await this.postState('/recent', path)
  }

  private async postState(endpoint: string, path: string): Promise<void> {
    try {
      await fetch(`${this.apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
        body: JSON.stringify({ path })
      })
    } catch (error) {
      console.warn(`[bridge] ${endpoint} failed`, error)
    }
  }

  async getActive(): Promise<BridgeActiveState | null> {
    const response = await fetch(`${this.apiBase}/active`)
    if (!response.ok) return null
    return (await response.json()) as BridgeActiveState
  }

  async getRecent(): Promise<BridgeRecentEntry[]> {
    const response = await fetch(`${this.apiBase}/recent`)
    if (!response.ok) return []
    const data = (await response.json()) as { recents?: BridgeRecentEntry[] }
    return data.recents ?? []
  }

  /** 上报文档在线心跳（login，8s 节奏由 useDocumentPresence 的调用方控制）。失败仅警告。 */
  async reportOnline(path: string): Promise<BridgePresenceUser[]> {
    try {
      const response = await fetch(`${this.apiBase}/online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
        body: JSON.stringify({ path })
      })
      if (!response.ok) return []
      const data = (await response.json()) as { users?: BridgePresenceUser[] }
      return data.users ?? []
    } catch (error) {
      console.warn('[bridge] online heartbeat failed', error)
      return []
    }
  }

  /** 拉取某文档当前在线快照（login，挂载时自愈用）。 */
  async getOnline(path: string): Promise<BridgePresenceUser[]> {
    try {
      const response = await fetch(
        `${this.apiBase}/online?path=${encodeURIComponent(path)}`,
        { headers: await this.authHeaders() }
      )
      if (!response.ok) return []
      const data = (await response.json()) as { users?: BridgePresenceUser[] }
      return data.users ?? []
    } catch (error) {
      console.warn('[bridge] online snapshot failed', error)
      return []
    }
  }

  get isConnected(): boolean {
    return this.connected
  }

  /** 订阅全部文件/active 事件（列表页用于实时刷新）。返回退订函数。 */
  subscribe(listener: BridgeListener): () => void {
    this.listeners.add(listener)
    this.ensureConnection()
    return () => this.listeners.delete(listener)
  }

  ensureConnection(): void {
    if (this.eventSource) return
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(`${this.apiBase}/events`)
    this.eventSource = source

    const handle = (event: MessageEvent): void => {
      const seq = Number(event.lastEventId)
      if (Number.isFinite(seq) && seq > 0 && this.seenSeqs.has(seq)) return
      if (Number.isFinite(seq) && seq > 0) {
        if (this.seenSeqs.size > 200) this.seenSeqs.clear()
        this.seenSeqs.add(seq)
      }
      let data: BridgeSsePayload = {}
      try {
        data = JSON.parse(event.data)
      } catch (error) {
        console.warn('[bridge] failed to parse event payload', error)
      }
      const type = event.type as BridgeFileEvent['type']
      const path = typeof data.path === 'string' ? data.path : ''
      if (!path) return
      this.dispatch({
        type,
        path,
        brand: typeof data.brand === 'string' ? data.brand : undefined,
        users: Array.isArray(data.users) ? data.users : undefined
      })
    }

    source.addEventListener('file.changed', handle)
    source.addEventListener('file.created', handle)
    source.addEventListener('file.deleted', handle)
    source.addEventListener('active.changed', handle)
    source.addEventListener('online.changed', handle)

    source.onopen = () => {
      this.connected = true
    }
    source.onerror = () => {
      // EventSource 自动重连；断线期间由 watchPath 的轮询兜底。
      this.connected = false
    }
  }

  private dispatch(event: BridgeFileEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.warn('[bridge] listener error', error)
      }
    }
  }

  private isThrottled(path: string): boolean {
    const now = Date.now()
    const last = this.lastHandledAt.get(path) ?? 0
    if (now - last < PATH_THROTTLE_MS) return true
    if (this.lastHandledAt.size > 100) this.lastHandledAt.clear()
    this.lastHandledAt.set(path, now)
    return false
  }

  /** 本会话自己的写是否「在途或刚完成」。是则跳过文件变化重载。 */
  private isSelfWrite(path: string): boolean {
    return this.selfWriteInFlight.has(path)
  }

  /**
   * 精确自写水印校验：磁盘当前 mtime 是否等于本会话最近一次 PUT 成功落盘的 mtime。
   * 相等 → 该变更事件是本会话自己的写回 echo，应忽略（不再依赖 1s 时间窗；
   * NAS/WebDAV 上 fs.watch echo 延迟超过 1s 也能正确识别）。
   */
  async isSelfWriteEcho(path: string): Promise<boolean> {
    const expected = this.selfWriteMtime.get(path)
    if (!expected) return false
    // 无法读取 meta（网络/桥接瞬时失败）时按「非自写」处理（不抑制），避免 unhandled rejection。
    const meta = await this.getFileMeta(path).catch(() => null)
    return meta?.mtime === expected
  }

  /**
   * 订阅单个文档的外部变化并触发重载：SSE 为主；SSE 断线时回退到
   * mtime 轮询。自刷抑制用「mtime 水印」精确比对（isSelfWriteEcho），
   * 时间窗（getLastWriteTime + recentWriteMs）仅作为非 bridge 写路径兜底。
   */
  watchPath(path: string, getLastWriteTime: () => number, reloadFromDisk: () => void): () => void {
    this.ensureConnection()
    let lastMtime = ''
    void this.getFileMeta(path)
      .then((meta) => {
        lastMtime = meta?.mtime ?? ''
        return lastMtime
      })
      .catch(() => undefined)

    const handleEvent = async (event: BridgeFileEvent): Promise<void> => {
      try {
        if (event.type !== 'file.changed' && event.type !== 'file.created') return
        if (event.path !== path) return
        // 本会话自己的写（在途）不回读重载。
        if (this.isSelfWrite(path)) return
        // 精确水印：磁盘 mtime 与本会话最近一次自写一致 → 自己的 echo，忽略。
        if (await this.isSelfWriteEcho(path)) return
        if (Date.now() - getLastWriteTime() < this.recentWriteMs) return
        if (this.isThrottled(path)) return
        reloadFromDisk()
      } catch (error) {
        console.warn('[bridge] watchPath handleEvent failed', error)
      }
    }
    const unsubscribe = this.subscribe((event) => {
      void handleEvent(event)
    })

    // SSE 断线轮询是 BridgeClient 自有的 service-owned 定时器（AGENTS.md：
    // 此类重连/兜底定时器可手写 interval，client.ts 保持零外部依赖可直接单测），
    // 故刻意不使用 useIntervalFn。
    let pollTimer: ReturnType<typeof setInterval> | null = null
    const stopPoll = (): void => {
      if (pollTimer) {
        // oxlint-disable-next-line open-pencil/prefer-vueuse-intervals
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
    const startPoll = (): void => {
      if (pollTimer) return
      // oxlint-disable-next-line open-pencil/prefer-vueuse-intervals
      pollTimer = setInterval(() => {
        if (this.connected) return
        void this.getFileMeta(path)
          .then(async (meta) => {
            const mtime = meta?.mtime ?? ''
            if (!mtime || mtime === lastMtime) return mtime
            lastMtime = mtime
            if (this.isSelfWrite(path)) return mtime
            if (await this.isSelfWriteEcho(path)) return mtime
            if (Date.now() - getLastWriteTime() < this.recentWriteMs) return mtime
            reloadFromDisk()
            return mtime
          })
          .catch(() => undefined)
      }, this.pollMs)
    }
    startPoll()

    return () => {
      unsubscribe()
      stopPoll()
    }
  }
}

export const bridgeClient = new BridgeClient()
