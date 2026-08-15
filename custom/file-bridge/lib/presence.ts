import type { EventBus } from './events'

/** 在线协作者对外视图（排除 lastActive 等内部字段，SSE/API 共用）。 */
export interface PresenceUser {
  userId: string
  name: string
  avatar: { char: string; bg: string; image?: string }
}

interface PresenceEntry {
  name: string
  avatar: { char: string; bg: string; image?: string }
  lastActive: number
}

/** 心跳超时（毫秒）：lastActive 超过该值即视为离线，由 sweep 清理并广播离开。 */
const PRESENCE_TTL_MS = 15_000

/**
 * 文档在线台账（内存级，C-live 方案二）：
 * `Map<documentPath, Map<userId, entry>>`。心跳 upsert 刷新 lastActive；
 * sweep 周期清理超时条目。每次变更广播 `online.changed`（携带该 path 全量快照），
 * 前端无需自行合并。服务端单实例，不落盘。
 */
export class PresenceStore {
  private readonly online = new Map<string, Map<string, PresenceEntry>>()

  constructor(private readonly bus: EventBus) {}

  /** 心跳/打开：刷新或新增该用户在该文档上的在线记录，并广播最新快照。 */
  upsert(
    path: string,
    user: { userId: string; name: string; avatar: { char: string; bg: string; image?: string } }
  ): PresenceUser[] {
    const byPath = this.pathMap(path)
    byPath.set(user.userId, { name: user.name, avatar: user.avatar, lastActive: Date.now() })
    return this.broadcast(path)
  }

  /** 显式离开（关页/退出登录等调用；sweep 超时也会清理）。 */
  remove(path: string, userId: string): PresenceUser[] {
    const byPath = this.online.get(path)
    if (!byPath) return this.snapshot(path)
    if (!byPath.delete(userId)) return this.snapshot(path)
    if (byPath.size === 0) this.online.delete(path)
    return this.broadcast(path)
  }

  /** 该文档当前在线用户（对外视图，无内部字段）。 */
  snapshot(path: string): PresenceUser[] {
    const byPath = this.online.get(path)
    if (!byPath) return []
    return [...byPath.entries()].map(([userId, entry]) => ({
      userId,
      name: entry.name,
      avatar: { ...entry.avatar }
    }))
  }

  /** 清理所有路径下超时条目；返回被移除的 {path, userId} 列表（调用方按需广播）。 */
  sweep(now = Date.now()): { path: string; userId: string }[] {
    const removed: { path: string; userId: string }[] = []
    for (const [path, byPath] of this.online) {
      for (const [userId, entry] of byPath) {
        if (now - entry.lastActive > PRESENCE_TTL_MS) {
          byPath.delete(userId)
          removed.push({ path, userId })
        }
      }
      if (byPath.size === 0) this.online.delete(path)
    }
    return removed
  }

  private pathMap(path: string): Map<string, PresenceEntry> {
    let byPath = this.online.get(path)
    if (!byPath) {
      byPath = new Map<string, PresenceEntry>()
      this.online.set(path, byPath)
    }
    return byPath
  }

  private broadcast(path: string): PresenceUser[] {
    const users = this.snapshot(path)
    this.bus.broadcast('online.changed', { path, users })
    return users
  }
}
