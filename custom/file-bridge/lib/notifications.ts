import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { OPENPENCIL_REL_DIR } from './paths'

/** 通知类型：Phase B 先支持权限申请类；其余为后续阶段预留。 */
export type NotificationType = 'permission_request' | 'join_request' | 'permission_change' | 'removed'

export type NotificationStatus = 'unread' | 'read' | 'approved' | 'rejected'

export interface NotificationItem {
  id: string
  type: NotificationType
  /** 发起人（如「小田 请求编辑权限」）。 */
  fromUserId: string
  /** 接收人（管理员/所有者；Phase D 通知中心 UI 按人拉取）。 */
  targetUserId?: string
  /** 关联文件相对路径（可空）。 */
  path?: string
  title: string
  detail: string
  status: NotificationStatus
  createdAt: string
}

interface NotificationLedger {
  version: 1
  items: NotificationItem[]
}

/**
 * 通知台账（`.openpixel/notifications.json`，独立文件，随工作区备份）。
 * Phase B 先落库（权限申请类），Phase D 再做通知中心 UI 与批准/拒绝落地。
 * 内存缓存 + 原子写盘（tmp+rename，同 AuthStore）。
 */
export class NotificationStore {
  private items: NotificationItem[] = []
  private readonly itemsFile: string

  constructor(private readonly root: string) {
    const dir = join(root, OPENPENCIL_REL_DIR)
    mkdirSync(dir, { recursive: true })
    this.itemsFile = join(dir, 'notifications.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.itemsFile)) {
        const raw = JSON.parse(readFileSync(this.itemsFile, 'utf8')) as Partial<NotificationLedger>
        if (Array.isArray(raw.items)) {
          this.items = raw.items.filter(isNotificationItem)
        }
      }
    } catch (error) {
      console.warn('[file-bridge] notifications load failed, starting empty', error)
    }
  }

  private persist(): void {
    const ledger: NotificationLedger = { version: 1, items: this.items }
    const tmp = `${this.itemsFile}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tmp, JSON.stringify(ledger, null, 2))
    renameSync(tmp, this.itemsFile)
  }

  /** 追加一条通知（新条目在最新，时间倒序展示用）。 */
  addNotification(input: Omit<NotificationItem, 'id' | 'createdAt' | 'status'>): NotificationItem {
    const item: NotificationItem = {
      ...input,
      id: `n_${randomUUID()}`,
      status: 'unread',
      createdAt: new Date().toISOString()
    }
    this.items = [item, ...this.items]
    this.persist()
    return item
  }

  /** 通知列表（时间倒序：最新在前）。 */
  listNotifications(): NotificationItem[] {
    return [...this.items]
  }

  /** 全部已读（Phase D 通知中心「全部已读」按钮）。 */
  markAllRead(): void {
    let changed = false
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].status === 'unread') {
        this.items[i] = { ...this.items[i], status: 'read' }
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /** 同人同路径是否已有未读的权限申请（去重：重复申请不再追加）。 */
  hasUnreadPermissionRequest(fromUserId: string, path: string): boolean {
    return this.items.some(
      (item) =>
        item.type === 'permission_request' &&
        item.fromUserId === fromUserId &&
        item.path === path &&
        item.status === 'unread'
    )
  }
}

function isNotificationItem(item: unknown): item is NotificationItem {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Partial<NotificationItem>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.fromUserId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.status === 'string'
  )
}
