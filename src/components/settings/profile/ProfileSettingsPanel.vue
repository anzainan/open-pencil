<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useCurrentUser } from '@/app/auth/session'
import { openLogoutDialog } from '@/app/auth/logout-dialog'

defineOptions({ name: 'ProfileSettingsPanel' })

const { dialogs } = useI18n()
const currentUser = useCurrentUser()

const roleLabel = computed(() => {
  const role = currentUser.value?.role
  if (role === 'owner') return dialogs.value['role.owner']
  if (role === 'admin') return dialogs.value['role.admin']
  if (role === 'member') return dialogs.value['role.member']
  return ''
})
</script>

<template>
  <section class="flex flex-col gap-4" data-test-id="settings-profile-panel">
    <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsProfile }}</h3>

    <div class="flex items-center gap-3">
      <span
        class="flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
        :style="{ backgroundColor: currentUser?.avatar.bg ?? '#3B82F6' }"
        data-test-id="profile-avatar"
      >
        {{ currentUser?.avatar.char ?? '?' }}
      </span>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-surface" data-test-id="profile-name">
          {{ currentUser?.name ?? '…' }}
        </p>
        <p class="truncate text-[11px] text-muted" data-test-id="profile-email">
          {{ currentUser?.email || '—' }}
        </p>
      </div>
      <span
        class="ml-auto shrink-0 rounded border border-border px-2 py-0.5 text-[10px] text-muted"
        data-test-id="profile-role"
      >
        {{ roleLabel }}
      </span>
    </div>

    <div class="grid grid-cols-1 gap-2 text-[11px]">
      <div class="flex items-center justify-between rounded-md bg-hover px-2.5 py-2">
        <span class="text-muted">{{ dialogs['profile.accountName'] }}</span>
        <span class="font-medium text-surface">{{ currentUser?.name ?? '…' }}</span>
      </div>
      <div class="flex items-center justify-between rounded-md bg-hover px-2.5 py-2">
        <span class="text-muted">{{ dialogs['profile.email'] }}</span>
        <span class="font-medium text-surface">{{ currentUser?.email || '—' }}</span>
      </div>
    </div>

    <button
      type="button"
      class="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-red-600/50 text-[11px] font-medium text-red-500 hover:bg-red-600/10"
      data-test-id="profile-logout"
      @click="openLogoutDialog"
    >
      <icon-lucide-log-out class="size-3.5" />
      {{ dialogs['profile.logout'] }}
    </button>
  </section>
</template>
