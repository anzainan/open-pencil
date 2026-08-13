<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { useI18n } from '@open-pencil/vue'

import {
  acceptNotification,
  clearNotifications,
  hasUnread,
  markAllRead,
  notifications,
  seedSampleNotifications,
  unreadCount
} from '@/app/notifications'
import { toast } from '@/app/shell/ui'
import { usePopoverUI } from '@/components/ui/popover'
import Tip from '@/components/ui/Tip.vue'

const { dialogs } = useI18n()
const open = ref(false)
const cls = usePopoverUI({ content: 'z-[120] w-[21rem] p-3' })

onMounted(() => {
  seedSampleNotifications()
})

function onOpenChange(value: boolean) {
  open.value = value
  if (value) markAllRead()
}

function onAccept(id: string, title: string) {
  acceptNotification(id)
  toast.info(`${dialogs.value.accepted}：${title}`)
}

function onClear() {
  clearNotifications()
  toast.info(dialogs.value.allRead)
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <Tip :label="dialogs.notifications">
        <button
          type="button"
          class="relative flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
          data-test-id="home-notifications"
          :aria-label="dialogs.notifications"
        >
          <icon-lucide-bell class="size-3.5" />
          <span
            v-if="hasUnread"
            class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-error"
            :aria-label="String(unreadCount)"
            aria-hidden="false"
          />
        </button>
      </Tip>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="notify-panel"
        :class="cls.content"
        :side-offset="8"
        side="bottom"
        align="end"
      >
        <div class="flex items-center justify-between border-b border-border pb-2">
          <span class="text-xs text-surface">{{ dialogs.notifications }}</span>
          <button
            type="button"
            class="cursor-pointer text-[10px] text-muted hover:text-surface"
            data-test-id="notify-mark-all-read"
            @click="onClear"
          >
            {{ dialogs.allRead }}
          </button>
        </div>

        <div v-if="notifications.length" class="mt-2 flex flex-col gap-2">
          <div
            v-for="item in notifications"
            :key="item.id"
            class="flex items-center gap-3 rounded-lg bg-canvas p-2"
            :data-accepted="item.accepted ?? false"
          >
            <div
              class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
              :class="item.color"
            >
              {{ item.emoji }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs text-surface">{{ item.title }}</p>
              <p class="truncate text-[10px] text-muted">{{ item.detail }}</p>
            </div>
            <button
              v-if="item.actionLabel && !item.accepted"
              type="button"
              class="shrink-0 rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent/90"
              data-test-id="notify-accept"
              @click="onAccept(item.id, item.title)"
            >
              {{ item.actionLabel }}
            </button>
          </div>
        </div>

        <p v-else class="py-4 text-center text-[10px] text-muted">{{ dialogs.noNotifications }}</p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
