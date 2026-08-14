<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { bridgeClient } from '@/app/bridge/client'
import { useEditorStore } from '@/app/editor/active-store'
import { closePermissionRequest, permissionRequestOpen } from '@/app/editor/readonly'
import { toast } from '@/app/shell/ui'
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot
} from '@/components/ui/dialog'

defineOptions({ name: 'PermissionRequestDialog' })

const store = useEditorStore()
const { dialogs } = useI18n()
const submitting = ref(false)

const documentPath = computed(() => store.getStorageBinding()?.documentId ?? '')

async function requestPermission(): Promise<void> {
  if (submitting.value || !documentPath.value) return
  submitting.value = true
  try {
    await bridgeClient.requestPermission(documentPath.value)
    toast.info(dialogs.value['perm.requestSent'])
    closePermissionRequest()
  } catch (error) {
    console.warn('[permission-request] failed', error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AppDialogRoot v-model:open="permissionRequestOpen" size="sm">
    <AppDialogHeader :heading="dialogs['perm.requestTitle']" :close-label="dialogs.close" />
    <AppDialogBody>
      <p class="text-sm text-surface">{{ dialogs['perm.requestDesc'] }}</p>
    </AppDialogBody>
    <AppDialogFooter>
      <button
        type="button"
        class="h-8 cursor-pointer rounded px-3 text-xs font-medium text-surface hover:bg-hover"
        @click="closePermissionRequest"
      >
        {{ dialogs.cancel }}
      </button>
      <button
        type="button"
        :disabled="submitting || !documentPath"
        class="h-8 cursor-pointer rounded bg-accent px-3 text-xs font-medium text-white disabled:cursor-default disabled:opacity-40"
        @click="requestPermission"
      >
        {{ submitting ? '…' : dialogs['perm.requestConfirm'] }}
      </button>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
