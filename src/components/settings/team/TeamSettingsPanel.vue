<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import { isAdmin, useCurrentUser } from '@/app/auth/session'
import { createMember } from '@/app/bridge/share'
import { toast } from '@/app/shell/ui'
import AppSelect from '@/components/ui/AppSelect.vue'
import {
  loadTeamMembers,
  randomPassword,
  removeSelectedMembers,
  selectedCount,
  selectedMembers,
  setMemberPassword,
  setMemberRole,
  teamMembers,
  teamMembersLoaded,
  toggleMemberSelected
} from '@/app/settings/team-store'

defineOptions({ name: 'TeamSettingsPanel' })

const { dialogs } = useI18n()
const { copy: copyText } = useClipboard()
const currentUser = useCurrentUser()

const canOperate = computed(() => isAdmin.value)

const teamName = computed(() => currentUser.value?.name ?? '—')

/** 成员列表：owner（fixed）行置顶展示「所有者」（设计稿 §4.1），无 checkbox/密码/下拉。 */
const memberRows = computed(() => teamMembers.value)

const roleOptions = computed(() => [
  { value: 'admin', label: dialogs.value['role.admin'] },
  { value: 'member', label: dialogs.value['role.member'] }
])

const addOpen = ref(false)
const addName = ref('')
const addPassword = ref('')
const addRole = ref<'admin' | 'member'>('member')
const adding = ref(false)

const removeOpen = ref(false)
const removing = ref(false)

const removeNames = computed(() =>
  selectedMembers.value.map((member) => member.name)
)

const removeConfirmText = computed(() => {
  if (removeNames.value.length === 1) {
    return dialogs.value['team.removeConfirm']({ name: removeNames.value[0] ?? '' })
  }
  return dialogs.value['team.removeConfirmMulti']({ count: removeNames.value.length })
})

onMounted(() => {
  if (!teamMembersLoaded.value) void loadTeamMembers().catch((error) => {
    console.warn('[team] load failed', error)
  })
})

function onPasswordInput(id: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  setMemberPassword(id, value)
}

function onRandomPassword(id: string): void {
  setMemberPassword(id, randomPassword())
}

function onRoleChange(id: string, value: string): void {
  setMemberRole(id, value as 'admin' | 'member')
}

function openAdd(): void {
  addName.value = ''
  addPassword.value = ''
  addRole.value = 'member'
  addOpen.value = true
}

async function addAndCopy(): Promise<void> {
  if (adding.value) return
  const name = addName.value.trim()
  if (!name) {
    toast.error(dialogs.value['team.addNameRequired'])
    return
  }
  const password = addPassword.value || randomPassword()
  adding.value = true
  try {
    const { user } = await createMember({ name, password, role: addRole.value })
    const roleLabel = addRole.value === 'admin' ? dialogs.value['role.admin'] : dialogs.value['role.member']
    copyText(`${user.name} / ${password} / ${roleLabel}`)
    toast.info(dialogs.value['team.addCopied'])
    addOpen.value = false
    await loadTeamMembers()
  } catch (error) {
    console.warn('[team] add member failed', error)
    toast.error(dialogs.value['team.addFailed'])
  } finally {
    adding.value = false
  }
}

function openRemove(): void {
  if (selectedMembers.value.length === 0) return
  removeOpen.value = true
}

async function confirmRemove(): Promise<void> {
  if (removing.value) return
  removing.value = true
  try {
    const removed = await removeSelectedMembers()
    toast.info(dialogs.value['team.removed']({ count: removed.length }))
    removeOpen.value = false
  } catch (error) {
    console.warn('[team] remove failed', error)
    toast.error(dialogs.value['team.removeFailed'])
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test-id="settings-team-panel">
    <!-- SecTitle（设计稿 §4.1） -->
    <div>
      <h3 class="text-base font-semibold text-surface">{{ dialogs.settingsTeam }}</h3>
      <p class="mt-0.5 text-xs text-muted">{{ dialogs['team.manageDescription'] }}</p>
    </div>

    <!-- TeamCard（设计稿 §4.1） -->
    <div class="flex items-center gap-3 rounded-lg border border-border bg-panel p-3" data-test-id="team-card">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-component"
        data-test-id="team-card-icon"
      >
        <icon-lucide-users class="size-5 text-white" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[13px] font-medium text-surface" data-test-id="team-card-name">
          {{ teamName }}
        </p>
        <p class="text-[10px] text-muted" data-test-id="team-card-count">
          {{ dialogs['team.memberCount']({ count: teamMembers.length }) }}
        </p>
      </div>
      <button
        v-if="canOperate"
        type="button"
        class="h-7 shrink-0 cursor-pointer rounded border border-border px-2 text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="selectedCount === 0"
        data-test-id="team-remove-top"
        @click="openRemove"
      >
        {{ dialogs['team.removeConfirmAction'] }}
      </button>
      <button
        v-if="canOperate"
        type="button"
        class="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded bg-accent px-2 text-[11px] font-medium text-white hover:bg-accent/90"
        data-test-id="team-add-member"
        @click="openAdd"
      >
        <icon-lucide-user-plus class="size-3" />
        {{ dialogs['team.addMember'] }}
      </button>
    </div>

    <!-- MemberList（设计稿 §4.1；行高 32 / px 4 / gap 8，owner 行置顶「所有者」无权限控制） -->
    <div class="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
      <div
        v-if="teamMembersLoaded && memberRows.length === 0"
        class="py-4 text-center text-[11px] text-muted"
      >
        {{ dialogs['team.noMembers'] }}
      </div>

      <div
        v-for="member in memberRows"
        :key="member.id"
        class="flex h-8 items-center gap-2 rounded-md px-1 hover:bg-hover"
        :data-test-id="`team-member-row-${member.id}`"
      >
        <template v-if="member.fixed">
          <!-- owner 行（§4.1）：无 checkbox、头像 #10B981、静态「所有者」标签、无密码列/角色下拉 -->
          <span class="flex size-4 shrink-0 items-center justify-center" />
          <img
            v-if="member.avatar.image"
            :src="`/api/v1/avatars/${(member.avatar.image ?? '').split('/').pop()}`"
            class="size-6 shrink-0 rounded-full object-cover"
            :alt="member.name"
          />
          <span
            v-else
            class="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
            :style="{ backgroundColor: '#10B981' }"
          >
            {{ member.avatar.char }}
          </span>
          <span class="min-w-0 truncate text-xs text-surface">{{ member.name }}</span>
          <span class="ml-auto shrink-0 text-[11px] text-muted">
            {{ dialogs['share.owner'] }}
          </span>
        </template>
        <template v-else>
          <button
            v-if="canOperate"
            type="button"
            class="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-muted bg-panel data-[selected]:border-accent data-[selected]:bg-accent"
            :data-selected="member.selected || undefined"
            :aria-label="dialogs['team.selectMember']"
            data-test-id="team-member-check"
            @click="toggleMemberSelected(member.id)"
          >
            <icon-lucide-check v-if="member.selected" class="size-2.5 text-white" />
          </button>
          <span v-else class="flex size-4 shrink-0 items-center justify-center" />

          <img
            v-if="member.avatar.image"
            :src="`/api/v1/avatars/${(member.avatar.image ?? '').split('/').pop()}`"
            class="size-6 shrink-0 rounded-full object-cover"
            :alt="member.name"
          />
          <span
            v-else
            class="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
            :style="{ backgroundColor: member.avatar.bg }"
          >
            {{ member.avatar.char }}
          </span>
          <span class="min-w-0 truncate text-xs text-surface">{{ member.name }}</span>

          <template v-if="canOperate">
            <span class="ml-auto flex shrink-0 items-center gap-1">
              <input
                :value="member.passwordDraft"
                type="text"
                class="h-[22px] w-[92px] rounded-[4px] bg-panel-field px-1.5 text-[10px] text-surface outline-none placeholder:text-muted focus:bg-panel-field-hover"
                :placeholder="dialogs['team.passwordPlaceholder']"
                data-test-id="team-member-password"
                @input="onPasswordInput(member.id, $event)"
              />
              <button
                type="button"
                class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
                :aria-label="dialogs['team.randomPassword']"
                data-test-id="team-member-password-random"
                @click="onRandomPassword(member.id)"
              >
                <icon-lucide-refresh-cw class="size-[11px]" />
              </button>
              <AppSelect
                :model-value="member.roleDraft"
                :options="roleOptions"
                :ui="{ trigger: 'h-6 min-w-0 text-[11px]' }"
                data-test-id="team-member-role"
                @update:model-value="(value: string) => onRoleChange(member.id, value)"
              />
            </span>
          </template>
          <span v-else class="ml-auto shrink-0 text-[11px] text-muted">
            {{ dialogs[`role.${member.role}`] }}
          </span>
        </template>
      </div>
    </div>
  </section>

  <!-- 添加成员弹窗（设计稿 §4.3 AddMemberDialog 360×300） -->
  <DialogRoot v-model:open="addOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex h-[300px] w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] p-5 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
        data-test-id="team-add-dialog"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-surface">{{ dialogs['team.addMember'] }}</span>
          <button
            type="button"
            class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            :aria-label="dialogs.close"
            data-test-id="team-add-close"
            @click="addOpen = false"
          >
            <icon-lucide-x class="size-3.5" />
          </button>
        </div>
        <div class="h-px w-full bg-[#3A3A3A]" />

        <label class="flex flex-col gap-1">
          <span class="text-[10px] text-muted">{{ dialogs['team.addName'] }}</span>
          <input
            v-model="addName"
            type="text"
            class="h-8 w-full rounded-[4px] bg-panel-field px-2.5 text-xs text-surface outline-none placeholder:text-muted focus:bg-panel-field-hover"
            :placeholder="dialogs['team.addNamePlaceholder']"
            data-test-id="team-add-name"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] text-muted">{{ dialogs['team.colPassword'] }}</span>
          <span class="flex items-center gap-1.5">
            <input
              v-model="addPassword"
              type="text"
              class="h-8 w-full rounded-[4px] bg-panel-field px-2.5 text-xs text-surface outline-none placeholder:text-muted focus:bg-panel-field-hover"
              :placeholder="dialogs['team.addPasswordPlaceholder']"
              data-test-id="team-add-password"
            />
            <button
              type="button"
              class="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-[#3A3A3A] px-2.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
              :aria-label="dialogs['team.randomPassword']"
              data-test-id="team-add-password-random"
              @click="addPassword = randomPassword()"
            >
              <icon-lucide-refresh-cw class="size-3" />
              {{ dialogs['team.random'] }}
            </button>
          </span>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] text-muted">{{ dialogs['team.addRole'] }}</span>
          <AppSelect
            v-model="addRole"
            :options="roleOptions"
            :ui="{ trigger: 'h-8 w-full text-xs' }"
            data-test-id="team-add-role"
          />
        </label>

        <div class="mt-auto flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-7 cursor-pointer rounded-md border border-[#3A3A3A] px-3 text-[11px] text-surface hover:bg-hover"
            data-test-id="team-add-cancel"
            @click="addOpen = false"
          >
            {{ dialogs.cancel }}
          </button>
          <button
            type="button"
            :disabled="adding"
            class="flex h-7 cursor-pointer items-center gap-1 rounded-md bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-test-id="team-add-submit"
            @click="addAndCopy"
          >
            <icon-lucide-copy-plus class="size-3" />
            {{ dialogs['team.addAndCopy'] }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- 移除成员确认（设计稿 §4.4 RemoveDialog 360×200） -->
  <DialogRoot v-model:open="removeOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex h-[200px] w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] p-5 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
        data-test-id="team-remove-dialog"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-surface">{{ dialogs['team.removeTitle'] }}</span>
          <button
            type="button"
            class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            :aria-label="dialogs.cancel"
            data-test-id="team-remove-close"
            @click="removeOpen = false"
          >
            <icon-lucide-x class="size-3.5" />
          </button>
        </div>
        <div class="mt-1 h-px w-full bg-[#3A3A3A]" />
        <p class="mt-4 text-xs leading-[18px] text-surface" data-test-id="team-remove-desc">
          {{ removeConfirmText }}
        </p>
        <p class="mt-1 text-[11px] text-muted">{{ dialogs['team.removeDesc'] }}</p>
        <div class="mt-auto flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-7 cursor-pointer rounded-md border border-[#3A3A3A] px-3 text-[11px] text-surface hover:bg-hover"
            data-test-id="team-remove-cancel"
            @click="removeOpen = false"
          >
            {{ dialogs.cancel }}
          </button>
          <button
            type="button"
            :disabled="removing"
            class="h-7 cursor-pointer rounded-md bg-[#EF4444] px-3 text-[11px] font-medium text-white hover:bg-[#EF4444]/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-test-id="team-remove-confirm"
            @click="confirmRemove"
          >
            {{ dialogs['team.removeConfirmAction'] }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
