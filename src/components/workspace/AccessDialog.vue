<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import { isAdmin } from '@/app/auth/session'
import { bridgeClient } from '@/app/bridge/client'
import { listMembers, saveFilePermissions, type BridgeMemberInfo } from '@/app/bridge/share'
import { toast } from '@/app/shell/ui'
import AppSelect from '@/components/ui/AppSelect.vue'

const open = defineModel<boolean>('open', { default: false })

const { folderName } = defineProps<{
  folderName: string
}>()

const { dialogs } = useI18n()

const canOperate = computed(() => isAdmin.value)

type AccessMode = 'team' | 'collab'
type Perm = 'view' | 'edit'

interface CollabRow {
  id: string
  name: string
  avatar: { char: string; bg: string }
  selected: boolean
  permission: Perm
}

const mode = ref<AccessMode>('team')
const rows = ref<CollabRow[]>([])
const loading = ref(false)
const saving = ref(false)
const loaded = ref(false)

const selectedRows = computed(() => rows.value.filter((row) => row.selected))

const permissionOptions = computed(() => [
  { value: 'view' as Perm, label: dialogs.value['access.view'] },
  { value: 'edit' as Perm, label: dialogs.value['access.edit'] }
])

function applyExisting(members: BridgeMemberInfo[], existing: { userId: string; permission: string }[]): void {
  const existingMap = new Map(existing.map((member) => [member.userId, member.permission]))
  rows.value = members.map((member) => {
    const stored = existingMap.get(member.id)
    const permission: Perm = stored === 'edit' ? 'edit' : 'view'
    return {
      id: member.id,
      name: member.name,
      avatar: member.avatar,
      selected: stored === 'view' || stored === 'edit',
      permission
    }
  })
  if (existing.length === 0) {
    // 无既有权限 → 默认「团队成员（所有成员可访问）」。
    mode.value = 'team'
    return
  }
  // 全部成员可访问（team 模式）判定：所有非 owner 成员都有 view 权限。
  const nonOwner = members.filter((member) => !member.fixed)
  const allView = nonOwner.length > 0 && nonOwner.every((member) => existingMap.get(member.id) === 'view')
  mode.value = allView ? 'team' : 'collab'
}

async function load(): Promise<void> {
  if (!open.value || loading.value) return
  loading.value = true
  try {
    const [members, perm] = await Promise.all([
      listMembers().catch(() => []),
      bridgeClient.getPermissions(folderName).catch(() => null)
    ])
    applyExisting(members, perm?.members ?? [])
    loaded.value = true
  } catch (error) {
    console.warn('[access] load failed', error)
    toast.error(dialogs.value['access.loadFailed'])
  } finally {
    loading.value = false
  }
}

function toggleRow(id: string): void {
  const row = rows.value.find((candidate) => candidate.id === id)
  if (!row) return
  row.selected = !row.selected
}

function changePermission(id: string, value: string): void {
  const row = rows.value.find((candidate) => candidate.id === id)
  if (!row || (value !== 'view' && value !== 'edit')) return
  row.permission = value
}

async function save(): Promise<void> {
  if (saving.value || !canOperate.value) return
  saving.value = true
  try {
    let members: { userId: string; permission: Perm }[]
    if (mode.value === 'team') {
      // 团队成员（所有成员可访问）：全部成员 view（owner 有 admin 特权恒可访问，写入无害），
      // 文件夹权限自动继承到内部文件（REQ §5）。
      members = rows.value.map((row) => ({ userId: row.id, permission: 'view' as Perm }))
    } else {
      members = selectedRows.value.map((row) => ({ userId: row.id, permission: row.permission }))
    }
    await saveFilePermissions(folderName, { scope: 'team', members })
    // 保存后回读验证文件夹权限条目可写可读。
    const verify = await bridgeClient.getPermissions(folderName).catch(() => null)
    if (verify) {
      toast.info(dialogs.value['access.saveSuccess'])
      open.value = false
    } else {
      toast.error(dialogs.value['access.saveFailed'])
    }
  } catch (error) {
    console.warn('[access] save failed', error)
    toast.error(dialogs.value['access.saveFailed'])
  } finally {
    saving.value = false
  }
}

function closeDialog(): void {
  if (saving.value) return
  open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) void load()
})
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex w-[480px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] p-5 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
        data-test-id="folder-access-dialog"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <icon-lucide-user-cog class="size-3.5 text-muted" />
            <span class="text-[13px] leading-4 text-surface">{{ dialogs.accessDialogTitle }}</span>
          </div>
          <button
            type="button"
            data-test-id="dlg-close"
            class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            @click="closeDialog"
          >
            <icon-lucide-x class="size-3.5" />
          </button>
        </div>

        <div class="h-px w-full bg-[#3A3A3A]" />

        <div class="flex items-center gap-2 rounded-md bg-[#1E1E1E] p-2">
          <icon-lucide-file class="size-3.5 text-muted" />
          <span class="truncate text-[11px] leading-[14px] text-surface">{{ folderName }}</span>
        </div>

        <p class="text-[11px] font-medium leading-[14px] text-muted">
          {{ dialogs.accessDialogSubtitle }}
        </p>

        <template v-if="loading && !loaded">
          <div class="flex h-24 items-center justify-center text-[11px] text-muted">…</div>
        </template>

        <template v-else>
          <button
            type="button"
            :disabled="!canOperate"
            class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md bg-[#383838] px-2.5 text-left disabled:cursor-default"
            data-test-id="access-opt-team"
            @click="mode = 'team'"
          >
            <span class="flex size-3.5 items-center justify-center rounded-full bg-accent">
              <span v-if="mode === 'team'" class="size-1.5 rounded-full bg-white" />
            </span>
            <icon-lucide-users class="size-3.5 text-surface" />
            <span class="truncate text-[11px] leading-[14px] text-surface">
              {{ dialogs.accessTeamOption }}
            </span>
          </button>

          <button
            type="button"
            :disabled="!canOperate"
            class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left hover:bg-hover disabled:cursor-default"
            data-test-id="access-opt-collab"
            @click="mode = 'collab'"
          >
            <span class="flex size-3.5 items-center justify-center rounded-full border border-muted bg-[#2A2A2A]">
              <span v-if="mode === 'collab'" class="size-1.5 rounded-full bg-accent" />
            </span>
            <icon-lucide-user-check class="size-3.5 text-muted" />
            <span class="truncate text-[11px] leading-[14px] text-muted">
              {{ dialogs.accessCollabOption }}
            </span>
          </button>

          <p v-if="mode === 'team'" class="text-[10px] text-muted">
            {{ dialogs['access.teamDesc'] }}
          </p>

          <div
            v-if="mode === 'collab'"
            class="flex flex-col gap-1 rounded-md bg-[#1E1E1E] p-2"
            data-test-id="access-collab-list"
          >
            <div
              v-for="row in rows"
              :key="row.id"
              class="flex h-8 items-center gap-2 rounded px-1"
              :data-test-id="`access-collab-row-${row.id}`"
            >
              <button
                type="button"
                :disabled="!canOperate"
                class="flex size-3.5 cursor-pointer items-center justify-center rounded-[3px] border border-muted disabled:cursor-default"
                :class="row.selected ? 'bg-accent border-accent' : 'bg-[#2A2A2A]'"
                :aria-label="row.name"
                data-test-id="access-collab-check"
                @click="toggleRow(row.id)"
              >
                <icon-lucide-check v-if="row.selected" class="size-2.5 text-white" />
              </button>
              <span
                class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] leading-[11px] text-white"
                :style="{ backgroundColor: row.avatar.bg }"
              >
                {{ row.avatar.char }}
              </span>
              <span class="min-w-0 flex-1 truncate text-[11px] leading-[14px] text-surface">
                {{ row.name }}
              </span>
              <AppSelect
                v-if="canOperate"
                :model-value="row.permission"
                :options="permissionOptions"
                :ui="{ trigger: 'h-6 min-w-0 text-[10px]' }"
                data-test-id="access-collab-perm"
                @update:model-value="(value: string) => changePermission(row.id, value)"
              />
              <span v-else class="text-[10px] text-muted">
                {{ dialogs[`access.${row.permission}`] }}
              </span>
            </div>
          </div>

          <p v-if="!canOperate" class="text-[10px] text-muted" data-test-id="access-readonly-notice">
            {{ dialogs['access.readOnly'] }}
          </p>
        </template>

        <div class="flex-1" />

        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="flex h-7 cursor-pointer items-center rounded border border-[#3A3A3A] px-3 text-[11px] leading-[14px] text-surface hover:bg-hover"
            data-test-id="access-cancel"
            @click="closeDialog"
          >
            {{ dialogs.cancel }}
          </button>
          <button
            v-if="canOperate"
            type="button"
            :disabled="saving || loading"
            class="flex h-7 cursor-pointer items-center justify-center rounded bg-accent px-3 text-[11px] font-medium leading-[14px] text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-test-id="access-save"
            @click="save"
          >
            {{ dialogs.save }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
