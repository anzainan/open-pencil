<script setup lang="ts">
import { computed } from 'vue'
import { twMerge } from 'tailwind-merge'
interface AppTextButtonProps {
  ui?: {
    base?: string
  }
  size?: 'xs' | 'sm'
  underline?: boolean
  disabled?: boolean
}

const { ui, size = 'sm', underline = false, disabled = false } = defineProps<AppTextButtonProps>()

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const cls = computed(() =>
  twMerge(
    'cursor-pointer text-muted hover:text-surface',
    size === 'xs' ? 'text-[9px]' : 'text-[10px]',
    underline && 'underline',
    disabled && 'cursor-not-allowed opacity-50 hover:text-muted',
    ui?.base
  )
)
</script>

<template>
  <button type="button" :disabled="disabled" :class="cls" @click="emit('click', $event)">
    <slot />
  </button>
</template>
