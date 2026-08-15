<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import { useI18n } from '@open-pencil/vue'

import {
  activeStorageProviderID,
  BRIDGE_STORAGE_PROVIDER,
  createActiveStorageAdapter,
  readStoragePreferences,
  storageCredentialStatuses,
  storageProviderRegistry,
  writeStoragePreference
} from '@/app/integrations/storage'
import {
  buildCORSConfigurationJSON,
  collectCloudCORSOrigins
} from '@/app/integrations/storage/s3/cors'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialStatus } from '@/app/settings/credentials/types'
import { toast } from '@/app/shell/ui'
import { resumeStorageSync } from '@/app/storage/sync'
import AppInput from '@/components/ui/AppInput.vue'

const { dialogs } = useI18n()
const { copy, copied } = useClipboard()
const provider = computed(() => storageProviderRegistry.get(activeStorageProviderID.value))
const isBridgeWorkspace = computed(() => provider.value.id === BRIDGE_STORAGE_PROVIDER.id)
const preferenceDrafts = ref<Record<string, string>>({
  ...readStoragePreferences(provider.value.id)
})
const credentialDrafts = ref<Record<string, string>>({})
const credentialStatuses = ref<Record<string, CredentialStatus>>({})
const busy = ref(false)

function preferenceLabel(field: string): string {
  if (field === 'endpoint') return dialogs.value.storageEndpoint
  if (field === 'bucket') return dialogs.value.storageBucket
  if (field === 'region') return dialogs.value.storageRegion
  return field
}

function credentialLabel(field: string): string {
  if (field === 'access-key-id') return dialogs.value.storageAccessKeyID
  if (field === 'secret-access-key') return dialogs.value.storageSecretAccessKey
  return field
}

async function refreshStatuses(): Promise<void> {
  credentialStatuses.value = await storageCredentialStatuses(provider.value.id)
}

function savePreferences(): void {
  for (const field of provider.value.preferenceFields) {
    writeStoragePreference(provider.value.id, field.id, preferenceDrafts.value[field.id] ?? '')
  }
  void resumeStorageSync()
}

async function saveCredential(field: string): Promise<void> {
  const value = credentialDrafts.value[field]?.trim()
  if (!value) return
  await appCredentialServices.manager.set(credentialRef(provider.value.id, field), value)
  credentialDrafts.value[field] = ''
  await refreshStatuses()
  await resumeStorageSync()
}

async function clearCredential(field: string): Promise<void> {
  await appCredentialServices.manager.clear(credentialRef(provider.value.id, field))
  credentialDrafts.value[field] = ''
  await refreshStatuses()
}

function switchToWorkspace(): void {
  activeStorageProviderID.value = BRIDGE_STORAGE_PROVIDER.id
}

function copyCORSConfiguration(): void {
  void copy(buildCORSConfigurationJSON(collectCloudCORSOrigins()))
}

async function testConnection(): Promise<void> {
  busy.value = true
  try {
    savePreferences()
    for (const field of provider.value.credentialFields) {
      await saveCredential(field.id)
    }
    await resumeStorageSync()
    const connection = await createActiveStorageAdapter(provider.value.id).testConnection()
    if (connection.ok) toast.info(connection.message)
    else toast.error(connection.message)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    busy.value = false
  }
}

watch(activeStorageProviderID, (providerID) => {
  preferenceDrafts.value = { ...readStoragePreferences(providerID) }
  credentialDrafts.value = {}
  void refreshStatuses()
})

onMounted(() => void refreshStatuses())
</script>

<template>
  <section class="flex flex-col gap-3" data-test-id="settings-storage-panel">
    <div>
      <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsStorage }}</h3>
      <p class="mt-0.5 text-[10px] text-muted">{{ provider.description }}</p>
    </div>

    <template v-if="isBridgeWorkspace">
      <div
        class="flex items-start gap-2 rounded-lg border border-border bg-panel p-3"
        data-test-id="settings-storage-workspace-managed"
      >
        <icon-lucide-hard-drive class="mt-0.5 size-4 shrink-0 text-success" />
        <div>
          <p class="text-[11px] font-medium text-surface">数据已在云端储存</p>
          <p class="mt-1 text-[10px] leading-relaxed text-muted">文件自动保存</p>
        </div>
      </div>
    </template>

    <template v-else>
      <div
        class="flex items-start gap-2 rounded-lg border border-border bg-panel p-3"
        data-test-id="settings-storage-s3-legacy"
      >
        <icon-lucide-cloud class="mt-0.5 size-4 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium text-surface">S3 存储已由本地工作区接管</p>
          <p class="mt-1 text-[10px] leading-relaxed text-muted">
            当前版本使用 file-bridge 连接本地工作区，S3 配置已不适用。
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded border border-border px-2 py-1 text-[10px] font-medium text-surface hover:bg-hover"
          @click="switchToWorkspace"
        >
          切换到本地工作区
        </button>
      </div>
    </template>

    <template v-if="!isBridgeWorkspace">
      <label
        v-for="field in provider.preferenceFields"
        :key="field.id"
        class="flex flex-col gap-1 text-[10px] text-muted"
      >
        {{ preferenceLabel(field.id) }}
        <AppInput
          v-model="preferenceDrafts[field.id]"
          :placeholder="field.placeholder"
          size="sm"
          tone="panel"
          @change="savePreferences"
        />
      </label>

      <div
        v-for="field in provider.credentialFields"
        :key="field.id"
        class="flex flex-col gap-1"
        :data-credential="field.id"
      >
        <label :for="`storage-${field.id}`" class="text-[10px] text-muted">
          {{ credentialLabel(field.id) }}
        </label>
        <div class="flex gap-2">
          <AppInput
            :id="`storage-${field.id}`"
            v-model="credentialDrafts[field.id]"
            type="password"
            :aria-label="credentialLabel(field.id)"
            :placeholder="
              credentialStatuses[field.id] === 'configured'
                ? dialogs.keySavedReplace
                : field.placeholder
            "
            size="sm"
            tone="panel"
            class="min-w-0 flex-1"
            @enter="saveCredential(field.id)"
          />
          <button
            v-if="credentialDrafts[field.id]?.trim()"
            type="button"
            class="rounded bg-hover px-2 text-[10px] text-surface hover:bg-active"
            @click="saveCredential(field.id)"
          >
            {{ dialogs.save }}
          </button>
          <button
            v-else-if="credentialStatuses[field.id] === 'configured'"
            type="button"
            class="rounded px-2 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="clearCredential(field.id)"
          >
            {{ dialogs.clear }}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="mt-1 rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        :disabled="busy"
        data-test-id="settings-storage-test"
        @click="testConnection"
      >
        {{ dialogs.testConnection }}
      </button>

      <button
        v-if="provider.id === 's3-compatible'"
        type="button"
        class="rounded px-3 py-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="copyCORSConfiguration"
      >
        {{ copied ? dialogs.copied : dialogs.copyStorageCors }}
      </button>
    </template>
  </section>
</template>
