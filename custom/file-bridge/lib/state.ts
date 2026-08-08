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

/** active.json / recent.json 状态存储：内存缓存 + 原子写盘（tmp + rename）。 */
export class StateStore {
  readonly session: string

  private active: ActiveState
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
        const { path, openedAt, updatedAt } = raw as Record<string, unknown>
        if (typeof path === 'string') this.active.path = path
        if (typeof openedAt === 'string') this.active.openedAt = openedAt
        if (typeof updatedAt === 'string') this.active.updatedAt = updatedAt
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
    const persisted: PersistedActive = {
      path: this.active.path,
      openedAt: this.active.openedAt,
      updatedAt: this.active.updatedAt
    }
    this.persist('active.json', persisted)
  }

  getActive(): ActiveState {
    return { ...this.active, session: this.session }
  }

  setActive(path: string): ActiveState {
    const now = new Date().toISOString()
    if (this.active.path === path) {
      this.active.updatedAt = now
    } else {
      this.active = { path, openedAt: now, updatedAt: now, session: this.session }
    }
    this.persistActive()
    return this.getActive()
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
