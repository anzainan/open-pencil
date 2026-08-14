import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { OPENPENCIL_REL_DIR } from './paths'
import type { User } from './auth'

/** 访问范围：Phase B 先支持 team/self，internet（外链）字段预留给 Phase C。 */
export type PermissionScope = 'internet' | 'team' | 'self'

/** 成员级权限：none = 显式排除（实现「白板设小田不可见」覆盖）。 */
export type MemberPermission = 'view' | 'edit' | 'none'

export interface PermissionMember {
  userId: string
  permission: MemberPermission
}

export interface PermissionEntry {
  path: string
  type: 'folder' | 'file'
  scope: PermissionScope
  members: PermissionMember[]
}

export interface ResolvedPermission {
  canView: boolean
  canEdit: boolean
  scope: PermissionScope | null
  /** 命中来源：file（文件级）/ folder（父文件夹继承）/ default（默认，无任何 entry）。 */
  source: 'file' | 'folder' | 'default'
  /** 实际命中的 entry 路径（default 时为空串），调试用。 */
  entryPath: string
}

interface PermissionLedger {
  version: 1
  entries: PermissionEntry[]
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

/**
 * 权限台账（`.openpixel/permissions.json`，独立于 index.json，随工作区备份）。
 * 语义（REQ §5，用户 16:28 最终拍板）：
 *   白板（文件）权限 > 文件夹权限 > 默认；文件夹自动继承到内部文件；
 *   文件级 entry 最高级，可覆盖文件夹继承；owner/admin 永远 canView+canEdit。
 * 内存缓存 + 原子写盘（tmp+rename，同 AuthStore）。
 */
export class PermissionStore {
  private entries = new Map<string, PermissionEntry>()
  private readonly entriesFile: string

  constructor(private readonly root: string) {
    const dir = join(root, OPENPENCIL_REL_DIR)
    mkdirSync(dir, { recursive: true })
    this.entriesFile = join(dir, 'permissions.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.entriesFile)) {
        const raw = JSON.parse(readFileSync(this.entriesFile, 'utf8')) as Partial<PermissionLedger>
        if (Array.isArray(raw.entries)) {
          for (const entry of raw.entries) {
            if (!this.isValidEntry(entry)) continue
            this.entries.set(entry.path, entry)
          }
        }
      }
    } catch (error) {
      console.warn('[file-bridge] permissions load failed, starting empty', error)
    }
  }

  private isValidEntry(entry: unknown): entry is PermissionEntry {
    if (!entry || typeof entry !== 'object') return false
    const candidate = entry as Partial<PermissionEntry>
    if (typeof candidate.path !== 'string') return false
    if (candidate.type !== 'folder' && candidate.type !== 'file') return false
    if (candidate.scope !== 'internet' && candidate.scope !== 'team' && candidate.scope !== 'self') {
      return false
    }
    if (!Array.isArray(candidate.members)) return false
    return candidate.members.every(
      (member) =>
        !!member &&
        typeof member.userId === 'string' &&
        (member.permission === 'view' || member.permission === 'edit' || member.permission === 'none')
    )
  }

  private persist(): void {
    const ledger: PermissionLedger = { version: 1, entries: [...this.entries.values()] }
    const tmp = `${this.entriesFile}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tmp, JSON.stringify(ledger, null, 2))
    renameSync(tmp, this.entriesFile)
  }

  /** 台账全量条目（调试 / 未来设置面板用）。 */
  listEntries(): PermissionEntry[] {
    return [...this.entries.values()]
  }

  /** 新增或整条替换某路径的权限 entry（写盘即生效，Last-Write-Wins）。 */
  upsertEntry(path: string, data: Omit<PermissionEntry, 'path'>): PermissionEntry {
    const normalized = normalizePath(path)
    const entry: PermissionEntry = { path: normalized, ...data }
    this.entries.set(normalized, entry)
    this.persist()
    return entry
  }

  private findEntryExact(path: string): PermissionEntry | null {
    return this.entries.get(normalizePath(path)) ?? null
  }

  /**
   * 沿路径逐级向上找最近 entry（test/123.fig → test → 根）。
   * 返回命中的 entry + 命中层级（文件级=file；父文件夹继承=folder）。
   */
  private findEntryForPath(path: string): { entry: PermissionEntry | null; source: 'file' | 'folder' | 'default' } {
    const normalized = normalizePath(path)
    const exact = this.findEntryExact(normalized)
    if (exact) return { entry: exact, source: exact.type === 'file' ? 'file' : 'folder' }

    const segments = normalized.split('/').filter(Boolean)
    for (let i = segments.length - 1; i >= 0; i--) {
      const folderPath = segments.slice(0, i).join('/')
      const folderEntry = this.findEntryExact(folderPath)
      if (folderEntry) return { entry: folderEntry, source: 'folder' }
    }
    return { entry: null, source: 'default' }
  }

  /**
   * 解析指定用户对某路径的权限。owner/admin 永远全权限（管理特权，不受 entries 限制）。
   * 文件级 entry > 最近父文件夹 entry（自动继承）> 默认（普通成员无权限）。
   */
  resolvePermission(path: string, user: User): ResolvedPermission {
    const { entry, source } = this.findEntryForPath(path)
    const entryPath = entry?.path ?? ''

    if (user.role === 'owner' || user.role === 'admin') {
      return { canView: true, canEdit: true, scope: entry?.scope ?? null, source, entryPath }
    }
    if (!entry) {
      // 默认：无任何 entry → 新成员默认无权限（分享面板显式加人，16:19 拍板）。
      return { canView: false, canEdit: false, scope: null, source: 'default', entryPath: '' }
    }
    return resolveEntryForUser(entry, user)
  }
}

function resolveEntryForUser(entry: PermissionEntry, user: User): ResolvedPermission {
  const scope = entry.scope
  if (scope === 'self') {
    // 仅自己（不分享）：非 owner 一律无权限。
    return { canView: false, canEdit: false, scope, source: entry.type === 'file' ? 'file' : 'folder', entryPath: entry.path }
  }
  if (scope === 'internet') {
    // 预留（Phase C 外链）：互联网任何人可看；可编辑仍需成员级授权（Phase B 无外链，宽放到 view）。
    const member = memberFor(entry, user)
    return {
      canView: true,
      canEdit: member?.permission === 'edit',
      scope,
      source: entry.type === 'file' ? 'file' : 'folder',
      entryPath: entry.path
    }
  }
  // scope === 'team'：查成员列表（none=拒绝；缺省=无权限）。
  const member = memberFor(entry, user)
  const canEdit = member?.permission === 'edit'
  const canView = member?.permission === 'view' || canEdit
  return {
    canView,
    canEdit,
    scope,
    source: entry.type === 'file' ? 'file' : 'folder',
    entryPath: entry.path
  }
}

function memberFor(entry: PermissionEntry, user: User): PermissionMember | undefined {
  return entry.members.find((member) => member.userId === user.id)
}
