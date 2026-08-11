<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import { computed, ref } from 'vue'

import { getActiveProvider, type StockPhotoResult } from '@open-pencil/core/tools'
import { useI18n } from '@open-pencil/vue'

import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { openSettingsDialog } from '@/app/settings/dialog'
import { toast } from '@/app/shell/ui'
import AppInput from '@/components/ui/AppInput.vue'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'

const STOCK_IMAGE_MIME = 'application/x-openpencil-stock-image'

const editor = useEditorStore()
const { panels } = useI18n()
const { pexelsKeyStatus } = useAIChat()

const query = ref('')
const results = ref<StockPhotoResult[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searched = ref(false)
const insertingId = ref<string | null>(null)

const hasKey = computed(() => pexelsKeyStatus.value === 'configured')

async function search(): Promise<void> {
  const term = query.value.trim()
  if (!term || !hasKey.value || loading.value) return
  loading.value = true
  error.value = null
  try {
    const provider = getActiveProvider()
    if (!provider) throw new Error('No stock photo provider configured')
    results.value = await provider.search(term, {
      perPage: 20,
      orientation: 'square',
      targetDim: 1200
    })
    searched.value = true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

watchDebounced(query, () => void search(), { debounce: 300 })

function viewportCenter() {
  const canvasCenter = editor.viewportCanvasCenter()
  return editor.screenToCanvas(canvasCenter.x, canvasCenter.y)
}

async function insertPhoto(photo: StockPhotoResult): Promise<void> {
  if (insertingId.value) return
  insertingId.value = photo.sourceId
  try {
    const response = await fetch(photo.url)
    if (!response.ok) throw new Error(`Failed to load image (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const file = new File([bytes], 'stock-photo.jpg', { type: 'image/jpeg' })
    const center = viewportCenter()
    await editor.placeImageFiles([file], center.x, center.y)
  } catch (reason) {
    toast.error(`插入图片失败：${reason instanceof Error ? reason.message : String(reason)}`)
  } finally {
    insertingId.value = null
  }
}

function onDragStart(event: DragEvent, photo: StockPhotoResult) {
  if (!event.dataTransfer) return
  const displayWidth = Math.min(photo.width, 1200)
  const displayHeight = Math.round((displayWidth * photo.height) / photo.width)
  event.dataTransfer.setData(
    STOCK_IMAGE_MIME,
    JSON.stringify({
      url: photo.url,
      width: photo.width,
      height: photo.height,
      displayWidth,
      displayHeight
    })
  )
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center gap-2 px-2 py-2">
      <AppInput
        v-model="query"
        type="search"
        data-test-id="stock-photo-search"
        size="sm"
        class="min-w-0 flex-1"
        :placeholder="panels.searchStockPhotos"
        @keydown.enter="search()"
      />
    </div>

    <div class="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      <AppPlaceholder
        v-if="!hasKey"
        data-test-id="stock-photo-no-key"
        :label="panels.stockPhotoNoKey"
        size="compact"
      >
        <template #icon>
          <icon-lucide-image class="size-4" />
        </template>
        <template #action>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90"
            data-test-id="stock-photo-open-settings"
            @click="openSettingsDialog('media')"
          >
            {{ panels.openMediaSettings }}
          </button>
        </template>
      </AppPlaceholder>

      <AppPlaceholder
        v-else-if="loading"
        data-test-id="stock-photo-loading"
        :label="panels.searchStockPhotos"
        size="compact"
      >
        <template #icon>
          <icon-lucide-loader-2 class="size-4 animate-spin" />
        </template>
      </AppPlaceholder>

      <AppPlaceholder
        v-else-if="error"
        data-test-id="stock-photo-error"
        :label="error"
        size="compact"
      >
        <template #icon>
          <icon-lucide-alert-circle class="size-4" />
        </template>
      </AppPlaceholder>

      <div v-else-if="results.length > 0" class="grid grid-cols-2 gap-2">
        <div
          v-for="photo in results"
          :key="photo.sourceId"
          role="button"
          tabindex="0"
          data-test-id="stock-photo-item"
          :data-source-id="photo.sourceId"
          :draggable="true"
          class="group/photo relative aspect-square overflow-hidden rounded bg-canvas/60 outline-none hover:ring-1 hover:ring-accent focus-visible:ring-1 focus-visible:ring-accent"
          @click="insertPhoto(photo)"
          @keydown.enter="insertPhoto(photo)"
          @keydown.space.prevent="insertPhoto(photo)"
          @dragstart="onDragStart($event, photo)"
        >
          <img
            :src="photo.thumbnail ?? photo.url"
            :alt="''"
            loading="lazy"
            class="size-full object-cover"
          />
          <div
            class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover/photo:opacity-100"
          >
            <span class="rounded bg-black/60 px-2 py-1 text-[10px] font-medium text-white">
              {{ insertingId === photo.sourceId ? '…' : panels.insertPhoto }}
            </span>
          </div>
        </div>
      </div>

      <AppPlaceholder
        v-else-if="searched"
        data-test-id="stock-photo-empty"
        :label="panels.stockPhotosEmpty"
        size="compact"
      >
        <template #icon>
          <icon-lucide-image-off class="size-4" />
        </template>
      </AppPlaceholder>

      <AppPlaceholder
        v-else
        data-test-id="stock-photo-idle"
        :label="panels.searchStockPhotos"
        size="compact"
      >
        <template #icon>
          <icon-lucide-search class="size-4" />
        </template>
      </AppPlaceholder>
    </div>
  </div>
</template>
