<script setup lang="ts">
import { computed } from 'vue'
import { useEditorCommands } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import BooleanOperationsControl from '@/components/properties/BooleanOperationsControl.vue'
import IconButton from '@/components/ui/IconButton.vue'

const { showBooleanOperations = false } = defineProps<{
  showBooleanOperations?: boolean
}>()

const store = useEditorStore()
const readOnly = computed(() => store.state.readOnly)
const { getCommand, runCommand } = useEditorCommands()
const maskCommand = getCommand('selection.toggleMask')
</script>

<template>
  <div class="ml-auto flex items-center gap-1">
    <IconButton
      :label="maskCommand.label"
      :disabled="!maskCommand.enabled.value || readOnly"
      data-test-id="selection-toggle-mask"
      @click="runCommand('selection.toggleMask')"
    >
      <icon-lucide-shapes class="size-3.5" />
    </IconButton>
    <BooleanOperationsControl v-if="showBooleanOperations" :disabled="readOnly" />
  </div>
</template>
