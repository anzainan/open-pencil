<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import { isAdmin } from '@/app/auth/session'
import { createMember } from '@/app/bridge/share'
import { toast } from '@/app/shell/ui'
import AppSelect from '@/components/ui/AppSelect.vue'
import {
  commitPendingMembers,
  loadTeamMembers,
  pendingCount,
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

const canOperate = computed(() => isAdmin.value)

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

async function savePending(): Promise<void> {
  try {
    const count = await commitPendingMembers()
    if (count > 0) toast.info(dialogs.value['team.saved'])
  } catch (error) {
    console.warn('[team] save pending failed', error)
    toast.error(dialogs.value['team.saveFailed'])
  }
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test-id="settings-team-panel">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsTeam }}</h3>
      <button
        v-if="canOperate"
        type="button"
        class="flex h-7 cursor-pointer items-center gap-1 rounded border border-border px-2 text-[11px] text-surface hover:bg-hover"
        data-test-id="team-add-member"
        @click="openAdd"
      >
        <icon-lucide-user-plus class="size-3.5" />
        {{ dialogs['team.addMember'] }}
      </button>
    </div>

    <div
      class="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 px-2 pb-1 text-[10px] text-muted"
      data-test-id="team-column-headers"
    >
      <span class="w-4" />
      <span>{{ dialogs['team.colName'] }}</span>
      <span>{{ dialogs['team.colPassword'] }}</span>
      <span class="text-right">{{ dialogs['team.colRole'] }}</span>
    </div>

    <div class="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
      <div
        v-if="teamMembersLoaded && teamMembers.length === 0"
        class="py-4 text-center text-[11px] text-muted"
      >
        {{ dialogs['team.noMembers'] }}
      </div>

      <div
        v-for="member in teamMembers"
        :key="member.id"
        class="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
        :data-test-id="`team-member-row-${member.id}`"
        :data-fixed="member.fixed ?? false"
      >
        <button
          v-if="canOperate && !member.fixed"
          type="button"
          class="flex size-4 cursor-pointer items-center justify-center rounded-[3px] border border-muted"
          :class="member.selected ? 'bg-accent border-accent' : 'bg-panel'"
          :aria-label="dialogs['team.selectMember']"
          data-test-id="team-member-check"
          @click="toggleMemberSelected(member.id)"
        >
          <icon-lucide-check v-if="member.selected" class="size-2.5 text-white" />
        </button>
        <span v-else class="flex size-4 items-center justify-center">
          <icon-lucide-lock v-if="member.fixed" class="size-3 text-muted" />
        </span>

        <span class="flex min-w-0 items-center gap-1.5">
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] text-white"
            :style="{ backgroundColor: member.avatar.bg }"
          >
            {{ member.avatar.char }}
          </span>
          <span class="truncate text-[11px] text-surface">{{ member.name }}</span>
          <span v-if="member.fixed" class="shrink-0 text-[9px] text-muted">
            {{ dialogs['share.owner'] }}
          </span>
        </span>

        <template v-if="canOperate && !member.fixed">
          <span class="flex items-center gap-1">
            <input
              :value="member.passwordDraft"
              type="text"
              class="h-6 w-24 rounded border border-border bg-panel px-1.5 text-[11px] text-surface outline-none placeholder:text-muted focus:border-accent"
              :placeholder="dialogs['team.passwordPlaceholder']"
              data-test-id="team-member-password"
              @input="onPasswordInput(member.id, $event)"
            />
            <button
              type="button"
              class="flex size-5 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
              :aria-label="dialogs['team.randomPassword']"
              data-test-id="team-member-password-random"
              @click="onRandomPassword(member.id)"
            >
              <icon-lucide-refresh-cw class="size-3" />
            </button>
          </span>
        </template>
        <template v-else>
          <span class="text-[10px] text-muted">—</span>
        </template>

        <span class="flex justify-end">
          <AppSelect
            v-if="canOperate && !member.fixed"
            :model-value="member.roleDraft"
            :options="roleOptions"
            :ui="{ trigger: 'h-6 min-w-0 text-[11px]' }"
            data-test-id="team-member-role"
            @update:model-value="(value: string) => onRoleChange(member.id, value)"
          />
          <span v-else class="text-[10px] text-muted">
            {{ dialogs[`role.${member.role}`] }}
          </span>
        </span>
      </div>
    </div>

    <div v-if="canOperate" class="flex items-center justify-between border-t border-border pt-2">
      <div class="flex items-center gap-2">
        <button
          v-if="pendingCount > 0"
          type="button"
          class="h-7 cursor-pointer rounded px-2.5 text-[11px] font-medium text-accent hover:bg-hover"
          data-test-id="team-save-pending"
          @click="savePending"
        >
          {{ dialogs['team.savePending'] }}
        </button>
      </div>
      <button
        type="button"
        class="flex h-7 cursor-pointer items-center gap-1 rounded border px-2.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
        :class="selectedCount > 0 ? 'border-red-600/50 text-red-500 hover:bg-red-600/10' : 'border-border text-muted'"
        :disabled="selectedCount === 0"
        data-test-id="team-remove-members"
        @click="openRemove"
      >
        <icon-lucide-user-minus class="size-3.5" />
        {{ dialogs['team.removeMembers'] }}
      </button>
    </div>
  </section>

  <!-- 添加成员弹窗（设计稿 0:2507 AddMemberDialog 360×300） -->
  <DialogRoot v-model:open="addOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] p-5 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
        data-test-id="team-add-dialog"
      >
        <div class="flex items-center justify-between">
          <span class="text-[13px] font-medium text-surface">{{ dialogs['team.addMember'] }}</span>
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
          <span class="text-[10px] text-muted">{{ dialogs['team.colName'] }}</span>
          <input
            v-model="addName"
            type="text"
            class="h-8 w-full rounded-md border border-[#3A3A3A] bg-[#1E1E1E] px-2.5 text-[12px] text-surface outline-none placeholder:text-muted focus:border-accent"
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
              class="h-8 w-full rounded-md border border-[#3A3A3A] bg-[#1E1E1E] px-2.5 text-[12px] text-surface outline-none placeholder:text-muted focus:border-accent"
              :placeholder="dialogs['team.addPasswordPlaceholder']"
              data-test-id="team-add-password"
            />
            <button
              type="button"
              class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#3A3A3A] text-muted hover:bg-hover hover:text-surface"
              :aria-label="dialogs['team.randomPassword']"
              data-test-id="team-add-password-random"
              @click="addPassword = randomPassword()"
            >
              <icon-lucide-refresh-cw class="size-3.5" />
            </button>
          </span>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] text-muted">{{ dialogs['team.colRole'] }}</span>
          <AppSelect
            v-model="addRole"
            :options="roleOptions"
            :ui="{ trigger: 'h-8 w-full text-[12px]' }"
            data-test-id="team-add-role"
          />
        </label>

        <div class="mt-auto flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-9 cursor-pointer rounded-md border border-[#3A3A3A] px-4 text-[12px] text-surface hover:bg-hover"
            data-test-id="team-add-cancel"
            @click="addOpen = false"
          >
            {{ dialogs.cancel }}
          </button>
          <button
            type="button"
            :disabled="adding"
            class="h-9 cursor-pointer rounded-md bg-accent px-4 text-[12px] font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-test-id="team-add-submit"
            @click="addAndCopy"
          >
            {{ dialogs['team.addAndCopy'] }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- 移除成员确认（设计稿 0:1372 RemoveDialog） -->
  <DialogRoot v-model:open="removeOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex h-[200px] w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] p-5 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
        data-test-id="team-remove-dialog"
      >
        <div class="flex items-center justify-between">
          <span class="text-[13px] font-medium text-surface">{{ dialogs['team.removeTitle'] }}</span>
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
        <p class="mt-4 text-[11px] leading-[18px] text-muted" data-test-id="team-remove-desc">
          {{ removeConfirmText }}
        </p>
        <p class="mt-1 text-[10px] text-muted/70">{{ dialogs['team.removeDesc'] }}</p>
        <div class="mt-auto flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-9 cursor-pointer rounded-md border border-[#3A3A3A] px-4 text-[12px] text-surface hover:bg-hover"
            data-test-id="team-remove-cancel"
            @click="removeOpen = false"
          >
            {{ dialogs.cancel }}
          </button>
          <button
            type="button"
            :disabled="removing"
            class="h-9 cursor-pointer rounded-md bg-[#EF4444] px-4 text-[12px] font-medium text-white hover:bg-[#EF4444]/90 disabled:cursor-not-allowed disabled:opacity-50"
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
