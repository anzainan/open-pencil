<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport
} from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import { currentUser, isAdmin } from '@/app/auth/session'
import {
  getRandomSharePassword,
  getShare,
  listMembers,
  saveFilePermissions,
  saveShare,
  type BridgeMemberInfo,
  type BridgeShareSettings
} from '@/app/bridge/share'
import { bridgeClient } from '@/app/bridge/client'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import AvatarImage from '@/components/ui/AvatarImage.vue'
import { usePopoverUI } from '@/components/ui/popover'
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot
} from '@/components/ui/dialog'

defineOptions({ name: 'SharePopover' })

type Scope = 'internet' | 'team' | 'self'
type Perm = 'view' | 'edit'
type MemberPerm = 'view' | 'edit' | 'none'

interface MemberRow {
  userId: string
  name: string
  avatar: { char: string; bg: string; image?: string }
  permission: MemberPerm
}

const store = useEditorStore()
const { dialogs } = useI18n()
const cls = usePopoverUI({ content: 'z-50 w-[320px] p-0' })
const { copy: copyText } = useClipboard()

const popoverOpen = ref(false)
const loading = ref(false)
const saving = ref(false)

const documentPath = ref('')

/**
 * 同步当前存储绑定的文档路径。binding 是 source-state 闭包、非响应式（Arch 根因 A），
 * 以其唯一响应式代理 documentName 为 watch 依赖，变化时重读 binding；
 * 面板打开 / copyLink 前也显式调用，补「首个文件打开时 documentName 先置值、
 * binding 后写（同值不再触发 watch）」的时序缺口。
 */
function syncDocumentPath(): void {
  documentPath.value = store.getStorageBinding()?.documentId ?? ''
}

watch(
  () => store.state.documentName,
  () => {
    syncDocumentPath()
  },
  { immediate: true }
)
const canEdit = computed(() => isAdmin.value)
/** 当前用户对该文件是否为协作者（perm.canView）：决定分享密码明文可看/可复制。 */
const canView = ref(false)

const scope = ref<Scope>('self')
const permission = ref<Perm>('view')
const passwordEnabled = ref(false)
const password = ref('')
const linkURL = ref('')
const members = ref<MemberRow[]>([])
const allMembers = ref<BridgeMemberInfo[]>([])
const memberSearch = ref('')
const addMemberOpen = ref(false)
const addMemberLoading = ref(false)

/**
 * owner 行（fixed：true 的服务端所有者）：置顶渲染，无权限下拉/不可移除（§1.1 ⑦）。
 * 用 session 里的 currentUser 同步种子渲染，不依赖异步 allMembers：
 * 首次打开/添加协作者时 owner 行即时可见（fixed 由服务端下发，currentUser 已携带）。
 */
const ownerRow = computed(() => {
  const fixed = allMembers.value.find((member) => member.fixed)
  if (fixed) return fixed
  const user = currentUser.value
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    email: user.email,
    createdAt: user.createdAt,
    fixed: true
  } satisfies BridgeMemberInfo
})

const removeDialogOpen = ref(false)
const removeTarget = ref<MemberRow | null>(null)

const scopeMenuOptions = computed(() => [
  { value: 'internet' as Scope, label: dialogs.value['share.scope.internet'], icon: 'globe' },
  { value: 'team' as Scope, label: dialogs.value['share.scope.team'], icon: 'users' },
  { value: 'self' as Scope, label: dialogs.value['share.scope.self'], icon: 'lock' }
])

/** 访问范围触发器文案：team（仅协作者）时高亮显示「仅协作者可访问」（§1.2 C）。 */
const scopeLabel = computed(() => {
  if (scope.value === 'team') return dialogs.value['share.scope.collab']
  return scopeMenuOptions.value.find((opt) => opt.value === scope.value)?.label ?? ''
})

const permissionOptions = computed(() => [
  { value: 'view' as Perm, label: dialogs.value['share.permission.view'] },
  { value: 'edit' as Perm, label: dialogs.value['share.permission.edit'] }
])

const permissionLabel = computed(
  () => permissionOptions.value.find((opt) => opt.value === permission.value)?.label ?? ''
)

const memberPermOptions = computed(() => [
  { value: 'view', label: dialogs.value['share.member.view'] },
  { value: 'edit', label: dialogs.value['share.member.edit'] },
  { value: 'remove', label: dialogs.value['share.member.remove'] }
])

const memberPermLabel = (perm: MemberPerm): string => dialogs.value[`share.member.${perm}`]

const searchableMembers = computed(() => {
  const query = memberSearch.value.trim().toLowerCase()
  return allMembers.value.filter((member) => {
    if (member.fixed) return false
    if (query && !member.name.toLowerCase().includes(query)) return false
    return true
  })
})

const isMemberAdded = (userId: string): boolean =>
  members.value.some((member) => member.userId === userId)

function avatarFor(userId: string): { char: string; bg: string; image?: string } {
  const found = allMembers.value.find((member) => member.id === userId)
  return found?.avatar ?? { char: '?', bg: '#3B82F6' }
}

function nameFor(userId: string): string {
  return allMembers.value.find((member) => member.id === userId)?.name ?? userId
}

async function load(): Promise<void> {
  if (!documentPath.value || loading.value) return
  loading.value = true
  try {
    const [share, perm, team] = await Promise.all([
      getShare(documentPath.value).catch(() => null),
      bridgeClient.getPermissions(documentPath.value).catch(() => null),
      listMembers().catch(() => [])
    ])
    allMembers.value = team
    // 协作者门槛：canView 决定密码明文可看/可复制（admin/owner 恒 true）。
    canView.value = perm?.canView ?? canEdit.value
    if (share) {
      scope.value = share.scope
      permission.value = share.permission
      passwordEnabled.value = share.passwordEnabled
      linkURL.value = share.url ?? ''
      // 明文回填（服务端明文副本；存量仅哈希/无 key → null → 空 + placeholder）。
      password.value = share.password ?? ''
    }
    const permMembers = (perm?.members ?? []) as { userId: string; permission: MemberPerm }[]
    // owner（fixed）默认全权限：不写回权限台账（服务端 owner 恒全权限），仅在列表置顶显示。
    members.value = permMembers
      .filter((member) => member.permission !== 'none')
      .map((member) => ({
        userId: member.userId,
        permission: member.permission,
        name: nameFor(member.userId),
        avatar: avatarFor(member.userId)
      }))
  } catch (error) {
    console.warn('[share] load failed', error)
  } finally {
    loading.value = false
  }
}

function withSaving(fn: () => Promise<void>): Promise<void> {
  if (!documentPath.value) {
    // Arch 根因 A 兜底：路径仍未就绪时不再静默丢弃任务，显式提示让用户看到原因。
    toast.error(dialogs.value['share.notReady'])
    return Promise.resolve()
  }
  // 保存中到达的新任务不再静默丢弃（根因 D）：记下最新任务，当前任务结束后重放（Last-Write-Wins）。
  if (saving.value) {
    pendingSaveTask = fn
    return Promise.resolve()
  }
  saving.value = true
  return fn()
    .then(() => {
      toast.info(dialogs.value['share.saveSuccess'])
      return undefined
    })
    .catch((error: unknown) => {
      console.warn('[share] save failed', error)
      toast.error(dialogs.value['share.saveFailed'])
      return undefined
    })
    .finally(() => {
      saving.value = false
      const next = pendingSaveTask
      pendingSaveTask = null
      if (next) void withSaving(next)
    })
}

async function saveScopeAndPermission(): Promise<void> {
  const requested = scope.value
  const link = await saveShare(documentPath.value, {
    scope: requested,
    permission: permission.value
  })
  // 先应用链接态（saveShare 返回的 url），再独立保存文件级权限：
  // permissions 偶发失败只 toast，不影响「复制链接」可用性（切到 internet 后必亮）。
  // 过期响应（保存期间 scope 又切走）不覆盖链接态；串行队列保证最后一次保存与最终 scope 一致，
  // 即停在 internet 时 applyLink 必执行（最终态不丢）。
  if (scope.value === requested) applyLink(link)
  await saveFilePermissions(documentPath.value, { scope: requested })
}

function applyLink(link: BridgeShareSettings): void {
  linkURL.value = link.url ?? ''
  passwordEnabled.value = link.passwordEnabled
  // saveShare 响应回填明文（服务端明文副本；disabled/无副本 → null → 空）。
  password.value = link.password ?? ''
}

// 访问范围保存串行队列：快速连切不静默丢弃，最后一次以最新 scope 落地。
let scopeSaveTail: Promise<void> = Promise.resolve()
/** withSaving 早退时暂存的最新任务（当前任务结束后重放，防并发保存把请求静默丢掉）。 */
let pendingSaveTask: (() => Promise<void>) | null = null

function enqueueScopeSave(): void {
  scopeSaveTail = scopeSaveTail
    .catch(() => undefined)
    .then(() => withSaving(saveScopeAndPermission))
}

function changeScope(): void {
  if (!canEdit.value) return
  enqueueScopeSave()
}

function changePermission(): void {
  if (!canEdit.value || saving.value) return
  void withSaving(async () => {
    const link = await saveShare(documentPath.value, {
      scope: scope.value,
      permission: permission.value
    })
    applyLink(link)
  })
}

/**
 * F3 复制内容（2026-08-16 14:00 拍板定稿）：
 * - 密码已开启且回显明文：`{当前用户名}邀请你加入{文件名}，访问链接：{链接}，访问密码：{密码}`
 * - 密码未开启 / 无明文副本：纯链接
 */
function buildShareText(url: string): string {
  const passwordText = passwordEnabled.value ? password.value : ''
  if (passwordText) {
    const fileName = documentPath.value.split('/').pop() || documentPath.value
    const userName = currentUser.value?.name || ''
    return `${userName}邀请你加入${fileName}，访问链接：${url}，访问密码：${passwordText}`
  }
  return url
}

async function copyLink(): Promise<void> {
  let url = linkURL.value
  // F3：任何状态必亮可点；url 为空（非 internet 范围 / 保存未生效）→ 点击自动切 internet 生成链接再复制。
  if (!url || scope.value !== 'internet') {
    // F3 保底：已有 url 即便 scope≠internet 也先复制纯链接（外链可访问性可能已失效，但内容不丢）。
    if (url) copyText(buildShareText(url))
    try {
      const link = await saveShare(documentPath.value, {
        scope: 'internet',
        permission: permission.value
      })
      scope.value = 'internet'
      applyLink(link)
      url = linkURL.value
    } catch (error) {
      console.warn('[share] copy link generate failed', error)
      // 独立文案而非泛化的「保存失败」；再触发 load() 刷新 share 真值，防状态漂移残留。
      syncDocumentPath()
      void load()
      toast.error(dialogs.value['share.copyLinkGenerateFailed'])
      return
    }
  }
  if (!url) {
    syncDocumentPath()
    void load()
    toast.error(dialogs.value['share.copyLinkGenerateFailed'])
    return
  }
  copyText(buildShareText(url))
  toast.info(dialogs.value['share.copySuccess'])
}

async function enablePassword(): Promise<void> {
  const generated = await getRandomSharePassword()
  password.value = generated
  const link = await saveShare(documentPath.value, {
    scope: scope.value,
    permission: permission.value,
    password: generated
  })
  applyLink(link)
}

async function refreshPassword(): Promise<void> {
  const generated = await getRandomSharePassword()
  password.value = generated
  const link = await saveShare(documentPath.value, {
    scope: scope.value,
    permission: permission.value,
    password: generated
  })
  applyLink(link)
}

async function disablePassword(): Promise<void> {
  const link = await saveShare(documentPath.value, {
    scope: scope.value,
    permission: permission.value,
    password: ''
  })
  applyLink(link)
}

function onPasswordInput(event: Event): void {
  password.value = (event.target as HTMLInputElement).value
}

async function commitPasswordInput(): Promise<void> {
  const link = await saveShare(documentPath.value, {
    scope: scope.value,
    permission: permission.value,
    password: password.value
  })
  applyLink(link)
}

function togglePassword(): void {
  void withSaving(passwordEnabled.value ? disablePassword : enablePassword)
}

function refreshPasswordAction(): void {
  void withSaving(refreshPassword)
}

function commitPasswordInputAction(): void {
  void withSaving(commitPasswordInput)
}

function copyPassword(): void {
  if (!password.value) {
    toast.error(dialogs.value['share.password.missing'])
    return
  }
  copyText(password.value)
  toast.info(dialogs.value['share.copySuccess'])
}

async function saveMembers(): Promise<void> {
  await saveFilePermissions(documentPath.value, {
    members: members.value.map((member) => ({
      userId: member.userId,
      permission: member.permission
    }))
  })
}

function addMember(userId: string): void {
  if (isMemberAdded(userId)) return
  members.value = [
    ...members.value,
    { userId, permission: 'view', name: nameFor(userId), avatar: avatarFor(userId) }
  ]
  void withSaving(saveMembers)
}

function changeMemberPermission(member: MemberRow, value: string): void {
  if (value === 'remove') {
    confirmRemove(member)
    return
  }
  if (value !== 'view' && value !== 'edit') return
  members.value = members.value.map((row) =>
    row.userId === member.userId ? { ...row, permission: value } : row
  )
  void withSaving(saveMembers)
}

function confirmRemove(member: MemberRow): void {
  removeTarget.value = member
  removeDialogOpen.value = true
}

function doRemove(): void {
  if (!removeTarget.value) return
  const target = removeTarget.value
  removeDialogOpen.value = false
  removeTarget.value = null
  members.value = members.value.filter((member) => member.userId !== target.userId)
  void withSaving(saveMembers)
}

async function openAddMember(): Promise<void> {
  memberSearch.value = ''
  addMemberOpen.value = true
  // 每次打开重新拉取成员（与团队空间同源 GET /members）：失败给 toast 而非静默空表。
  addMemberLoading.value = true
  try {
    allMembers.value = await listMembers()
  } catch (error) {
    console.warn('[share] add member list failed', error)
    toast.error(dialogs.value['share.member.loadFailed'])
  } finally {
    addMemberLoading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <PopoverRoot
    v-model:open="popoverOpen"
    @update:open="(open: boolean) => { if (open) { addMemberOpen = false; syncDocumentPath(); void load() } }"
  >
    <PopoverTrigger as-child>
      <button
        type="button"
        data-test-id="share-button"
        class="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded px-2 text-[11px] font-medium bg-accent text-white hover:bg-accent/90"
      >
        <icon-lucide-share-2 class="size-3.5" />
        {{ dialogs.share }}
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="share-popover"
        :class="cls.content"
        :side-offset="8"
        side="bottom"
        align="end"
      >
        <div class="relative overflow-hidden rounded-xl">
          <div v-if="loading" class="flex h-40 items-center justify-center text-xs text-muted">
            …
          </div>

          <template v-else>
            <div class="flex flex-col gap-2.5 p-3">
              <!-- ① title-row（§1.1）：分享文件 + 关闭 -->
              <div class="flex items-center justify-between">
                <span class="text-sm text-surface">{{ dialogs['share.title'] }}</span>
                <button
                  type="button"
                  class="flex size-6 cursor-pointer items-center justify-center rounded hover:bg-hover"
                  :aria-label="dialogs.close"
                  @click="popoverOpen = false"
                >
                  <icon-lucide-x class="size-3.5 text-muted" />
                </button>
              </div>

              <!-- ② perm-row（§1.1）：访问范围 + 权限 -->
              <div class="flex items-center justify-between">
                <SelectRoot v-model="scope" :disabled="!canEdit" @update:model-value="changeScope">
                  <SelectTrigger
                    :data-scope-team="scope === 'team' ? 'true' : undefined"
                    class="flex cursor-pointer items-center gap-1 text-[11px] text-surface outline-none data-[scope-team]:text-surface data-[disabled]:text-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
                  >
                    {{ scopeLabel }}
                    <icon-lucide-chevron-down class="size-2.5 shrink-0 text-muted" />
                  </SelectTrigger>
                  <SelectPortal>
                    <SelectContent
                      position="popper"
                      :side-offset="4"
                      class="z-[120] w-[140px] rounded-lg border border-border bg-panel-field p-1 shadow-[0_8px_30px_rgb(0_0_0/0.4)]"
                    >
                      <SelectViewport class="flex flex-col gap-0.5">
                        <SelectItem
                          v-for="opt in scopeMenuOptions"
                          :key="opt.value"
                          :value="opt.value"
                          class="flex h-[26px] cursor-pointer items-center gap-2 rounded px-2 text-[11px] text-surface outline-none data-[highlighted]:bg-hover"
                        >
                          <icon-lucide-globe
                            v-if="opt.icon === 'globe'"
                            class="size-3 shrink-0 text-muted"
                          />
                          <icon-lucide-users
                            v-else-if="opt.icon === 'users'"
                            class="size-3 shrink-0 text-muted"
                          />
                          <icon-lucide-lock v-else class="size-3 shrink-0 text-muted" />
                          <SelectItemText>{{ opt.label }}</SelectItemText>
                        </SelectItem>
                      </SelectViewport>
                    </SelectContent>
                  </SelectPortal>
                </SelectRoot>

                <SelectRoot
                  v-model="permission"
                  :disabled="!canEdit"
                  @update:model-value="changePermission"
                >
                  <SelectTrigger
                    class="flex h-[22px] cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-surface outline-none data-[disabled]:text-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
                  >
                    {{ permissionLabel }}
                    <icon-lucide-chevron-down class="size-2.5 shrink-0 text-muted" />
                  </SelectTrigger>
                  <SelectPortal>
                    <SelectContent
                      position="popper"
                      :side-offset="4"
                      class="z-[120] w-[104px] rounded-lg border border-border bg-panel-field p-1 shadow-[0_8px_30px_rgb(0_0_0/0.4)]"
                    >
                      <SelectViewport class="flex flex-col gap-0.5">
                        <SelectItem
                          v-for="opt in permissionOptions"
                          :key="opt.value"
                          :value="opt.value"
                          class="flex h-[26px] cursor-pointer items-center rounded px-2 text-[11px] text-surface outline-none data-[highlighted]:bg-hover"
                        >
                          <SelectItemText>{{ opt.label }}</SelectItemText>
                        </SelectItem>
                      </SelectViewport>
                    </SelectContent>
                  </SelectPortal>
                </SelectRoot>
              </div>

              <!-- ③ copy-btn（§1.1）：蓝底复制链接。F3：任何状态必亮可点（不再按 linkURL 置灰）；
                  空链接/非 internet 点击时自动切 internet 生成链接再复制（copyLink 兜底）。 -->
              <button
                v-if="canEdit"
                type="button"
                class="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-accent text-xs font-medium text-white hover:bg-accent/90"
                data-test-id="share-copy-link"
                @click="copyLink"
              >
                <icon-lucide-link class="size-3.5" />
                {{ dialogs['share.copyLink'] }}
              </button>
              <div v-else-if="linkURL" class="flex items-center gap-1.5 text-[11px] text-muted">
                <icon-lucide-link class="size-3.5" />
                <span class="min-w-0 flex-1 truncate">{{ linkURL }}</span>
              </div>

                <!-- ④ pw-row（§1.1）：启用密码 + 密码值/刷新/复制（明文协作者可看可复制，编辑仅 admin） -->
                <div class="flex items-center justify-between">
                  <label class="flex cursor-pointer items-center gap-2">
                    <input
                      v-if="canEdit"
                      type="checkbox"
                      class="peer sr-only"
                      :checked="passwordEnabled"
                      @change="togglePassword"
                    />
                    <span
                      :data-pw-on="passwordEnabled ? 'true' : undefined"
                      class="flex size-4 items-center justify-center rounded border border-border bg-transparent data-[pw-on]:border-accent data-[pw-on]:bg-accent"
                    >
                      <icon-lucide-check v-if="passwordEnabled" class="size-3 text-white" />
                    </span>
                    <span class="text-xs text-surface">{{ dialogs['share.password.enable'] }}</span>
                  </label>
                  <span v-if="canView && passwordEnabled" class="flex items-center gap-1">
                    <input
                      :value="password"
                      type="text"
                      :readonly="!canEdit"
                      :aria-label="dialogs['share.password.enable']"
                      data-test-id="share-password-input"
                      class="h-6 w-[104px] rounded bg-panel-field px-2 font-mono text-[11px] text-surface outline-none placeholder:text-muted/50 focus:bg-panel-field-hover"
                      :placeholder="
                        passwordEnabled && !password
                          ? dialogs['share.password.recoverHint']
                          : dialogs['share.password.placeholder']
                      "
                      @input="canEdit && onPasswordInput"
                      @blur="canEdit && commitPasswordInputAction"
                      @keydown.enter.prevent="canEdit && commitPasswordInputAction"
                    />
                    <button
                      v-if="canEdit"
                      type="button"
                      class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
                      :aria-label="dialogs['share.password.refresh']"
                      @click="refreshPasswordAction"
                    >
                      <icon-lucide-refresh-cw class="size-[13px]" />
                    </button>
                    <button
                      type="button"
                      class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
                      :aria-label="dialogs['share.password.copy']"
                      data-test-id="share-password-copy"
                      :disabled="!password"
                      @click="copyPassword"
                    >
                      <icon-lucide-copy class="size-[13px]" />
                    </button>
                  </span>
                </div>

              <!-- ⑤ btn-add-member（§1.1）：添加成员 -->
              <button
                v-if="canEdit"
                type="button"
                class="flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-border text-[11px] text-muted hover:bg-hover hover:text-surface"
                data-test-id="share-add-member"
                @click="openAddMember"
              >
                <icon-lucide-user-plus class="size-3" />
                {{ dialogs['share.addMember'] }}
              </button>

              <!-- ⑥ 分隔线（§1.1） -->
              <div class="h-px w-full bg-border" />

              <!-- ⑦ members（§1.1）：owner 置顶渲染，无权限下拉 -->
              <div class="flex max-h-40 flex-col gap-2.5 overflow-y-auto">
                <div
                  v-if="ownerRow"
                  class="flex h-7 items-center gap-2 px-1"
                  data-test-id="share-owner-row"
                >
                  <AvatarImage
                    :image="ownerRow.avatar.image"
                    :alt="ownerRow.name"
                    bg="#10B981"
                    :char="ownerRow.avatar.char"
                    img-class="size-6 shrink-0 rounded-xl object-cover"
                    char-class="size-6 rounded-xl text-[10px] leading-none"
                  />
                  <span class="min-w-0 flex-1 truncate text-xs text-surface">{{ ownerRow.name }}</span>
                  <span class="text-[11px] text-muted">{{ dialogs['share.owner'] }}</span>
                </div>

                <div
                  v-for="member in members"
                  :key="member.userId"
                  class="flex h-7 items-center gap-2 px-1"
                  data-test-id="share-member-row"
                >
                  <AvatarImage
                    :image="member.avatar.image"
                    :alt="member.name"
                    :bg="member.avatar.bg"
                    :char="member.avatar.char"
                    img-class="size-6 shrink-0 rounded-xl object-cover"
                    char-class="size-6 rounded-xl text-[10px] leading-none"
                  />
                  <span class="min-w-0 flex-1 truncate text-xs text-surface">{{ member.name }}</span>
                  <SelectRoot
                    v-if="canEdit"
                    :model-value="member.permission"
                    @update:model-value="(value: string) => changeMemberPermission(member, value)"
                  >
                    <SelectTrigger
                      class="flex h-[22px] cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-surface outline-none hover:bg-hover"
                    >
                      {{ memberPermLabel(member.permission) }}
                      <icon-lucide-chevron-down class="size-2.5 shrink-0 text-muted" />
                    </SelectTrigger>
                    <SelectPortal>
                      <SelectContent
                        position="popper"
                        :side-offset="4"
                        class="z-[120] w-[104px] rounded-lg border border-border bg-panel-field p-1 shadow-[0_8px_30px_rgb(0_0_0/0.4)]"
                      >
                        <SelectViewport class="flex flex-col gap-0.5">
                          <SelectItem
                            v-for="opt in memberPermOptions"
                            :key="String(opt.value)"
                            :value="opt.value"
                            class="flex h-[26px] cursor-pointer items-center rounded px-2 text-[11px] text-surface outline-none data-[highlighted]:bg-hover"
                          >
                            <SelectItemText>{{ opt.label }}</SelectItemText>
                          </SelectItem>
                        </SelectViewport>
                      </SelectContent>
                    </SelectPortal>
                  </SelectRoot>
                  <span v-else class="text-[11px] text-muted">
                    {{ memberPermLabel(member.permission) }}
                  </span>
                </div>

                <div
                  v-if="members.length === 0 && !ownerRow"
                  class="py-3 text-center text-[11px] text-muted"
                >
                  {{ dialogs['share.noMembers'] }}
                </div>
              </div>
            </div>

            <!-- 添加协作者覆盖式（§1.6） -->
            <div
              v-if="addMemberOpen"
              class="absolute inset-0 z-20 flex flex-col gap-2.5 rounded-xl border border-[#4A4A4A] bg-canvas p-3.5 shadow-[0_10px_30px_rgb(0_0_0/0.67)]"
            >
              <div class="flex items-center justify-between">
                <span class="flex items-center gap-2 text-[13px] text-surface">
                  <icon-lucide-user-plus class="size-3.5 text-muted" />
                  {{ dialogs['share.collabTitle'] }}
                </span>
                <button
                  type="button"
                  class="flex size-[22px] cursor-pointer items-center justify-center rounded hover:bg-hover"
                  :aria-label="dialogs.close"
                  @click="addMemberOpen = false"
                >
                  <icon-lucide-x class="size-3.5 text-muted" />
                </button>
              </div>
              <div class="h-px w-full bg-border" />
              <div class="relative">
                <icon-lucide-search
                  class="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted"
                />
                <input
                  v-model="memberSearch"
                  type="text"
                  class="h-7 w-full rounded bg-panel-field pr-2 pl-7 text-[11px] text-surface outline-none placeholder:text-muted focus:border focus:border-panel-focus"
                  :placeholder="dialogs['share.member.search']"
                />
              </div>
              <span class="text-[10px] font-medium text-muted">
                {{ dialogs['share.member.teamTitle'] }}
              </span>
              <div class="flex h-40 flex-col gap-1.5 overflow-y-auto scrollbar-thin">
                <div v-if="addMemberLoading" class="flex flex-col gap-1.5">
                  <div
                    v-for="i in 4"
                    :key="i"
                    class="flex h-7 animate-pulse items-center gap-2"
                  >
                    <div class="size-[22px] shrink-0 rounded-[11px] bg-hover" />
                    <div class="h-2.5 w-28 rounded bg-hover" />
                  </div>
                </div>
                <div
                  v-for="member in searchableMembers"
                  :key="member.id"
                  class="flex h-7 items-center gap-2"
                >
                  <AvatarImage
                    :image="member.avatar.image"
                    :alt="member.name"
                    :bg="member.avatar.bg"
                    :char="member.avatar.char"
                    img-class="size-[22px] shrink-0 rounded-[11px] object-cover"
                    char-class="size-[22px] rounded-[11px] text-[10px] leading-none"
                  />
                  <span class="min-w-0 flex-1 truncate text-[11px] text-surface">
                    {{ member.name }}
                  </span>
                  <button
                    v-if="!isMemberAdded(member.id)"
                    type="button"
                    class="flex h-5 cursor-pointer items-center gap-1 rounded bg-accent px-2.5 text-[10px] font-medium text-white hover:bg-accent/90"
                    :data-test-id="`share-add-option-${member.id}`"
                    @click="addMember(member.id)"
                  >
                    <icon-lucide-plus class="size-2.5" />
                    {{ dialogs['share.member.add'] }}
                  </button>
                  <span v-else class="text-[10px] text-muted">
                    {{ dialogs['share.member.added'] }}
                  </span>
                </div>
                <div
                  v-if="searchableMembers.length === 0 && !addMemberLoading"
                  class="py-3 text-center text-[11px] text-muted"
                >
                  {{ dialogs.noResults }}
                </div>
              </div>
              <div class="mt-auto flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  class="h-7 cursor-pointer rounded border border-border px-3 text-[11px] text-surface hover:bg-hover"
                  data-test-id="share-collab-close"
                  @click="addMemberOpen = false"
                >
                  {{ dialogs['share.collabClose'] }}
                </button>
                <button
                  type="button"
                  class="flex h-7 cursor-pointer items-center rounded bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent/90"
                  data-test-id="share-collab-done"
                  @click="addMemberOpen = false"
                >
                  {{ dialogs['share.collabDone'] }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </PopoverContent>
    </PopoverPortal>

    <!-- 移除协作者确认（§6.3） -->
    <AppDialogRoot v-model:open="removeDialogOpen" size="sm">
      <AppDialogHeader :heading="dialogs['share.removeTitle']" :close-label="dialogs.close" />
      <AppDialogBody>
        <p class="text-sm text-surface">
          {{ dialogs['share.removeConfirm'](removeTarget?.name ?? '') }}
        </p>
        <p class="mt-1 text-xs text-muted">{{ dialogs['share.removeDesc'] }}</p>
      </AppDialogBody>
      <AppDialogFooter>
        <button
          type="button"
          class="h-8 cursor-pointer rounded px-3 text-xs font-medium text-surface hover:bg-hover"
          @click="removeDialogOpen = false"
        >
          {{ dialogs.cancel }}
        </button>
        <button
          type="button"
          class="h-8 cursor-pointer rounded bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700"
          data-test-id="share-remove-confirm"
          @click="doRemove"
        >
          {{ dialogs['share.member.remove'] }}
        </button>
      </AppDialogFooter>
    </AppDialogRoot>
  </PopoverRoot>
</template>
