<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

import { isAdmin } from '@/app/auth/session'
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
  avatar: { char: string; bg: string }
  permission: MemberPerm
}

const store = useEditorStore()
const { dialogs } = useI18n()
const cls = usePopoverUI({ content: 'z-50 w-[320px] p-0' })
const { copy: copyText } = useClipboard()

const popoverOpen = ref(false)
const loading = ref(false)
const saving = ref(false)

const documentPath = computed(() => store.getStorageBinding()?.documentId ?? '')
const canEdit = computed(() => isAdmin.value)

const scope = ref<Scope>('self')
const permission = ref<Perm>('view')
const passwordEnabled = ref(false)
const password = ref('')
const linkURL = ref('')
const members = ref<MemberRow[]>([])
const allMembers = ref<BridgeMemberInfo[]>([])
const memberSearch = ref('')
const addMemberOpen = ref(false)

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

function avatarFor(userId: string): { char: string; bg: string } {
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
    if (share) {
      scope.value = share.scope
      permission.value = share.permission
      passwordEnabled.value = share.passwordEnabled
      linkURL.value = share.url ?? ''
    }
    const permMembers = (perm?.members ?? []) as { userId: string; permission: MemberPerm }[]
    // owner（fixed）默认全权限：不进权限设置成员列表，也不被保存/移除（B1）。
    const ownerId = allMembers.value.find((member) => member.fixed)?.id
    members.value = permMembers
      .filter((member) => member.permission !== 'none' && member.userId !== ownerId)
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

function withSaving(fn: () => Promise<void>): void {
  if (saving.value || !documentPath.value) return
  saving.value = true
  void fn()
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
    })
}

async function saveScopeAndPermission(): Promise<void> {
  const link = await saveShare(documentPath.value, {
    scope: scope.value,
    permission: permission.value
  })
  await saveFilePermissions(documentPath.value, { scope: scope.value })
  applyLink(link)
}

function applyLink(link: BridgeShareSettings): void {
  linkURL.value = link.url ?? ''
  passwordEnabled.value = link.passwordEnabled
  if (!link.passwordEnabled) {
    password.value = ''
  }
}

function changeScope(): void {
  if (!canEdit.value || saving.value) return
  withSaving(saveScopeAndPermission)
}

function changePermission(): void {
  if (!canEdit.value || saving.value) return
  withSaving(async () => {
    const link = await saveShare(documentPath.value, {
      scope: scope.value,
      permission: permission.value
    })
    applyLink(link)
  })
}

function copyLink(): void {
  if (!linkURL.value) return
  copyText(linkURL.value)
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

function togglePassword(): void {
  withSaving(passwordEnabled.value ? disablePassword : enablePassword)
}

function refreshPasswordAction(): void {
  withSaving(refreshPassword)
}

function copyPassword(): void {
  if (!password.value) return
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
  withSaving(saveMembers)
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
  withSaving(saveMembers)
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
  withSaving(saveMembers)
}

function openAddMember(): void {
  memberSearch.value = ''
  addMemberOpen.value = true
}

onMounted(() => {
  void load()
})
</script>

<template>
  <PopoverRoot
    v-model:open="popoverOpen"
    @update:open="(open: boolean) => { if (open) { addMemberOpen = false; void load() } }"
  >
    <PopoverTrigger as-child>
      <button
        type="button"
        data-test-id="share-button"
        class="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded px-2 text-[11px] font-medium text-surface hover:bg-hover"
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
                    class="flex cursor-pointer items-center gap-1 text-[11px] text-muted outline-none data-[scope-team]:text-surface data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
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
                    class="flex h-[22px] cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-surface outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
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

              <!-- ③ copy-btn（§1.1）：蓝底复制链接 -->
              <button
                v-if="canEdit"
                type="button"
                class="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-accent text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="!linkURL"
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

              <!-- ④ pw-row（§1.1）：启用密码 + 密码值/刷新/复制 -->
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
                <span v-if="canEdit && passwordEnabled" class="flex items-center gap-1">
                  <code
                    class="flex h-6 items-center rounded bg-panel-field px-2 font-mono text-[11px] text-surface"
                  >
                    {{ password || '••••••' }}
                  </code>
                  <button
                    type="button"
                    class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
                    :aria-label="dialogs['share.password.refresh']"
                    @click="refreshPasswordAction"
                  >
                    <icon-lucide-refresh-cw class="size-[13px]" />
                  </button>
                  <button
                    type="button"
                    class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
                    :aria-label="dialogs['share.password.copy']"
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

              <!-- ⑦ members（§1.1，owner 不渲染，B1） -->
              <div class="flex max-h-40 flex-col gap-2.5 overflow-y-auto">
                <div
                  v-for="member in members"
                  :key="member.userId"
                  class="flex h-7 items-center gap-2 px-1"
                  data-test-id="share-member-row"
                >
                  <span
                    class="flex size-6 shrink-0 items-center justify-center rounded-xl text-[10px] leading-none text-white"
                    :style="{ backgroundColor: member.avatar.bg }"
                  >
                    {{ member.avatar.char }}
                  </span>
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

                <div v-if="members.length === 0" class="py-3 text-center text-[11px] text-muted">
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
              <div class="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                <div
                  v-for="member in searchableMembers"
                  :key="member.id"
                  class="flex h-7 items-center gap-2"
                >
                  <span
                    class="flex size-[22px] shrink-0 items-center justify-center rounded-[11px] text-[10px] leading-none text-white"
                    :style="{ backgroundColor: member.avatar.bg }"
                  >
                    {{ member.avatar.char }}
                  </span>
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
                <div v-if="searchableMembers.length === 0" class="py-3 text-center text-[11px] text-muted">
                  {{ dialogs.noResults }}
                </div>
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
