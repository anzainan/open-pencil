import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ActiveState {
  path?: string
  openedAt?: string
  updatedAt?: string
  session: string
}

type PersistedActive = Omit<ActiveState, 'session'>

export interface RecentEntry {
  path: string
  openedAt: string
}

const MAX_RECENT = 20

/**
 * active.json / recent.json 状态存储：内存缓存 + 原子写盘（tmp + rename）。
 *
 * active 语义（REQ-4）：从「全局最后激活」改为**按用户（owner 维度）记录**。
 *  - primary（owner）记录仍写 active.json 顶层 `path/openedAt/updatedAt`（op 脚本
 *    降级直读、AI 默认视窗兼容，shape 不变）；
 *  - 其余已登录用户的活动记录存入 `users` 子表，互不覆盖——同事窗口/并发打开不改变
 *    owner（安在南）的默认视野，AI 经 bridge（无 session）默认看到 owner 的记录。
 */
export class StateStore {
  readonly session: string

  /** primary（owner/默认）活动记录：active.json 顶层字段，AI 默认视窗。 */
  private active: ActiveState
  /** 其它登录用户的活动记录（key = userId，非 owner 也各自独立）。 */
  private activeByUser = new Map<string, PersistedActive>()

  private recent: RecentEntry[] = []

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.session = randomUUID()
    this.active = { session: this.session }
    this.load()
    this.active.session = this.session
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'active.json'), 'utf8'))
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const { path, openedAt, updatedAt, users } = raw as Record<string, unknown>
        if (typeof path === 'string') this.active.path = path
        if (typeof openedAt === 'string') this.active.openedAt = openedAt
        if (typeof updatedAt === 'string') this.active.updatedAt = updatedAt
        if (users && typeof users === 'object' && !Array.isArray(users)) {
          for (const [userId, record] of Object.entries(users)) {
            if (
              record &&
              typeof record === 'object' &&
              !Array.isArray(record) &&
              typeof (record as PersistedActive).path === 'string'
            ) {
              this.activeByUser.set(userId, record as PersistedActive)
            }
          }
        }
      }
    } catch {
      // 首次启动或文件损坏 → 用默认空状态
    }
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'recent.json'), 'utf8'))
      if (Array.isArray(raw)) {
        this.recent = raw
          .filter((item): item is RecentEntry => item && typeof item.path === 'string' && typeof item.openedAt === 'string')
          .slice(0, MAX_RECENT)
      }
    } catch {
      // 同上
    }
  }

  private persist(name: string, data: unknown): void {
    const file = join(this.dir, name)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, file)
  }

  private persistActive(): void {
    const persisted: PersistedActive & { users: Record<string, PersistedActive> } = {
      path: this.active.path,
      openedAt: this.active.openedAt,
      updatedAt: this.active.updatedAt,
      users: Object.fromEntries(this.activeByUser)
    }
    this.persist('active.json', persisted)
  }

  /** 解析读/写的 owner 维度 key：显式 userId 命中则用之，否则回落 primary（owner）。 */
  private keyFor(userId: string | null | undefined): string | null {
    return userId && userId.length > 0 ? userId : null
  }

  getActive(userId?: string | null): ActiveState {
    const key = this.keyFor(userId)
    const record = key ? this.activeByUser.get(key) : undefined
    if (record) return { ...record, session: this.session }
    return { ...this.active, session: this.session }
  }

  setActive(path: string, userId?: string | null): ActiveState {
    const now = new Date().toISOString()
    const key = this.keyFor(userId)
    const samePath = key
      ? this.activeByUser.get(key)?.path === path
      : this.active.path === path
    if (samePath) {
      const updatedAt = now
      if (key) {
        const prev = this.activeByUser.get(key)
        this.activeByUser.set(key, {
          path,
          openedAt: prev?.openedAt ?? now,
          updatedAt
        })
      } else {
        this.active.updatedAt = updatedAt
      }
    } else if (key) {
      this.activeByUser.set(key, { path, openedAt: now, updatedAt: now })
    } else {
      this.active = { path, openedAt: now, updatedAt: now, session: this.session }
    }
    this.persistActive()
    return this.getActive(userId)
  }

  getRecent(): RecentEntry[] {
    return [...this.recent]
  }

  addRecent(path: string): RecentEntry[] {
    this.recent = this.recent.filter((entry) => entry.path !== path)
    this.recent.unshift({ path, openedAt: new Date().toISOString() })
    this.recent = this.recent.slice(0, MAX_RECENT)
    this.persist('recent.json', this.recent)
    return this.getRecent()
  }
}
