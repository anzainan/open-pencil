import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { OPENPENCIL_REL_DIR } from './paths'

/** 外链访问范围：与 PermissionScope 语义一致（share.json 仅存外链台账）。 */
export type ShareScope = 'internet' | 'team' | 'self'

/** 画板权限（外链可见时的只读/可编辑；游客一律只读预览，画板权限仅供登录成员解释）。 */
export type SharePermission = 'view' | 'edit'

export interface ShareLink {
  /** 外链 URL token（randomBytes(16).hex，放路径：/share/:token）。 */
  token: string
  /** 文件相对路径（设计根内）。 */
  path: string
  scope: ShareScope
  permission: SharePermission
  /** 启用密码才填（scrypt 盐+哈希，不存明文）。 */
  passwordSalt: string | null
  passwordHash: string | null
  /** 成员级权限镜像（Phase B 起成员权限走 permissions.json，此处保留兼容字段）。 */
  members: { userId: string; permission: 'view' | 'edit' | 'none' }[]
  createdBy: string
  createdAt: string
}

interface ShareLedger {
  version: 1
  links: ShareLink[]
}

/** 随机外链 token：16 字节 hex（URL 安全，无泄露熵）。 */
function newToken(): string {
  return randomBytes(16).toString('hex')
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, saltHex, 64).toString('hex')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

/**
 * 外链台账（`.openpencil/share.json`，独立于 index.json，随工作区备份）。
 * 分工（16:28 拍板）：外链本身（token/密码/scope/permission）= 本台账；
 * 团队成员权限（成员行权限下拉）= permissions.json（PermissionStore.upsertEntry）。
 * 非 internet 范围的外链不可访问（verify 返回 closed）。
 * 内存缓存 + 原子写盘（tmp+rename，同 AuthStore/PermissionStore）。
 */
export class ShareStore {
  private links = new Map<string, ShareLink>()
  private readonly linksFile: string

  constructor(private readonly root: string) {
    const dir = join(root, OPENPENCIL_REL_DIR)
    mkdirSync(dir, { recursive: true })
    this.linksFile = join(dir, 'share.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.linksFile)) {
        const raw = JSON.parse(readFileSync(this.linksFile, 'utf8')) as Partial<ShareLedger>
        if (Array.isArray(raw.links)) {
          for (const link of raw.links) {
            if (!this.isValidLink(link)) continue
            this.links.set(link.path, link)
          }
        }
      }
    } catch (error) {
      console.warn('[file-bridge] share load failed, starting empty', error)
    }
  }

  private isValidLink(link: unknown): link is ShareLink {
    if (!link || typeof link !== 'object') return false
    const candidate = link as Partial<ShareLink>
    if (typeof candidate.token !== 'string' || candidate.token.length === 0) return false
    if (typeof candidate.path !== 'string' || candidate.path.length === 0) return false
    if (candidate.scope !== 'internet' && candidate.scope !== 'team' && candidate.scope !== 'self') {
      return false
    }
    if (candidate.permission !== 'view' && candidate.permission !== 'edit') return false
    if (
      candidate.passwordSalt !== null &&
      candidate.passwordHash !== null &&
      (typeof candidate.passwordSalt !== 'string' || typeof candidate.passwordHash !== 'string')
    ) {
      return false
    }
    return typeof candidate.createdBy === 'string'
  }

  private persist(): void {
    const ledger: ShareLedger = { version: 1, links: [...this.links.values()] }
    const tmp = `${this.linksFile}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tmp, JSON.stringify(ledger, null, 2))
    renameSync(tmp, this.linksFile)
  }

  /** 取某路径的外链设置（无 → null）。 */
  getLink(path: string): ShareLink | null {
    return this.links.get(normalizePath(path)) ?? null
  }

  /**
   * 新增或更新某路径的外链。创建时生成 token；已存在时保留原 token（同一链接跨范围切换）。
   * password 传 'clear' 表示清空密码；不传（undefined）保持原密码不变。
   */
  upsertLink(
    path: string,
    data: {
      scope: ShareScope
      permission: SharePermission
      password?: string | null
      passwordSalt?: string | null
      passwordHash?: string | null
      members?: { userId: string; permission: 'view' | 'edit' | 'none' }[]
    },
    createdBy: string
  ): ShareLink {
    const normalized = normalizePath(path)
    const existing = this.links.get(normalized)
    const now = new Date().toISOString()

    let passwordSalt = existing?.passwordSalt ?? null
    let passwordHash = existing?.passwordHash ?? null
    if (data.password === 'clear') {
      passwordSalt = null
      passwordHash = null
    } else if (data.password && data.password.length > 0) {
      passwordSalt = randomBytes(16).toString('hex')
      passwordHash = hashPassword(data.password, passwordSalt)
    } else if (data.passwordSalt && data.passwordHash) {
      passwordSalt = data.passwordSalt
      passwordHash = data.passwordHash
    }

    const link: ShareLink = {
      token: existing?.token ?? newToken(),
      path: normalized,
      scope: data.scope,
      permission: data.permission,
      passwordSalt,
      passwordHash,
      members: data.members ?? existing?.members ?? [],
      createdBy,
      createdAt: existing?.createdAt ?? now
    }
    this.links.set(normalized, link)
    this.persist()
    return link
  }

  /** 关闭分享：删除该路径的外链。 */
  deleteLink(path: string): boolean {
    const deleted = this.links.delete(normalizePath(path))
    if (deleted) this.persist()
    return deleted
  }

  /**
   * 按 token 校验外链。仅 scope=internet 的外链可访问（非 internet → 视为已关闭）。
   * 返回 link + path + fileName（fileName 用于落地页标题）。
   */
  verifyToken(token: string): { link: ShareLink; path: string; fileName: string } | null {
    const link = [...this.links.values()].find((candidate) => candidate.token === token)
    if (!link || link.scope !== 'internet') return null
    return { link, path: link.path, fileName: link.path.split('/').pop() ?? link.path }
  }

  /** 校验外链密码（无密码 → 通过；有密码且比对一致 → 通过）。 */
  verifyPassword(link: ShareLink, password: string): boolean {
    if (!link.passwordSalt || !link.passwordHash) return true
    const expected = hashPassword(password, link.passwordSalt)
    return constantTimeEqual(expected, link.passwordHash)
  }

  /** 全量外链（调试/未来管理页用）。 */
  listLinks(): ShareLink[] {
    return [...this.links.values()]
  }
}

const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz'
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const PASSWORD_DIGITS = '23456789'

function pickChar(chars: string, bytes: Uint8Array, index: number): string {
  return chars[bytes[index] % chars.length] ?? 'a'
}

/**
 * 生成 6 位随机密码（REQ §9.4：6 位混合大小写字母+数字，设计稿 a1B2 风格）。
 * 字符集剔除易混淆字符（0/O、1/l），保证至少各含 1 位大写/小写/数字。
 * 仅用 crypto.getRandomValues（AGENTS.md：禁 Math.random）。
 */
export function generateRandomPassword(): string {
  const bytes = randomBytes(6)
  const lower = pickChar(PASSWORD_LOWER, bytes, 0)
  const upper = pickChar(PASSWORD_UPPER, bytes, 1)
  const digit = pickChar(PASSWORD_DIGITS, bytes, 2)
  const all = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS
  const rest = [bytes[3], bytes[4], bytes[5]].map((value, index) => all[value % all.length] ?? 'a')
  const chars = [lower, upper, digit, ...rest]
  // Fisher-Yates 洗牌（随机顺序，避免固定前缀模式）。
  const order = randomBytes(chars.length)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = order[i] % (i + 1)
    const tmp = chars[i]
    chars[i] = chars[j]
    chars[j] = tmp
  }
  return chars.join('')
}
