import { authHeader } from './client'

/** 团队成员（GET /api/v1/members 对外视图，无密码字段）。 */
export interface BridgeMemberInfo {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member'
  avatar: { char: string; bg: string }
  email: string
  createdAt: string
  fixed?: boolean
}

/** 外链台账视图（服务端 GET /api/v1/share 返回，绝不含密码哈希）。 */
export interface BridgeShareSettings {
  exists: boolean
  path: string
  scope: 'internet' | 'team' | 'self'
  permission: 'view' | 'edit'
  passwordEnabled: boolean
  token: string | null
  url: string | null
  members: { userId: string; permission: 'view' | 'edit' | 'none' }[]
  createdBy?: string
  createdAt?: string
}

/** 游客外链校验结果（GET /api/v1/share/verify）。 */
export interface BridgeShareVerify {
  exists: boolean
  needPassword?: boolean
  wrongPassword?: boolean
  path?: string
  fileName?: string
  permission?: 'view' | 'edit'
  scope?: 'internet' | 'team' | 'self'
}

const API_BASE = '/api/v1'

/** 团队成员列表（login；owner 行带 fixed 标记，分享面板选人用）。 */
export async function listMembers(): Promise<BridgeMemberInfo[]> {
  const response = await fetch(`${API_BASE}/members`, {
    headers: { Authorization: authHeader() ?? '' }
  })
  if (!response.ok) throw new Error(`Bridge members failed (${response.status})`)
  const data = (await response.json()) as { members?: BridgeMemberInfo[] }
  return data.members ?? []
}

/** 取某文件分享设置（login）。 */
export async function getShare(path: string): Promise<BridgeShareSettings> {
  const response = await fetch(`${API_BASE}/share?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: authHeader() ?? '' }
  })
  if (!response.ok) throw new Error(`Bridge share settings failed (${response.status}): ${path}`)
  return (await response.json()) as BridgeShareSettings
}

/** 保存外链设置（admin）：scope=internet → 返回 token+url。password 不传=保留，''=清空。 */
export async function saveShare(
  path: string,
  data: {
    scope: 'internet' | 'team' | 'self'
    permission: 'view' | 'edit'
    password?: string
  }
): Promise<BridgeShareSettings> {
  const body: Record<string, unknown> = { path, scope: data.scope, permission: data.permission }
  if (data.password !== undefined) body.password = data.password
  const response = await fetch(`${API_BASE}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() ?? '' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`Bridge share save failed (${response.status}): ${path}`)
  const parsed = (await response.json()) as { link?: BridgeShareSettings } | null
  if (!parsed?.link) throw new Error('Bridge share save returned no link')
  return parsed.link
}

/** 关闭分享（admin，删除外链）。 */
export async function closeShare(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}/share?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader() ?? '' }
  })
  if (!response.ok) throw new Error(`Bridge share close failed (${response.status}): ${path}`)
}

/** 写文件级权限条目（admin，分享面板成员权限/范围保存）。 */
export async function saveFilePermissions(
  path: string,
  data: {
    scope?: 'internet' | 'team' | 'self'
    members?: { userId: string; permission: 'view' | 'edit' | 'none' }[]
  }
): Promise<void> {
  const response = await fetch(`${API_BASE}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() ?? '' },
    body: JSON.stringify({ path, ...data })
  })
  if (!response.ok) throw new Error(`Bridge permissions save failed (${response.status}): ${path}`)
}

/** 游客：校验外链 token（可选密码）。 */
export async function verifyShare(token: string, password?: string): Promise<BridgeShareVerify> {
  const query = new URLSearchParams({ token })
  if (password) query.set('password', password)
  const response = await fetch(`${API_BASE}/share/verify?${query.toString()}`)
  if (!response.ok) throw new Error(`Bridge share verify failed (${response.status})`)
  return (await response.json()) as BridgeShareVerify
}

/** 游客：读外链文件字节（唯一游客文件读通道）。 */
export async function getShareContent(token: string): Promise<Uint8Array> {
  const response = await fetch(`${API_BASE}/share/${encodeURIComponent(token)}/content`)
  if (!response.ok) throw new Error(`Bridge share content failed (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

/** 随机外链密码（login，6 位混合，供前端「刷新密码」）。 */
export async function getRandomSharePassword(): Promise<string> {
  const response = await fetch(`${API_BASE}/share/password`, {
    headers: { Authorization: authHeader() ?? '' }
  })
  if (!response.ok) throw new Error(`Bridge share password failed (${response.status})`)
  const data = (await response.json()) as { password?: string }
  if (!data.password) throw new Error('Bridge share password returned no value')
  return data.password
}
