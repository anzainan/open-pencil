<script setup lang="ts">
import { ref, watch } from 'vue'

import { MIXED, type MixedValue } from '@open-pencil/vue'

import AppInput from '@/components/ui/AppInput.vue'

const { value, label, disabled = false } = defineProps<{
  value: MixedValue<string>
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ commit: [value: string] }>()
const draft = ref('')

watch(
  () => value,
  (next) => {
    draft.value = next === MIXED ? '' : next
  },
  { immediate: true }
)
</script>

<template>
  <AppInput
    v-model="draft"
    tone="panel"
    size="sm"
    :state="value === MIXED ? 'mixed' : 'idle'"
    :placeholder="value === MIXED ? '—' : undefined"
    :aria-label="label"
    :disabled="disabled"
    @change="emit('commit', draft)"
  />
</template>
