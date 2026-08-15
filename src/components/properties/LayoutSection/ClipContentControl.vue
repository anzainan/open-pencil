<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, useLayoutControlsContext } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'

const ctx = useLayoutControlsContext()
const store = useEditorStore()
const readOnly = computed(() => store.state.readOnly)

const { panels } = useI18n()
</script>

<template>
  <label class="mt-2 flex cursor-pointer items-center gap-2 text-xs text-surface">
    <input
      type="checkbox"
      data-test-id="clip-content-checkbox"
      :disabled="readOnly"
      class="accent-accent disabled:cursor-not-allowed disabled:opacity-50"
      :checked="ctx.node.clipsContent"
      @change="
        ctx.editor.updateNodeWithUndo(
          ctx.node.id,
          { clipsContent: !ctx.node.clipsContent },
          'Toggle clip content'
        )
      "
    />
    {{ panels.clipContent }}
  </label>
</template>
