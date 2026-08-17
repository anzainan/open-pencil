<script setup lang="ts">
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { computed, ref } from 'vue'
import { useI18n } from '@open-pencil/vue'
import { IS_TAURI } from '@open-pencil/core/constants'

import { useAIChat } from '@/app/ai/chat/use'
import { appCredentialServices } from '@/app/settings/credentials/app'
import {
  settingsDialogOpen,
  settingsDialogSection,
  settingsDirty
} from '@/app/settings/dialog'
import { commitPendingMembers, discardPendingMembers, ensureLoad } from '@/app/settings/team-store'
import { toast } from '@/app/shell/ui'
import ProfileSettingsPanel from '@/components/settings/profile/ProfileSettingsPanel.vue'
import StockPhotoKeysSection from '@/components/settings/provider/StockPhotoKeysSection.vue'
import StorageSettingsPanel from '@/components/settings/storage/StorageSettingsPanel.vue'
import TeamSettingsPanel from '@/components/settings/team/TeamSettingsPanel.vue'
import VectorizeSettingsSection from '@/components/settings/vectorize/VectorizeSettingsSection.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { AppDialogFooter, AppDialogHeader, AppDialogRoot } from '@/components/ui/dialog'

const { dialogs } = useI18n()
const { browserCredentialsRemembered, setRememberCredentials } = useAIChat()

const unsavedDialogOpen = ref(false)
const saving = ref(false)

function onOpenChange(open: boolean): void {
  if (open) {
    settingsDialogOpen.value = true
    // 打开即刷新团队成员（跨会话成员可能变化）；ensureLoad 与面板挂载共享单飞（只发一次 GET）；
    // 失败静默（面板挂载兜底，store 失败不清空现值 + 错误标记可点击重试）。
    void ensureLoad().catch(() => undefined)
    return
  }
  // 关闭时若有未保存更改 → 弹 UnsavedDialog 拦截，不直接关。
  if (settingsDirty.value) {
    unsavedDialogOpen.value = true
    return
  }
  settingsDialogOpen.value = false
}

async function saveSettings(): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    const count = await commitPendingMembers()
    toast.saved(count > 0 ? dialogs.value['team.saved'] : dialogs.value['settingsSaved'])
  } catch (error) {
    console.warn('[settings] save failed', error)
    toast.error(dialogs.value['team.saveFailed'])
  } finally {
    saving.value = false
  }
}

function discardAndClose(): void {
  discardPendingMembers()
  unsavedDialogOpen.value = false
  settingsDialogOpen.value = false
}

function cancelUnsaved(): void {
  unsavedDialogOpen.value = false
}

async function saveAndLeave(): Promise<void> {
  await saveSettings()
  if (!settingsDirty.value) {
    unsavedDialogOpen.value = false
    settingsDialogOpen.value = false
  }
}

const rememberCredentials = computed({
  get: () => browserCredentialsRemembered.value,
  set: (remembered: boolean) => {
    void setRememberCredentials(remembered)
  }
})

const credentialBackendLabel = computed(() => {
  void browserCredentialsRemembered.value
  if (appCredentialServices.manager.backend === 'native')
    return dialogs.value.credentialBackendNative
  if (appCredentialServices.manager.backend === 'browser') {
    return dialogs.value.credentialBackendBrowser
  }
  return dialogs.value.credentialBackendMemory
})

const navigationClass =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-muted transition-colors hover:bg-hover hover:text-surface data-[state=active]:bg-accent data-[state=active]:text-white'
</script>

<template>
  <AppDialogRoot
    :open="settingsDialogOpen"
    size="lg"
    height="tall"
    :ui="{ content: 'h-[540px]' }"
    data-test-id="app-settings-dialog"
    @update:open="onOpenChange"
  >
    <AppDialogHeader
      :heading="dialogs.settings"
      :description="dialogs.settingsDescription"
      :close-label="dialogs.close"
      :ui="{ title: 'text-base' }"
    />

    <div class="flex min-h-0 flex-1">
      <nav
        class="flex w-40 shrink-0 flex-col gap-1 border-r border-border p-2"
        :aria-label="dialogs.settings"
      >
        <button
          type="button"
          :class="navigationClass"
          :data-state="settingsDialogSection === 'profile' ? 'active' : 'inactive'"
          data-test-id="settings-section-profile"
          @click="settingsDialogSection = 'profile'"
        >
          <icon-lucide-user class="size-3.5" />
          {{ dialogs.settingsProfile }}
        </button>
        <button
          type="button"
          :class="navigationClass"
          :data-state="settingsDialogSection === 'team' ? 'active' : 'inactive'"
          data-test-id="settings-section-team"
          @click="settingsDialogSection = 'team'"
        >
          <icon-lucide-users class="size-3.5" />
          {{ dialogs.settingsTeam }}
        </button>
        <button
          type="button"
          :class="navigationClass"
          :data-state="settingsDialogSection === 'media' ? 'active' : 'inactive'"
          data-test-id="settings-section-media"
          @click="settingsDialogSection = 'media'"
        >
          <icon-lucide-image class="size-3.5" />
          {{ dialogs.settingsMedia }}
        </button>
        <button
          type="button"
          :class="navigationClass"
          :data-state="settingsDialogSection === 'storage' ? 'active' : 'inactive'"
          data-test-id="settings-section-storage"
          @click="settingsDialogSection = 'storage'"
        >
          <icon-lucide-cloud class="size-3.5" />
          {{ dialogs.settingsStorage }}
        </button>
      </nav>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <ProfileSettingsPanel v-if="settingsDialogSection === 'profile'" />
        <TeamSettingsPanel v-else-if="settingsDialogSection === 'team'" />
        <section
          v-else-if="settingsDialogSection === 'media'"
          class="flex flex-col gap-2.5"
          data-test-id="settings-media-panel"
        >
          <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsMedia }}</h3>
          <StockPhotoKeysSection />
          <VectorizeSettingsSection />
        </section>

        <StorageSettingsPanel v-else />
      </div>
    </div>

    <AppDialogFooter :ui="{ footer: 'justify-between' }">
      <div class="mr-auto flex items-center gap-2">
        <AppSwitch
          v-if="!IS_TAURI"
          v-model="rememberCredentials"
          :label="dialogs.rememberCredentials"
          data-test-id="settings-remember-credentials"
        />
        <div>
          <p v-if="!IS_TAURI" class="text-[11px] text-surface">
            {{ dialogs.rememberCredentials }}
          </p>
          <p class="text-[10px] text-muted" data-test-id="settings-credential-backend">
            {{ dialogs.credentialStorage({ backend: credentialBackendLabel }) }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="settingsDirty"
          type="button"
          :disabled="saving"
          class="flex h-7 cursor-pointer items-center rounded-md bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          data-test-id="settings-save"
          @click="saveSettings"
        >
          {{ dialogs.saveChanges }}
        </button>
        <DialogClose as-child>
          <button
            type="button"
            class="rounded border border-border px-3 py-1.5 text-[11px] font-medium text-surface hover:bg-hover"
            data-test-id="app-settings-done"
          >
            {{ dialogs.done }}
          </button>
        </DialogClose>
      </div>
    </AppDialogFooter>
  </AppDialogRoot>

  <!-- 未保存更改提示（设计稿 §6.1 UnsavedDialog 360×200） -->
  <DialogRoot v-model:open="unsavedDialogOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/50" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex h-[200px] w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] p-5 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
        data-test-id="unsaved-dialog"
      >
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-2">
            <icon-lucide-alert-triangle class="size-4 text-muted" />
            <span class="text-sm font-medium text-surface">{{ dialogs['unsaved.title'] }}</span>
          </span>
          <button
            type="button"
            class="flex size-6 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            :aria-label="dialogs.close"
            data-test-id="unsaved-close"
            @click="cancelUnsaved"
          >
            <icon-lucide-x class="size-3.5" />
          </button>
        </div>
        <div class="mt-3 h-px w-full bg-[#3A3A3A]" />
        <p class="mt-4 text-xs leading-[18px] text-surface" data-test-id="unsaved-desc">
          {{ dialogs['unsaved.desc'] }}
        </p>
        <p class="mt-1 text-[11px] leading-[16px] text-muted">{{ dialogs['unsaved.subDesc'] }}</p>
        <div class="mt-auto flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-7 cursor-pointer rounded-md border border-[#3A3A3A] px-3 text-[11px] text-surface hover:bg-hover"
            data-test-id="unsaved-discard"
            @click="discardAndClose"
          >
            {{ dialogs['unsaved.discard'] }}
          </button>
          <button
            type="button"
            class="h-7 cursor-pointer rounded-md border border-[#3A3A3A] px-3 text-[11px] text-surface hover:bg-hover"
            data-test-id="unsaved-cancel"
            @click="cancelUnsaved"
          >
            {{ dialogs['unsaved.cancel'] }}
          </button>
          <button
            type="button"
            :disabled="saving"
            class="h-7 cursor-pointer rounded-md bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-test-id="unsaved-save-leave"
            @click="saveAndLeave"
          >
            {{ dialogs['unsaved.saveLeave'] }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
