<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from '@open-pencil/vue'

import { openSettingsDialog } from '@/app/settings/dialog'
import Tip from '@/components/ui/Tip.vue'
import NotifyBell from '@/components/workspace/NotifyBell.vue'

defineOptions({ name: 'WorkspaceTopBar' })

const { dialogs } = useI18n()
const router = useRouter()

/**
 * 团队空间三视图（首页/文件夹/回收站）共享的 TopBar：统一 h-14 三段式布局。
 * 采用 `grid-cols-[1fr_auto_1fr]` 固定分区：左右两列等宽（1fr），中部按钮区
 * 恒在视口正中，标题/面包屑区宽度变化不影响按钮位置，页面切换不再漂移。
 * 中部按钮定宽 89×26（对齐设计稿板块四 CenterBtns），文字长度变化不挤压布局。
 * 基准 = 设计稿板块四（HomeView）。
 */
const {
  mode,
  title = '',
  breadcrumb = '',
  workspaceLabel = '',
  onBack,
  newDisabled = false
} = defineProps<{
  mode: 'home' | 'folder' | 'trash'
  title?: string
  breadcrumb?: string
  workspaceLabel?: string
  onBack?: () => void
  newDisabled?: boolean
}>()

const emit = defineEmits<{
  'new-project': []
  'new-document': []
}>()

function handleBack(): void {
  if (onBack) onBack()
  else void router.push('/')
}
</script>

<template>
  <header class="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border px-6">
    <div class="flex min-w-0 items-center">
      <template v-if="mode === 'home'">
        <div>
          <h1 class="text-sm font-semibold">{{ title }}</h1>
          <p class="text-[10px] text-muted">{{ workspaceLabel }}</p>
        </div>
      </template>
      <template v-else>
        <Tip :label="dialogs.back">
          <button
            type="button"
            :data-test-id="`${mode}-back`"
            :aria-label="dialogs.back"
            class="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            @click="handleBack"
          >
            <icon-lucide-arrow-left class="size-3.5" />
          </button>
        </Tip>
        <div v-if="mode === 'folder'" class="ml-3 flex min-w-0 items-center gap-2">
          <button
            type="button"
            class="cursor-pointer truncate text-[13px] text-muted hover:text-surface"
            @click="handleBack"
          >
            {{ dialogs.teamSpace }}
          </button>
          <icon-lucide-chevron-right class="size-3 shrink-0 text-muted" />
          <span class="truncate text-[13px] font-medium text-surface">{{ breadcrumb }}</span>
        </div>
        <div v-else class="ml-3 flex items-center gap-2">
          <icon-lucide-trash-2 class="size-3.5 text-muted" />
          <h1 class="text-sm font-semibold">{{ title }}</h1>
        </div>
      </template>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        :data-test-id="`${mode}-new-project`"
        class="flex h-[26px] w-[89px] items-center justify-center rounded border border-border text-xs text-muted hover:bg-hover hover:text-surface"
        @click="emit('new-project')"
      >
        {{ dialogs.newProject }}
      </button>
      <button
        type="button"
        class="flex h-[26px] w-[89px] items-center justify-center rounded bg-accent text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="newDisabled"
        :data-test-id="`${mode}-new-document`"
        @click="emit('new-document')"
      >
        {{ dialogs.newWhiteboard }}
      </button>
    </div>

    <div class="flex min-w-0 items-center justify-end gap-1.5">
      <button
        type="button"
        :data-test-id="`${mode}-settings`"
        class="rounded px-2 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
        @click="openSettingsDialog('storage')"
      >
        {{ dialogs.settings }}
      </button>
      <NotifyBell />
      <Tip v-if="mode !== 'trash'" :label="dialogs.trash">
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
          :data-test-id="`${mode}-trash`"
          :aria-label="dialogs.trash"
          @click="router.push('/trash')"
        >
          <icon-lucide-trash-2 class="size-3.5" />
        </button>
      </Tip>
      <span
        v-else
        class="flex size-7 shrink-0 items-center justify-center rounded text-xs font-medium text-white"
        aria-hidden="true"
      >
        <icon-lucide-trash-2 class="size-3.5" />
      </span>
    </div>
  </header>
</template>
