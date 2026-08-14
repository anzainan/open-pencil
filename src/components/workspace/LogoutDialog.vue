<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { useI18n } from '@open-pencil/vue'

import { logout } from '@/app/auth/session'
import { closeLogoutDialog, logoutDialogOpen } from '@/app/auth/logout-dialog'

defineOptions({ name: 'LogoutDialog' })

const { dialogs } = useI18n()
const router = useRouter()
const confirming = ref(false)

async function confirmLogout(): Promise<void> {
  if (confirming.value) return
  confirming.value = true
  try {
    await logout()
    closeLogoutDialog()
    await router.push('/login')
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <DialogRoot v-model:open="logoutDialogOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex h-[200px] w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] p-5 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
        data-test-id="logout-dialog"
      >
        <div class="flex items-center justify-between">
          <span class="text-[13px] font-medium text-surface" data-test-id="logout-title">
            {{ dialogs['logout.title'] }}
          </span>
          <button
            type="button"
            class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            :aria-label="dialogs['logout.cancel']"
            data-test-id="logout-close"
            @click="closeLogoutDialog"
          >
            <icon-lucide-x class="size-3.5" />
          </button>
        </div>

        <div class="mt-1 h-px w-full bg-[#3A3A3A]" />

        <p class="mt-4 text-[11px] leading-[18px] text-muted" data-test-id="logout-desc">
          {{ dialogs['logout.desc'] }}
        </p>

        <div class="mt-auto flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-9 cursor-pointer rounded-md border border-[#3A3A3A] px-4 text-[12px] text-surface hover:bg-hover"
            data-test-id="logout-cancel"
            @click="closeLogoutDialog"
          >
            {{ dialogs['logout.cancel'] }}
          </button>
          <button
            type="button"
            class="h-9 cursor-pointer rounded-md bg-[#EF4444] px-4 text-[12px] font-medium text-white hover:bg-[#EF4444]/90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="confirming"
            data-test-id="logout-confirm"
            @click="confirmLogout"
          >
            {{ dialogs['logout.confirm'] }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
