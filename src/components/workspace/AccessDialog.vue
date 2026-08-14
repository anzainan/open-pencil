<script setup lang="ts">
import { ref } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

const open = defineModel<boolean>('open', { default: false })

const { folderName } = defineProps<{
  folderName: string
}>()

const { dialogs } = useI18n()

/** 纯前端 UI：无登录/成员体系，交互状态组件内管理，保存/取消关闭弹窗。 */
type AccessMode = 'team' | 'collab'

const mode = ref<AccessMode>('team')
const selectedCollabs = ref<string[]>([])

const COLLABS = [
  { name: '小田', avatarChar: '田', avatarBg: '#3B82F6' },
  { name: 'Rain', avatarChar: 'R', avatarBg: '#9747FF' },
  { name: '火花子', avatarChar: '火', avatarBg: '#F59E0B' }
] as const

function toggleCollab(name: string): void {
  if (selectedCollabs.value.includes(name)) {
    selectedCollabs.value = selectedCollabs.value.filter((candidate) => candidate !== name)
  } else {
    selectedCollabs.value = [...selectedCollabs.value, name]
  }
}

function closeDialog(): void {
  open.value = false
}
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

        <button
          type="button"
          class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md bg-[#383838] px-2.5 text-left"
          data-test-id="access-opt-team"
          @click="mode = 'team'"
        >
          <span class="flex size-3.5 items-center justify-center rounded-full bg-accent">
            <span class="size-1.5 rounded-full bg-white" />
          </span>
          <icon-lucide-users class="size-3.5 text-surface" />
          <span class="truncate text-[11px] leading-[14px] text-surface">
            {{ dialogs.accessTeamOption }}
          </span>
        </button>

        <button
          type="button"
          class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left hover:bg-hover"
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

        <div
          v-if="mode === 'collab'"
          class="flex flex-col gap-1 rounded-md bg-[#1E1E1E] p-2"
          data-test-id="access-collab-list"
        >
          <button
            v-for="collab in COLLABS"
            :key="collab.name"
            type="button"
            class="flex h-6 w-full cursor-pointer items-center gap-2 rounded px-1 text-left hover:bg-hover"
            data-test-id="access-collab-row"
            @click="toggleCollab(collab.name)"
          >
            <span
              class="flex size-3.5 items-center justify-center rounded-[3px] border border-muted bg-[#2A2A2A]"
            >
              <icon-lucide-check
                v-if="selectedCollabs.includes(collab.name)"
                class="size-2.5 text-accent"
              />
            </span>
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] leading-[11px] text-white"
              :style="{ backgroundColor: collab.avatarBg }"
            >
              {{ collab.avatarChar }}
            </span>
            <span class="truncate text-[11px] leading-[14px] text-surface">{{ collab.name }}</span>
          </button>
        </div>

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
            type="button"
            class="flex h-7 cursor-pointer items-center justify-center rounded bg-accent px-3 text-[11px] font-medium leading-[14px] text-white hover:bg-accent/90"
            data-test-id="access-save"
            @click="closeDialog"
          >
            {{ dialogs.save }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
