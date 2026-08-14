<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

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
import AppSelect from '@/components/ui/AppSelect.vue'
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

const scopeOptions = computed(() => [
  { value: 'internet' as Scope, label: dialogs.value['share.scope.internet'] },
  { value: 'team' as Scope, label: dialogs.value['share.scope.team'] },
  { value: 'self' as Scope, label: dialogs.value['share.scope.self'] }
])

const permissionOptions = computed(() => [
  { value: 'view' as Perm, label: dialogs.value['share.permission.view'] },
  { value: 'edit' as Perm, label: dialogs.value['share.permission.edit'] }
])

const memberPermOptions = computed(() => [
  { value: 'view', label: dialogs.value['share.member.view'] },
  { value: 'edit', label: dialogs.value['share.member.edit'] },
  { value: 'remove', label: dialogs.value['share.member.remove'] }
])

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

onMounted(() => {
  void load()
})
</script>

<template>
  <PopoverRoot v-model:open="popoverOpen" @update:open="(open: boolean) => open && load()">
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
        <div class="flex flex-col">
          <!-- header -->
          <div class="flex items-center justify-between border-b border-border px-3 py-2">
            <span class="text-[13px] font-semibold text-surface">{{ dialogs['share.title'] }}</span>
            <span class="flex size-3.5 text-muted">
              <icon-lucide-share-2 class="size-3.5" />
            </span>
          </div>

          <div v-if="loading" class="flex h-40 items-center justify-center text-xs text-muted">
            …
          </div>

          <template v-else>
            <div class="flex flex-col gap-2 px-3 py-2">
              <!-- scope + board permission -->
              <div class="flex items-center gap-1.5">
                <AppSelect
                  v-model="scope"
                  :options="scopeOptions"
                  :disabled="!canEdit"
                  @update:model-value="changeScope"
                />
                <AppSelect
                  v-model="permission"
                  :options="permissionOptions"
                  :disabled="!canEdit"
                  @update:model-value="changePermission"
                />
              </div>

              <!-- internet: copy link + password -->
              <template v-if="scope === 'internet'">
                <button
                  v-if="canEdit"
                  type="button"
                  class="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-surface hover:bg-hover"
                  data-test-id="share-copy-link"
                  @click="copyLink"
                >
                  <icon-lucide-link-2 class="size-3.5 text-muted" />
                  <span class="flex-1 truncate text-left">{{ dialogs['share.copyLink'] }}</span>
                  <span class="max-w-[46%] truncate text-muted">{{ linkURL || '…' }}</span>
                </button>

                <label
                  v-if="canEdit"
                  class="flex cursor-pointer items-center gap-2 text-[11px] text-surface"
                >
                  <input
                    type="checkbox"
                    class="accent-accent"
                    :checked="passwordEnabled"
                    @change="togglePassword"
                  />
                  <span class="flex-1">{{ dialogs['share.password.enable'] }}</span>
                  <template v-if="passwordEnabled">
                    <code class="rounded bg-hover px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-accent">
                      {{ password }}
                    </code>
                    <button
                      type="button"
                      class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
                      :aria-label="dialogs['share.password.refresh']"
                      @click="refreshPasswordAction"
                    >
                      <icon-lucide-refresh-cw class="size-3" />
                    </button>
                    <button
                      type="button"
                      class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
                      :aria-label="dialogs['share.password.copy']"
                      @click="copyPassword"
                    >
                      <icon-lucide-copy class="size-3" />
                    </button>
                  </template>
                </label>

                <div v-else class="flex items-center gap-1.5 text-[11px] text-muted">
                  <icon-lucide-link-2 class="size-3.5" />
                  <span class="flex-1 truncate">{{ linkURL }}</span>
                </div>
              </template>

              <!-- add member -->
              <button
                v-if="canEdit"
                type="button"
                class="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[11px] text-surface hover:bg-hover"
                data-test-id="share-add-member"
                @click="addMemberOpen = true"
              >
                <icon-lucide-user-plus class="size-3.5 text-muted" />
                {{ dialogs['share.addMember'] }}
              </button>
            </div>

            <!-- member list（owner 默认全权限，不渲染，B1） -->
            <div class="max-h-40 overflow-y-auto border-t border-border px-3 py-2">
              <div
                v-for="member in members"
                :key="member.userId"
                class="flex h-7 items-center gap-2 rounded px-1 text-[11px]"
                data-test-id="share-member-row"
              >
                <span
                  class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] leading-[11px] text-white"
                  :style="{ backgroundColor: member.avatar.bg }"
                >
                  {{ member.avatar.char }}
                </span>
                <span class="min-w-0 flex-1 truncate text-surface">{{ member.name }}</span>
                <AppSelect
                  v-if="canEdit"
                  :model-value="member.permission"
                  :options="memberPermOptions"
                  @update:model-value="(value: string) => changeMemberPermission(member, value)"
                />
                <span v-else class="text-muted">{{ dialogs[`share.member.${member.permission}`] }}</span>
              </div>

              <div
                v-if="members.length === 0"
                class="py-3 text-center text-[11px] text-muted"
              >
                {{ dialogs['share.noMembers'] }}
              </div>
            </div>
          </template>
        </div>
      </PopoverContent>
    </PopoverPortal>

    <!-- 添加成员（覆盖式 0:2109→0:2166） -->
    <AppDialogRoot v-model:open="addMemberOpen" size="sm">
      <AppDialogHeader :heading="dialogs['share.addMember']" :close-label="dialogs.close" />
      <AppDialogBody>
        <div class="relative">
          <icon-lucide-search
            class="pointer-events-none absolute top-2 left-2 size-3.5 text-muted"
          />
          <input
            v-model="memberSearch"
            type="text"
            class="h-8 w-full rounded-md border border-border bg-panel pr-2 pl-7 text-xs text-surface outline-none placeholder:text-muted focus:border-accent"
            :placeholder="dialogs['share.member.search']"
          />
        </div>
        <div class="mt-2 flex max-h-52 flex-col gap-0.5 overflow-y-auto">
          <button
            v-for="member in searchableMembers"
            :key="member.id"
            type="button"
            class="flex h-8 w-full cursor-pointer items-center gap-2 rounded px-1 text-left hover:bg-hover"
            :data-test-id="`share-add-option-${member.id}`"
            @click="addMember(member.id)"
          >
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] leading-[11px] text-white"
              :style="{ backgroundColor: member.avatar.bg }"
            >
              {{ member.avatar.char }}
            </span>
            <span class="min-w-0 flex-1 truncate text-surface">{{ member.name }}</span>
            <span
              class="text-[10px]"
              :class="isMemberAdded(member.id) ? 'text-muted' : 'text-accent'"
            >
              {{ isMemberAdded(member.id) ? dialogs['share.member.added'] : dialogs['share.member.add'] }}
            </span>
          </button>
          <div v-if="searchableMembers.length === 0" class="py-3 text-center text-[11px] text-muted">
            {{ dialogs.noResults }}
          </div>
        </div>
      </AppDialogBody>
      <AppDialogFooter>
        <button
          type="button"
          class="h-8 cursor-pointer rounded px-3 text-xs font-medium text-surface hover:bg-hover"
          @click="addMemberOpen = false"
        >
          {{ dialogs.done }}
        </button>
      </AppDialogFooter>
    </AppDialogRoot>

    <!-- 移除协作者确认（0:1645） -->
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
