import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { decryptPassword, encryptPassword, type PasswordCipher } from './crypto'
import { OPENPENCIL_REL_DIR } from './paths'

export type UserRole = 'owner' | 'admin' | 'member'

export interface User {
  id: string
  /** 账号名 = 登录名，自由字符串，全团队唯一（REQ §2.6）。 */
  name: string
  passwordSalt: string
  passwordHash: string
  /** 密码明文副本（AES-256-GCM，`PASSWORD_ENC_KEY`；无 key 或存量仅哈希 → null）。 */
  passwordCipher: PasswordCipher | null
  role: UserRole
  avatar: { char: string; bg: string; image?: string }
  /** 纯展示（REQ §9.3），不参与账号逻辑。 */
  email: string
  createdAt: string
}

/** 对外返回的用户（默认绝不携带 passwordSalt / passwordHash / 明文）。 */
export interface PublicUser {
  id: string
  name: string
  role: UserRole
  avatar: { char: string; bg: string; image?: string }
  email: string
  createdAt: string
  /**
   * 明文密码（仅 admin 调用方 + 非 owner 成员可见；其余场景不出现）。
   * 序列化恒输出：无明文副本 → null（区别于字段缺省 → 整键省略）。
   */
  password?: string | null
  /** 所有者固定标记：无复选框/无密码/不可移除（REQ §2.5）。 */
  fixed?: boolean
}

interface UserLedger {
  version: 1
  users: User[]
  ownerFixed: string
}

interface SessionRecord {
  token: string
  userId: string
  createdAt: string
  expiresAt: string
}

interface SessionLedger {
  version: 1
  sessions: SessionRecord[]
}

/** 会话有效期：30 天（跨容器重启仍有效，见 sessions.json 持久化）。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 首次启动 seed 的默认管理员（REQ §1.1，安在南 16:08 确认）。 */
const DEFAULT_OWNER = {
  name: '安在南',
  password: 'zhangzainan',
  role: 'owner' as const,
  avatar: { char: '安', bg: '#3B82F6' },
  email: ''
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, saltHex, 64).toString('hex')
}

function newSalt(): string {
  return randomBytes(16).toString('hex')
}

function isExpired(session: SessionRecord): boolean {
  return Date.parse(session.expiresAt) <= Date.now()
}

/**
 * 账号/会话存储：users.json + sessions.json（均存 `.openpixel/`，独立于 index.json，
 * 随工作区备份）。内存缓存 + 原子写盘（tmp+rename，同 Manifest.persist）。
 * 密码仅存 scrypt 盐+哈希，绝不存明文；sessions.json 跨容器重启保留「记住登录」。
 */
export class AuthStore {
  private users: User[] = []
  private ownerFixed = ''
  private sessions = new Map<string, SessionRecord>()
  private readonly usersFile: string
  private readonly sessionsFile: string

  constructor(private readonly root: string) {
    const dir = join(root, OPENPENCIL_REL_DIR)
    mkdirSync(dir, { recursive: true })
    this.usersFile = join(dir, 'users.json')
    this.sessionsFile = join(dir, 'sessions.json')
    this.loadUsers()
    this.loadSessions()
  }

  private loadUsers(): void {
    try {
      if (existsSync(this.usersFile)) {
        const raw = JSON.parse(readFileSync(this.usersFile, 'utf8')) as Partial<UserLedger>
        if (Array.isArray(raw.users)) {
          this.users = raw.users.filter(
            (item): item is User =>
              !!item &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              typeof item.passwordSalt === 'string' &&
              typeof item.passwordHash === 'string' &&
              (item.role === 'owner' || item.role === 'admin' || item.role === 'member')
          )
        }
        if (typeof raw.ownerFixed === 'string') this.ownerFixed = raw.ownerFixed
      }
      // 台账不存在或未含任何成员 → seed 默认管理员。
      if (this.users.length === 0) {
        const salt = newSalt()
        const owner: User = {
          id: `u_${randomUUID()}`,
          name: DEFAULT_OWNER.name,
          passwordSalt: salt,
          passwordHash: hashPassword(DEFAULT_OWNER.password, salt),
          passwordCipher: null,
          role: DEFAULT_OWNER.role,
          avatar: { ...DEFAULT_OWNER.avatar },
          email: DEFAULT_OWNER.email,
          createdAt: new Date().toISOString()
        }
        this.users = [owner]
        this.ownerFixed = owner.id
        this.persistUsers()
        console.log(`[file-bridge] seeded default owner account "${DEFAULT_OWNER.name}"`)
      }
    } catch (error) {
      console.warn('[file-bridge] users load failed, seeding default owner', error)
      this.users = []
      this.ownerFixed = ''
    }
  }

  private loadSessions(): void {
    try {
      if (existsSync(this.sessionsFile)) {
        const raw = JSON.parse(readFileSync(this.sessionsFile, 'utf8')) as Partial<SessionLedger>
        if (Array.isArray(raw.sessions)) {
          for (const session of raw.sessions) {
            if (
              !session ||
              typeof session.token !== 'string' ||
              typeof session.userId !== 'string' ||
              typeof session.expiresAt !== 'string'
            ) {
              continue
            }
            if (isExpired(session)) continue
            this.sessions.set(session.token, session)
          }
        }
      }
    } catch (error) {
      console.warn('[file-bridge] sessions load failed, starting empty', error)
    }
  }

  private persistUsers(): void {
    const ledger: UserLedger = { version: 1, users: this.users, ownerFixed: this.ownerFixed }
    this.writeAtomic(this.usersFile, ledger)
  }

  private persistSessions(): void {
    const ledger: SessionLedger = {
      version: 1,
      sessions: [...this.sessions.values()].filter((session) => !isExpired(session))
    }
    this.writeAtomic(this.sessionsFile, ledger)
  }

  private writeAtomic(file: string, data: unknown): void {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, file)
  }

  isOwner(id: string): boolean {
    return id === this.ownerFixed
  }

  /**
   * 对外视图：默认去掉全部密码字段；withPassword 时对非 owner 成员附明文（admin 专用，
   * 服务端在 GET /members 上做角色门槛）。所有者固定标记 + 不回显密码（owner 不可改密）。
   */
  toPublicUser(user: User, withPassword = false): PublicUser {
    const publicUser: PublicUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
      email: user.email,
      createdAt: user.createdAt
    }
    if (withPassword && !this.isOwner(user.id)) {
      // `?? null` 而非 undefined：JSON 序列化恒输出 password:null（无明文副本），
      // 与分享侧字段约定对齐（缺键 = 未授权，null = 无副本），前端可区分并提示自愈。
      publicUser.password = decryptPassword(user.passwordCipher) ?? null
    }
    if (this.isOwner(user.id)) publicUser.fixed = true
    return publicUser
  }

  getUserById(id: string): User | null {
    return this.users.find((user) => user.id === id) ?? null
  }

  /** 校验名称+密码。成功返回完整 User（含哈希字段，仅服务端内部用），失败返回 null。 */
  verifyCredentials(name: string, password: string): User | null {
    const normalized = name.trim()
    const user = this.users.find((candidate) => candidate.name === normalized)
    if (!user) return null
    const expected = hashPassword(password, user.passwordSalt)
    if (!this.safeEqual(expected, user.passwordHash)) return null
    // 存量自愈（根因 C）：哈希验证成功后，若缺明文副本且有 key 可加密（PASSWORD_ENC_KEY 在位），
    // 用拿到的已验证明文补写副本并落盘 —— 旧成员下次登录一次即永久可回显，不改密码不打断登录。
    // 无 key / 已有副本 → 静默跳过（不降级不报错）；scrypt 哈希验证链路零改动。
    if (user.passwordCipher == null) {
      const cipher = encryptPassword(password)
      if (cipher) {
        user.passwordCipher = cipher
        this.persistUsers()
      }
    }
    return user
  }

  private safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
  }

  /** 创建会话：token=randomBytes(32).hex，TTL 30 天，持久化（跨容器重启仍有效）。 */
  createSession(userId: string): string {
    const token = randomBytes(32).toString('hex')
    const now = new Date().toISOString()
    this.sessions.set(token, {
      token,
      userId,
      createdAt: now,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    })
    this.persistSessions()
    return token
  }

  /** 校验 token 并返回会话所属用户（过期/不存在返回 null）。 */
  getSessionUser(token: string): User | null {
    const session = this.sessions.get(token)
    if (!session) return null
    if (isExpired(session)) {
      this.sessions.delete(token)
      this.persistSessions()
      return null
    }
    return this.getUserById(session.userId)
  }

  /** 销毁会话（退出登录 / 移除成员时清理其所有会话）。 */
  destroySession(token: string): void {
    if (this.sessions.delete(token)) this.persistSessions()
  }

  destroyUserSessions(userId: string): void {
    let changed = false
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(token)
        changed = true
      }
    }
    if (changed) this.persistSessions()
  }

  /** 成员列表（对外视图；默认无密码字段；admin 调用方 withPassword 时附明文，owner 行仍无）。 */
  listUsers(opts?: { withPassword?: boolean }): PublicUser[] {
    return this.users.map((user) => this.toPublicUser(user, opts?.withPassword))
  }

  /**
   * 新增成员：生成盐+哈希。返回含明文密码（「添加并复制」用）。
   * 重名返回 { ok: false }，由服务端映射 409。
   */
  createUser(input: {
    name: string
    password: string
    role: 'admin' | 'member'
  }): { ok: true; user: PublicUser; password: string } | { ok: false; error: string } {
    const name = input.name.trim()
    if (!name) return { ok: false, error: 'name is required' }
    if (!input.password) return { ok: false, error: 'password is required' }
    if (this.users.some((user) => user.name === name)) {
      return { ok: false, error: `user already exists: ${name}` }
    }
    const salt = newSalt()
    const user: User = {
      id: `u_${randomUUID()}`,
      name,
      passwordSalt: salt,
      passwordHash: hashPassword(input.password, salt),
      passwordCipher: encryptPassword(input.password),
      role: input.role,
      avatar: { char: name.charAt(0) || '?', bg: '#3B82F6' },
      email: '',
      createdAt: new Date().toISOString()
    }
    this.users.push(user)
    this.persistUsers()
    return { ok: true, user: this.toPublicUser(user), password: input.password }
  }

  /**
   * 修改成员（密码重哈希 / 角色变更）。所有者拒绝修改（服务端也拦截）。
   * 返回 { ok: false; error } 表示拒绝（如目标不存在）。
   */
  updateUser(
    id: string,
    input: { password?: string; role?: UserRole }
  ): { ok: true; user: PublicUser } | { ok: false; error: string } {
    const user = this.getUserById(id)
    if (!user) return { ok: false, error: 'not found' }
    if (this.isOwner(id)) return { ok: false, error: 'owner cannot be modified' }
    if (input.password !== undefined) {
      if (!input.password) return { ok: false, error: 'password is required' }
      user.passwordSalt = newSalt()
      user.passwordHash = hashPassword(input.password, user.passwordSalt)
      // 同事务更新明文副本（无 key 时降级 null；下次重设/刷新自愈）。
      user.passwordCipher = encryptPassword(input.password)
    }
    if (input.role !== undefined) {
      if (input.role !== 'admin' && input.role !== 'member') {
        return { ok: false, error: 'invalid role' }
      }
      user.role = input.role
    }
    this.persistUsers()
    return { ok: true, user: this.toPublicUser(user) }
  }

  /** 删除成员并清理其全部会话。所有者拒绝删除（服务端也拦截）。 */
  deleteUser(id: string): { ok: true } | { ok: false; error: string } {
    if (this.isOwner(id)) return { ok: false, error: 'owner cannot be removed' }
    if (!this.users.some((user) => user.id === id)) return { ok: false, error: 'not found' }
    this.users = this.users.filter((user) => user.id !== id)
    this.destroyUserSessions(id)
    this.persistUsers()
    return { ok: true }
  }

  /**
   * 设置成员头像图片（relPath 形如 `avatars/<userId>.<ext>`，相对设计根）。
   * 保留原有 char/bg 作为无图片时的字符头像回退。
   */
  setAvatarImage(
    id: string,
    relPath: string
  ): { ok: true; user: PublicUser } | { ok: false; error: string } {
    const user = this.getUserById(id)
    if (!user) return { ok: false, error: 'not found' }
    user.avatar = { ...user.avatar, image: relPath }
    this.persistUsers()
    return { ok: true, user: this.toPublicUser(user) }
  }
}

/** 管理员（含所有者）判定：成员权限 / 移除 / 分享设置仅管理员和所有者可操作。 */
export function isAdminRole(role: UserRole): boolean {
  return role === 'owner' || role === 'admin'
}
