<script setup lang="ts">
import { ref, watch } from 'vue'

import AppInput from '@/components/ui/AppInput.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot
} from '@/components/ui/dialog'

const open = defineModel<boolean>('open', { default: false })

const { title, description, placeholder, confirmLabel, cancelLabel } = defineProps<{
  title: string
  description: string
  placeholder: string
  confirmLabel: string
  cancelLabel: string
}>()

const emit = defineEmits<{
  confirm: [name: string]
}>()

const value = ref('')

watch(
  () => open.value,
  (isOpen) => {
    if (isOpen) value.value = ''
  }
)

function submit() {
  if (!value.value.trim()) return
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
    <AppDialogHeader :heading="title" :description="description" :show-close="false" />
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
        data-test-id="new-project-confirm"
        class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
        @click="submit"
      >
        {{ confirmLabel }}
      </button>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
