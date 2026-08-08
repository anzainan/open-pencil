export const BRIDGE_PROVIDER_ID = 'bridge-fs'

const DEFAULT_API_BASE = '/api/v1'
const RECENT_WRITE_MS = 1000
const POLL_MS = 2000
const PATH_THROTTLE_MS = 400

export interface BridgeFileInfo {
  path: string
  name: string
  ext: string
  size: number
  mtime: string
  updatedAt: string
}

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

export interface BridgeFileEvent {
  type: 'file.changed' | 'file.created' | 'file.deleted' | 'active.changed'
  path: string
  brand?: string
}

type BridgeListener = (event: BridgeFileEvent) => void

/** SSE 事件 payload 的领域子集：仅消费 path/brand 字段。 */
interface BridgeSsePayload {
  path?: string
  brand?: string
}

function encodeRelPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/**
 * file-bridge 浏览器客户端：REST 文件/状态 API + SSE 事件订阅 + 事件去重/防抖。
 * 供 storage provider、保存/重载管线、文件列表页共用。无外部依赖，可直接单测。
 */
export class BridgeClient {
  readonly apiBase: string
  readonly pollMs: number
  readonly recentWriteMs: number

  private token: string | null = null
  private tokenPromise: Promise<string | null> | null = null
  private eventSource: EventSource | null = null
  private listeners = new Set<BridgeListener>()
  private connected = false
  private seenSeqs = new Set<number>()
  private lastHandledAt = new Map<string, number>()

  constructor(options?: { apiBase?: string; pollMs?: number; recentWriteMs?: number }) {
    this.apiBase = options?.apiBase ?? DEFAULT_API_BASE
    this.pollMs = options?.pollMs ?? POLL_MS
    this.recentWriteMs = options?.recentWriteMs ?? RECENT_WRITE_MS
  }

  async getToken(): Promise<string | null> {
    if (this.token !== null) return this.token
    if (!this.tokenPromise) {
      this.tokenPromise = fetch(`${this.apiBase}/config`)
        .then(async (response) => {
          if (!response.ok) return null
          const data = (await response.json()) as { token?: string | null }
          this.token = data.token || null
          return this.token
        })
        .catch(() => null)
    }
    return this.tokenPromise
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async listFiles(): Promise<BridgeFileList> {
    const response = await fetch(`${this.apiBase}/files`)
    if (!response.ok) throw new Error(`Bridge list files failed (${response.status})`)
    return (await response.json()) as BridgeFileList
  }

  async getFile(path: string): Promise<Uint8Array> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}`)
    if (!response.ok) throw new Error(`Bridge read failed (${response.status}): ${path}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async getFileMeta(path: string): Promise<BridgeFileInfo | null> {
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}/meta`)
    if (!response.ok) return null
    return (await response.json()) as BridgeFileInfo
  }

  async putFile(path: string, bytes: Uint8Array): Promise<void> {
    // Exact ArrayBuffer so fetch/UA can set Content-Length reliably.
    const payload = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    const response = await fetch(`${this.apiBase}/files/${encodeRelPath(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...(await this.authHeaders()) },
      body: payload
    })
    if (!response.ok) {
      throw new Error(`Bridge write failed (${response.status}): ${path}`)
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
        brand: typeof data.brand === 'string' ? data.brand : undefined
      })
    }

    source.addEventListener('file.changed', handle)
    source.addEventListener('file.created', handle)
    source.addEventListener('file.deleted', handle)
    source.addEventListener('active.changed', handle)

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

  /**
   * 订阅单个文档的外部变化并触发重载：SSE 为主；SSE 断线时回退到
   * mtime 轮询。getLastWriteTime 用于「本会话自己写过则忽略」防自刷。
   */
  watchPath(path: string, getLastWriteTime: () => number, reloadFromDisk: () => void): () => void {
    this.ensureConnection()
    let lastMtime = ''
    void this.getFileMeta(path).then((meta) => {
      lastMtime = meta?.mtime ?? ''
      return lastMtime
    })

    const handleEvent = (event: BridgeFileEvent): void => {
      if (event.type !== 'file.changed' && event.type !== 'file.created') return
      if (event.path !== path) return
      if (Date.now() - getLastWriteTime() < this.recentWriteMs) return
      if (this.isThrottled(path)) return
      reloadFromDisk()
    }
    const unsubscribe = this.subscribe(handleEvent)

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
        void this.getFileMeta(path).then((meta) => {
          const mtime = meta?.mtime ?? ''
          if (!mtime || mtime === lastMtime) return mtime
          lastMtime = mtime
          if (Date.now() - getLastWriteTime() < this.recentWriteMs) return mtime
          reloadFromDisk()
          return mtime
        })
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
