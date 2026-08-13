<script setup lang="ts">
import { ref, watch } from 'vue'

import AppInput from '@/components/ui/AppInput.vue'
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot
} from '@/components/ui/dialog'
import AppTextButton from '@/components/ui/AppTextButton.vue'

const open = defineModel<boolean>('open', { default: false })

const { currentName, title, placeholder, confirmLabel, cancelLabel } = defineProps<{
  currentName: string
  title: string
  placeholder: string
  confirmLabel: string
  cancelLabel: string
}>()

const emit = defineEmits<{
  confirm: [name: string]
}>()

const value = ref(currentName)

watch(
  () => open.value,
  (isOpen) => {
    if (isOpen) value.value = currentName
  }
)

function submit() {
  emit('confirm', value.value.trim())
  open.value = false
}

function onEnter(event: KeyboardEvent) {
  event.preventDefault()
  submit()
}
</script>

<template>
  <AppDialogRoot v-model:open="open" size="sm">
    <AppDialogHeader :heading="title" :show-close="false" />
    <AppDialogBody>
      <AppInput
        :model-value="value"
        :placeholder="placeholder"
        autofocus
        @update:model-value="value = $event as string"
        @enter="onEnter"
      />
    </AppDialogBody>
    <AppDialogFooter>
      <AppTextButton @click="open = false">{{ cancelLabel }}</AppTextButton>
      <button
        type="button"
        data-test-id="rename-confirm"
        class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
        @click="submit"
      >
        {{ confirmLabel }}
      </button>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
