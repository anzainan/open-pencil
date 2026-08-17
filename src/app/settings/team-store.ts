import { computed, ref } from 'vue'

import {
  createMember,
  deleteMember,
  listMembers,
  updateMember,
  type BridgeMemberInfo
} from '@/app/bridge/share'
import { setSettingsDirty } from '@/app/settings/dialog'

/**
 * 团队空间 tab 成员行草稿（设置 → 团队空间，REQ §2）。
 * 密码/角色编辑先暂存（pending），由设置面板统一「保存」提交（PATCH /members/:id）；
 * 保存成功 → toast；未保存离开 → UnsavedDialog。
 */
export interface TeamMemberDraft extends BridgeMemberInfo {
  passwordDraft: string
  passwordTouched: boolean
  roleDraft: BridgeMemberInfo['role']
  roleTouched: boolean
  /** 移除复选（owner 行固定无复选框）。 */
  selected: boolean
}

const members = ref<TeamMemberDraft[]>([])
const loaded = ref(false)

const PASSWORD_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** 随机 6 位混合密码（REQ §9.4：6 位混合大小写+数字）。 */
export function randomPassword(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => PASSWORD_CHARSET[byte % PASSWORD_CHARSET.length]).join('')
}

export const teamMembers = computed(() => members.value)
export const teamMembersLoaded = computed(() => loaded.value)
/** 最近一次拉取是否失败（失败不清空已载列表；UI 据此显示「加载失败·点击重试」）。 */
export const teamMembersError = ref(false)

/** 请求序列号：过期响应（期间又有新请求）不覆盖新值，防双拉竞态 Last-Write-Wins 覆盖。 */
let seq = 0
/** 单飞锁：in-flight 时共享同一 Promise（SettingsDialog 与面板双拉只发一次 GET）。 */
let inFlight: Promise<void> | null = null

export const pendingCount = computed(() =>
  members.value.filter((member) => member.passwordTouched || member.roleTouched).length
)

export const selectedCount = computed(() => members.value.filter((member) => member.selected).length)

export const selectedMembers = computed(() =>
  members.value.filter((member) => member.selected)
)

function syncDirty(): void {
  setSettingsDirty(pendingCount.value > 0)
}

function toDraft(member: BridgeMemberInfo): TeamMemberDraft {
  return {
    ...member,
    // 明文默认回显（服务端明文副本；存量仅哈希/无副本 → ''，不置 touched）。
    passwordDraft: member.password ?? '',
    passwordTouched: false,
    roleDraft: member.role,
    roleTouched: false,
    selected: false
  }
}

/** 拉取真实成员列表（GET /members；owner 行 fixed:true）。 */
export async function loadTeamMembers(): Promise<void> {
  const run = ++seq
  try {
    const list = await listMembers()
    // 过期响应（期间已有更新的拉取）不覆盖新值。
    if (seq !== run) return
    members.value = list.map(toDraft)
    loaded.value = true
    teamMembersError.value = false
    syncDirty()
  } catch (error) {
    // 失败不清空已载列表（仅置错误标记供 UI 提示重试），且只有最新请求失败才置标记。
    if (seq === run) teamMembersError.value = true
    throw error
  }
}

/**
 * 单飞去重的加载入口：in-flight 时共享同一 Promise（SettingsDialog 与面板双拉去重，
 * 只发一次 GET）；失败/成功后锁自动释放，可再次触发重试。
 */
export function ensureLoad(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = loadTeamMembers().finally(() => {
    if (inFlight) inFlight = null
  })
  return inFlight
}

export type AddTeamMemberOutcome = { ok: true; user: BridgeMemberInfo } | { ok: false }

/**
 * 添加成员并复制凭据（「添加并复制」核）：createMember 成功即成功、失败才算失败。
 * 列表刷新由调用方在成功后再做（ensureLoad），其失败独立提示（team.listRefreshFailed）——
 * 绝不能再落入「添加成员失败」分支（POST 成功 + 刷新失败曾误报，成员其实已创建）。
 */
export async function addTeamMember(input: {
  name: string
  password: string
  role: 'admin' | 'member'
}): Promise<AddTeamMemberOutcome> {
  try {
    const { user } = await createMember(input)
    return { ok: true, user }
  } catch (error) {
    console.warn('[team] add member failed', error)
    return { ok: false }
  }
}

/** 设置某成员密码草稿（编辑框/随机按钮）；空串不视为修改。 */
export function setMemberPassword(id: string, password: string): void {
  const member = members.value.find((candidate) => candidate.id === id)
  if (!member) return
  member.passwordDraft = password
  member.passwordTouched = password !== ''
  syncDirty()
}

/** 设置某成员角色草稿（下拉：管理员/成员）；回到原角色视为未修改。 */
export function setMemberRole(id: string, role: BridgeMemberInfo['role']): void {
  const member = members.value.find((candidate) => candidate.id === id)
  if (!member) return
  if (role !== 'admin' && role !== 'member') return
  member.roleDraft = role
  member.roleTouched = role !== member.role
  syncDirty()
}

export function toggleMemberSelected(id: string): void {
  const member = members.value.find((candidate) => candidate.id === id)
  if (!member || member.fixed) return
  member.selected = !member.selected
}

/** 提交全部暂存更改（保存）：逐条 PATCH 密码/角色，成功后重载列表。 */
export async function commitPendingMembers(): Promise<number> {
  const pending = members.value.filter((member) => member.passwordTouched || member.roleTouched)
  for (const member of pending) {
    const input: { password?: string; role?: 'admin' | 'member' } = {}
    if (member.passwordTouched) input.password = member.passwordDraft
    if (member.roleTouched && (member.roleDraft === 'admin' || member.roleDraft === 'member')) {
      input.role = member.roleDraft
    }
    await updateMember(member.id, input)
  }
  if (pending.length > 0) await loadTeamMembers()
  return pending.length
}

/** 放弃暂存更改（UnsavedDialog 放弃更改）：还原为服务端回填值。 */
export function discardPendingMembers(): void {
  for (const member of members.value) {
    member.passwordDraft = member.password ?? ''
    member.passwordTouched = false
    member.roleDraft = member.role
    member.roleTouched = false
  }
  syncDirty()
}

/** 移除勾选成员（RemoveDialog 确认后）：逐个 DELETE，成功重载。 */
export async function removeSelectedMembers(): Promise<string[]> {
  const targets = selectedMembers.value.map((member) => member.id)
  for (const id of targets) {
    await deleteMember(id)
  }
  if (targets.length > 0) await loadTeamMembers()
  return targets
}
