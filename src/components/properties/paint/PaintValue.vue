<script setup lang="ts">
import { computed } from 'vue'

import { colorToHex8 } from '@open-pencil/core/color'
import { inputValue, useColorModel } from '@open-pencil/vue'

import { BindingPill } from '@/components/ui/binding'

import type { Color } from '@open-pencil/scene-graph/primitives'

const { color, resolvedColor, variableName, label } = defineProps<{
  color: Color
  resolvedColor?: Color
  variableName?: string
  label: string
}>()
const emit = defineEmits<{ update: [color: Color] }>()

const displayColor = computed(() => resolvedColor ?? color)
const model = useColorModel({
  color: displayColor,
  onUpdate: (updated) => emit('update', updated)
})
// [custom] alpha-fix: show color.a in the main row as an 8-digit hex so alpha is visible alongside
// the paint opacity field (opaque colors stay 6-digit).
const hexValue = computed(() =>
  displayColor.value.a < 1 ? colorToHex8(displayColor.value).slice(1) : model.hex.value
)
const hexMaxLength = computed(() => (displayColor.value.a < 1 ? 8 : 6))
const tooltip = computed(() => (variableName ? `${variableName} · #${model.hex.value}` : undefined))
</script>

<template>
  <BindingPill
    v-if="variableName"
    class="min-w-0 flex-1"
    :label="variableName"
    :tooltip="tooltip"
  />
  <input
    v-else
    :aria-label="label"
    data-property="color-hex"
    class="min-w-0 flex-1 border-none bg-transparent font-mono text-xs text-surface outline-none"
    :value="hexValue"
    :maxlength="hexMaxLength"
    @change="model.updateHex(inputValue($event))"
  />
</template>
