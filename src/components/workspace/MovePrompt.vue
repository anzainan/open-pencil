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

const {
  dirs,
  title,
  rootLabel,
  newFolderLabel,
  newFolderPlaceholder,
  moveLabel,
  cancelLabel
} = defineProps<{
  dirs: string[]
  title: string
  rootLabel: string
  newFolderLabel: string
  newFolderPlaceholder: string
  moveLabel: string
  cancelLabel: string
}>()

const emit = defineEmits<{
  confirm: [to: string]
}>()

const selected = ref<string | null>(null)
const newFolder = ref('')

watch(
  () => open.value,
  (isOpen) => {
    if (isOpen) {
      selected.value = null
      newFolder.value = ''
    }
  }
)

function submit() {
  const target = newFolder.value.trim() || selected.value
  if (!target) return
  emit('confirm', target)
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
    <AppDialogBody class="flex flex-col gap-2">
      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-surface hover:bg-hover"
        :class="selected === null ? 'bg-hover' : ''"
        @click="selected = null"
      >
        <icon-lucide-home class="size-3.5 text-muted" />
        <span class="flex-1 truncate">{{ rootLabel }}</span>
      </button>
      <div class="max-h-48 overflow-y-auto">
        <button
          v-for="dir in dirs"
          :key="dir"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-surface hover:bg-hover"
          :class="selected === dir ? 'bg-hover' : ''"
          @click="selected = dir"
        >
          <icon-lucide-folder class="size-3.5 text-muted" />
          <span class="flex-1 truncate">{{ dir }}</span>
        </button>
      </div>
      <div class="mt-1 flex items-center gap-2 border-t border-border pt-2">
        <AppInput
          :model-value="newFolder"
          :placeholder="newFolderPlaceholder"
          size="sm"
          class="min-w-0 flex-1"
          @update:model-value="newFolder = $event as string"
          @enter="onEnter"
        />
        <AppTextButton>{{ newFolderLabel }}</AppTextButton>
      </div>
    </AppDialogBody>
    <AppDialogFooter>
      <AppTextButton @click="open = false">{{ cancelLabel }}</AppTextButton>
      <button
        type="button"
        data-test-id="move-confirm"
        class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
        @click="submit"
      >
        {{ moveLabel }}
      </button>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
