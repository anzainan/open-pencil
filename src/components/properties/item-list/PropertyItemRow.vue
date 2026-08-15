<script setup lang="ts" generic="K extends PropertyListKey">
import { PropertyListItem, PropertyListRemove, PropertyListVisibility } from '@open-pencil/vue'

import PanelItemRow from '@/components/ui/panel/PanelItemRow.vue'
import Tip from '@/components/ui/Tip.vue'

import type { PropertyListItemSlotProps, PropertyListKey } from '@open-pencil/vue'
import type { ClassValue } from 'tailwind-variants'
import type { VNode } from 'vue'

const {
  propKey,
  index,
  visibilityLabel,
  removeLabel,
  showVisibility = true,
  disabled = false,
  class: className
} = defineProps<{
  propKey: K
  index: number
  visibilityLabel: string
  removeLabel: string
  showVisibility?: boolean
  disabled?: boolean
  class?: ClassValue
}>()

const emit = defineEmits<{
  remove: [index: number]
  toggleVisibility: [index: number]
}>()

defineSlots<{
  default(props: PropertyListItemSlotProps<K>): VNode[]
  rail?(props: PropertyListItemSlotProps<K>): VNode[]
  details?(props: PropertyListItemSlotProps<K>): VNode[]
}>()
</script>

<template>
  <PropertyListItem
    v-slot="item"
    :prop-key="propKey"
    :index="index"
    :class="className"
    :data-property="propKey"
    :data-index="index"
    :disabled="disabled"
    as-child
  >
    <PanelItemRow>
      <slot v-bind="item" />
      <template v-if="$slots.details" #details>
        <slot name="details" v-bind="item" />
      </template>
      <template #rail="{ removeClass }">
        <slot name="rail" v-bind="item" />
        <Tip v-if="showVisibility" :label="visibilityLabel">
          <PropertyListVisibility
            :prop-key="propKey"
            :index="index"
            :aria-label="visibilityLabel"
            :disabled="disabled"
            class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
            @toggle="emit('toggleVisibility', $event)"
          >
            <icon-lucide-eye v-if="!item.hidden" class="size-3.5" />
            <icon-lucide-eye-off v-else class="size-3.5" />
          </PropertyListVisibility>
        </Tip>
        <Tip :label="removeLabel">
          <PropertyListRemove
            :prop-key="propKey"
            :index="index"
            :aria-label="removeLabel"
            :disabled="disabled"
            :class="[
              removeClass,
              'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40'
            ]"
            @remove="emit('remove', $event)"
          >
            <icon-lucide-minus class="size-3.5" />
          </PropertyListRemove>
        </Tip>
      </template>
    </PanelItemRow>
  </PropertyListItem>
</template>
