<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { ref, watch } from 'vue'

import type { ContextMenuPosition } from './context-menu'

const {
  position,
  renameLabel,
  moveLabel,
  trashLabel,
  showMove = true
} = defineProps<{
  position: ContextMenuPosition | null
  renameLabel: string
  moveLabel: string
  trashLabel: string
  /** 是否显示「移动」项。文件夹禁止移动（防嵌套/消失），仅文件显示。 */
  showMove?: boolean
}>()

const emit = defineEmits<{
  rename: []
  move: []
  trash: []
  close: []
}>()

const root = ref<HTMLElement | null>(null)

watch(
  () => position,
  (pos) => {
    if (pos) root.value?.focus()
  }
)

onClickOutside(root, () => {
  if (position) emit('close')
})

function onKeydown(event: KeyboardEvent) {
  if (event.code === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="position"
      ref="root"
      tabindex="-1"
      data-test-id="file-context-menu"
      class="fixed z-[120] w-42 rounded-lg border border-border bg-panel p-1 shadow-[0_8px_30px_rgb(0_0_0/0.5)] outline-none"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @keydown="onKeydown"
    >
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] text-surface select-none hover:bg-hover"
        @click="emit('rename')"
      >
        <icon-lucide-edit-3 class="size-3 text-muted" />
        {{ renameLabel }}
      </button>
      <button
        v-if="showMove"
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] text-surface select-none hover:bg-hover"
        @click="emit('move')"
      >
        <icon-lucide-folder-input class="size-3 text-muted" />
        {{ moveLabel }}
      </button>
      <div class="mx-1 my-1 h-px bg-border" />
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] text-danger select-none hover:bg-hover"
        @click="emit('trash')"
      >
        <icon-lucide-trash-2 class="size-3" />
        {{ trashLabel }}
      </button>
    </div>
  </Teleport>
</template>
