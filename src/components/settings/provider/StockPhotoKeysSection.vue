<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '@open-pencil/vue'

import { useAIChat } from '@/app/ai/chat/use'
import ProviderSettingsKeyField from '@/components/settings/provider/ProviderSettingsKeyField.vue'

const { dialogs } = useI18n()
const { pexelsKeyStatus, serverPexelsConfigured, setPexelsKey } = useAIChat()
const pexelsKeyInput = ref('')
const hasExistingPexelsKey = computed(() => pexelsKeyStatus.value === 'configured')

async function savePexelsKey(): Promise<void> {
  const value = pexelsKeyInput.value.trim()
  if (!value) return
  await setPexelsKey(value)
  pexelsKeyInput.value = ''
}

async function clearPexelsKey(): Promise<void> {
  await setPexelsKey('')
  pexelsKeyInput.value = ''
}
</script>

<template>
  <ProviderSettingsKeyField
    v-model="pexelsKeyInput"
    :label="dialogs.pexelsAPIKey"
    :saved="hasExistingPexelsKey"
    kind="pexels"
    :placeholder="hasExistingPexelsKey ? dialogs.keySavedReplace : dialogs.stockPhotoToolOptional"
    key-url="https://www.pexels.com/api/"
    :key-url-label="dialogs.getPexelsAPIKey"
    @clear="clearPexelsKey"
    @change="savePexelsKey"
  />
  <p v-if="serverPexelsConfigured && !hasExistingPexelsKey" class="text-xs text-muted-foreground mt-1">
    云端已配置（来自服务器）—— 本地可覆盖或清除
  </p>
</template>
