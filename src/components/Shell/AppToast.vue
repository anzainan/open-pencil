<script setup lang="ts">
import { computed } from 'vue'
import { ToastProvider, ToastRoot, ToastDescription, ToastViewport, ToastClose } from 'reka-ui'

import { useClipboard } from '@vueuse/core'

import Tip from '@/components/ui/Tip.vue'
import { toast } from '@/app/shell/ui'
import { useToastUI } from '@/components/ui/toast'

import type { ToastVariant } from '@/components/ui/toast'
import { useI18n } from '@open-pencil/vue'

const { copy, copied } = useClipboard({ copiedDuring: 1500 })
const { dialogs } = useI18n()
const defaultToastClass = useToastUI({ tone: 'default' }).base
const warningToastClass = useToastUI({ tone: 'warning' }).base
const errorToastClass = useToastUI({ tone: 'error' }).base
const savedToastClass = useToastUI({ tone: 'saved', ui: { base: 'w-[180px] items-center' } }).base

function toastClass(tone: ToastVariant) {
  if (tone === 'error') return errorToastClass
  if (tone === 'warning') return warningToastClass
  if (tone === 'saved') return savedToastClass
  return defaultToastClass
}

// 设计稿 §3.1 toast-saved：右上角独立 viewport，与常规 toast 分离。
const mainToasts = computed(() => toast.toasts.value.filter((item) => item.variant !== 'saved'))
const savedToasts = computed(() => toast.toasts.value.filter((item) => item.variant === 'saved'))
</script>

<template>
  <!-- 常规 toast（默认/警告/错误，顶部居中） -->
  <ToastProvider swipe-direction="up">
    <ToastRoot
      v-for="t in mainToasts"
      :key="t.id"
      data-test-id="toast-item"
      :duration="t.variant === 'error' ? toast.ERROR_TOAST_DURATION : toast.TOAST_DURATION"
      :class="toastClass(t.variant)"
      @update:open="
        (open) => {
          if (!open) toast.remove(t.id)
        }
      "
    >
      <icon-lucide-check v-if="t.variant === 'default'" class="mt-0.5 size-3 shrink-0" />
      <icon-lucide-triangle-alert v-else class="mt-0.5 size-3 shrink-0" />
      <ToastDescription class="min-w-0 flex-1 select-text">
        {{ t.message }}<span v-if="t.count > 1" class="ml-1.5 opacity-70">×{{ t.count }}</span>
      </ToastDescription>
      <Tip
        v-if="t.variant !== 'default'"
        :label="copied ? dialogs.copiedExclamation : dialogs.copyMessage"
      >
        <button
          data-test-id="toast-copy-message"
          class="mt-0.5 shrink-0 cursor-pointer rounded p-0.5 opacity-70 hover:opacity-100"
          @click="copy(t.message)"
        >
          <icon-lucide-check v-if="copied" class="size-3" />
          <icon-lucide-copy v-else class="size-3" />
        </button>
      </Tip>
      <ToastClose
        v-if="t.variant !== 'default'"
        data-test-id="toast-close"
        class="mt-0.5 shrink-0 cursor-pointer rounded p-0.5 opacity-70 hover:opacity-100"
      >
        <icon-lucide-x class="size-3" />
      </ToastClose>
    </ToastRoot>

    <ToastViewport
      :label="`${dialogs.notifications} (F8)`"
      class="fixed top-2 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-1.5"
    />
  </ToastProvider>

  <!-- 保存成功 toast（设计稿 §3.1 toast-saved：右上 180×36 #1E1E1E 描边 #3B82F6 圆角6） -->
  <ToastProvider swipe-direction="up">
    <ToastRoot
      v-for="t in savedToasts"
      :key="t.id"
      data-test-id="toast-item-saved"
      :duration="toast.TOAST_DURATION"
      :class="savedToastClass"
      @update:open="
        (open) => {
          if (!open) toast.remove(t.id)
        }
      "
    >
      <icon-lucide-check-circle class="size-3.5 shrink-0 text-accent" />
      <ToastDescription class="min-w-0 flex-1 select-text text-[11px]">
        {{ t.message }}
      </ToastDescription>
    </ToastRoot>

    <ToastViewport
      :label="dialogs.notifications"
      class="fixed top-4 right-4 z-[9999] flex flex-col items-end gap-1.5"
    />
  </ToastProvider>
</template>
