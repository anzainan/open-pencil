import { useLocalStorage, useSessionStorage } from '@vueuse/core'
import { computed, ref, type Ref } from 'vue'

/** 当前登录用户（服务端 /auth/session 下发，无密码字段）。 */
export interface AuthUser {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member'
  avatar: { char: string; bg: string; image?: string }
  email: string
  createdAt: string
  /** 所有者固定标记：无复选框/无密码/不可移除（REQ §2.5）。 */
  fixed?: boolean
}

const TOKEN_KEY = 'openpencil:session'
const REMEMBER_KEY = 'openpencil:session:remember'
const API_BASE = '/api/v1'

/**
 * 登录态 store（模块级 ref，同 notifications/store.ts 模式）。
 * token 存取按「记住登录状态」：勾选 → localStorage（跨刷新免二次登录）；
 * 不勾 → sessionStorage（刷新/关页需重新登录）。REMEMBER_KEY 记录勾选去向。
 */
const rememberChosen = useLocalStorage<'1' | '0'>(REMEMBER_KEY, '0')
const localToken = useLocalStorage<string | null>(TOKEN_KEY, null)
const sessionStoredToken = useSessionStorage<string | null>(TOKEN_KEY, null)

/** 路由守卫/写接口共用的内存会话 token。 */
const sessionToken = ref<string | null>(null)

/** 路由守卫 helper：当前是否有有效 session token。 */
export function hasSession(): boolean {
  return sessionToken.value !== null
}

/** 供 BridgeClient 写接口注入 session token（checkAuth：BRIDGE_TOKEN 或 session 二选一）。 */
export function getSessionToken(): string | null {
  return sessionToken.value
}

export const currentUser = ref<AuthUser | null>(null)

export function useCurrentUser(): Ref<AuthUser | null> {
  return currentUser
}

export const isAdmin = computed(() => {
  const user = currentUser.value
  return user != null && (user.role === 'owner' || user.role === 'admin')
})

function tokenStorage(remember: boolean): Ref<string | null> {
  return remember ? localToken : sessionStoredToken
}

function saveToken(token: string, remember: boolean): void {
  rememberChosen.value = remember ? '1' : '0'
  tokenStorage(remember).value = token
}

function readStoredToken(): string | null {
  return tokenStorage(rememberChosen.value === '1').value
}

function clearStoredToken(): void {
  rememberChosen.value = '0'
  localToken.value = null
  sessionStoredToken.value = null
}

export class AuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

/** 登录：成功写入 token + 当前用户；失败抛 AuthError（status 401=密码错误）。 */
export async function login(name: string, password: string, remember: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  })
  const data = (await response.json().catch(() => null)) as
    | { token?: string; user?: AuthUser; error?: string }
    | null
  if (!response.ok) {
    throw new AuthError(response.status, data?.error ?? '登录失败，请检查用户名和密码')
  }
  if (!data?.token || !data.user) throw new AuthError(response.status, '登录响应无效')
  sessionToken.value = data.token
  currentUser.value = data.user
  saveToken(data.token, remember)
}

/** 启动恢复登录态：读本地 token → GET /auth/session 校验（记住登录免二次登录）。幂等：首次后共享同一 Promise。 */
export function restoreSession(): Promise<void> {
  if (!restorePromise) restorePromise = doRestore()
  return restorePromise
}

let restorePromise: Promise<void> | null = null

async function doRestore(): Promise<void> {
  const stored = readStoredToken()
  if (!stored) {
    sessionToken.value = null
    currentUser.value = null
    return
  }
  const response = await fetch(`${API_BASE}/auth/session`, {
    headers: { Authorization: `Bearer ${stored}` }
  }).catch(() => null)
  if (!response?.ok) {
    sessionToken.value = null
    currentUser.value = null
    clearStoredToken()
    return
  }
  const data = (await response.json().catch(() => null)) as { user?: AuthUser } | null
  if (!data?.user) {
    sessionToken.value = null
    currentUser.value = null
    clearStoredToken()
    return
  }
  sessionToken.value = stored
  currentUser.value = data.user
}

/** 退出登录：销毁服务端会话 + 清本地 token（跳登录页由调用方路由处理）。 */
export async function logout(): Promise<void> {
  const token = sessionToken.value
  sessionToken.value = null
  currentUser.value = null
  clearStoredToken()
  if (!token) return
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch (error) {
    // 网络失败不阻塞退出
    console.warn('[auth] logout request failed', error)
  }
}
