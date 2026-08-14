<script setup lang="ts">
import { onMounted } from 'vue'
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'

import { provideEditor, useI18n } from '@open-pencil/vue'
import { restoreSession } from '@/app/auth/session'
import AppShell from '@/components/Shell/AppShell.vue'
import AppToast from '@/components/Shell/AppToast.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import LogoutDialog from '@/components/workspace/LogoutDialog.vue'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import { useAppTheme } from '@/app/shell/theme'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'
import { kickSyncEngine } from '@/app/storage/sync'

const store = useEditorStore()
const { dialogs, locale } = useI18n()

useHead({
  titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil'),
  htmlAttrs: { lang: locale }
})

provideEditor(store)
useAppTheme()

onMounted(() => {
  // 启动恢复登录态（记住登录 → GET /auth/session；未登录访问 /login 停留）。
  void restoreSession()
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(dialogs)
  void kickSyncEngine()
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <AppShell>
      <RouterView />
    </AppShell>
    <SettingsDialog />
    <LogoutDialog />
    <AppToast />
  </TooltipProvider>
</template>
