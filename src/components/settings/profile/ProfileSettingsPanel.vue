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

const roleWorkspaceLabel = computed(() =>
  dialogs.value['profile.roleAndWorkspace']({ role: roleLabel.value })
)

const avatarBg = computed(() => currentUser.value?.avatar.bg ?? '#3B82F6')
const avatarChar = computed(() => currentUser.value?.avatar.char ?? '?')
const accountName = computed(() => currentUser.value?.name ?? '')
const email = computed(() => currentUser.value?.email ?? dialogs.value['profile.emailPlaceholder'])
</script>

<template>
  <section class="flex flex-col gap-4" data-test-id="settings-profile-panel">
    <!-- SecTitle（设计稿 §3.1） -->
    <div>
      <h3 class="text-base font-semibold text-surface">{{ dialogs.settingsProfile }}</h3>
      <p class="mt-0.5 text-xs text-muted">{{ dialogs['profile.manageDescription'] }}</p>
    </div>

    <!-- ProfileCard（设计稿 §3.1） -->
    <div class="flex items-center gap-4 rounded-lg border border-border bg-panel p-3" data-test-id="profile-card">
      <span
        class="flex size-16 shrink-0 items-center justify-center rounded-full text-2xl font-semibold text-white"
        :style="{ backgroundColor: avatarBg }"
        data-test-id="profile-avatar"
      >
        {{ avatarChar }}
      </span>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-surface" data-test-id="profile-name">
          {{ accountName }}
        </p>
        <p class="mt-0.5 truncate text-[11px] text-muted" data-test-id="profile-role">
          {{ roleWorkspaceLabel }}
        </p>
      </div>
      <button
        type="button"
        class="ml-auto h-7 shrink-0 cursor-pointer rounded border border-border px-2.5 text-[11px] text-surface hover:bg-hover"
        data-test-id="profile-change-avatar"
      >
        {{ dialogs['profile.changeAvatar'] }}
      </button>
    </div>

    <!-- Fields（设计稿 §3.1） -->
    <div class="flex flex-col gap-2.5">
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] text-muted">{{ dialogs['profile.accountName'] }}</span>
        <input
          :value="accountName"
          type="text"
          readonly
          class="h-8 rounded bg-panel-field px-2.5 text-xs text-surface outline-none placeholder:text-muted"
          data-test-id="profile-name-input"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] text-muted">{{ dialogs['profile.email'] }}</span>
        <input
          :value="email"
          type="text"
          readonly
          class="h-8 rounded bg-panel-field px-2.5 text-xs text-muted outline-none placeholder:text-muted"
          data-test-id="profile-email-input"
        />
      </label>
    </div>

    <!-- BtnRow（设计稿 §3.1：红色描边+红字「退出登录」） -->
    <div class="mt-auto flex justify-end">
      <button
        type="button"
        class="h-8 cursor-pointer rounded border border-[#EF4444] px-3.5 text-xs font-medium text-[#EF4444] hover:bg-red-600/10"
        data-test-id="profile-logout"
        @click="openLogoutDialog"
      >
        {{ dialogs['profile.logout'] }}
      </button>
    </div>
  </section>
</template>
