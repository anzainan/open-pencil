<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { useI18n } from '@open-pencil/vue'

import {
  actOnNotification,
  hasUnread,
  loadNotifications,
  markAllRead,
  notifications,
  unreadCount,
  type AppNotification
} from '@/app/notifications'
import { toast } from '@/app/shell/ui'
import { usePopoverUI } from '@/components/ui/popover'
import Tip from '@/components/ui/Tip.vue'

defineOptions({ name: 'NotifyBell' })

const { dialogs } = useI18n()
const open = ref(false)
const cls = usePopoverUI({ content: 'z-[120] flex w-[340px] flex-col gap-1.5 rounded-lg border border-border p-2' })

const POLL_MS = 15_000
let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * 通知项 → 设计稿 §5.1 三类展示：
 *   类型 1 请求加入（join_request / permission_request，带「同意」操作按钮）
 *   类型 2 权限变更（permission_change，无按钮）
 *   类型 3 移除访问（removed，无按钮）
 */
const TYPE_BG: Record<AppNotification['type'], string> = {
  join_request: '#3B82F6',
  permission_request: '#3B82F6',
  permission_change: '#9747FF',
  removed: '#F59E0B'
}

const actionable = (item: AppNotification): boolean =>
  item.status === 'unread' &&
  (item.type === 'permission_request' || item.type === 'join_request')

/** 从标题前缀取发起人（标题形如「小田 请求加入团队」→「小田」）。 */
function actorChar(item: AppNotification): string {
  const first = item.title.split(/\s+/)[0] ?? ''
  return [...first][0]?.toUpperCase() ?? '?'
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const now = Date.now()
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return dialogs.value['notify.justNow']
  if (minutes < 60) return dialogs.value['notify.minutesAgo']({ count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return dialogs.value['notify.hoursAgo']({ count: hours })
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(then))) / 86_400_000)
  if (dayDiff === 1) return dialogs.value['notify.yesterday']
  return new Date(then).toLocaleDateString()
}

const statusLabel = (item: AppNotification): string => {
  if (item.status === 'approved') return dialogs.value['notify.approved']
  if (item.status === 'rejected') return dialogs.value['notify.rejected']
  return ''
}

async function refresh(): Promise<void> {
  try {
    await loadNotifications()
  } catch (error) {
    console.warn('[notify] load failed', error)
  }
}

function onOpenChange(value: boolean): void {
  open.value = value
  if (value) void refresh()
}

async function onResolve(item: AppNotification, action: 'approve' | 'reject'): Promise<void> {
  try {
    await actOnNotification(item.id, action)
    toast.info(
      action === 'approve'
        ? dialogs.value['notify.approved']
        : dialogs.value['notify.rejected']
    )
  } catch (error) {
    console.warn('[notify] action failed', error)
    toast.error(dialogs.value['notify.actionFailed'])
  }
}

async function onMarkAllRead(): Promise<void> {
  try {
    await markAllRead()
    toast.info(dialogs.value.allRead)
  } catch (error) {
    console.warn('[notify] mark all read failed', error)
    toast.error(dialogs.value['notify.actionFailed'])
  }
}

onMounted(() => {
  void refresh()
  // 轮询保持红点/列表与通知台账同步（打开面板时也会刷新一次）。
  pollTimer = setInterval(() => {
    if (!open.value) void refresh()
  }, POLL_MS)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
})
</script>

<template>
  <PopoverRoot :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="relative flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
        data-test-id="home-notifications"
        :aria-label="dialogs.notifications"
      >
        <Tip :label="dialogs.notifications">
          <icon-lucide-bell class="size-3.5" />
        </Tip>
        <span
          v-if="hasUnread"
          class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-error"
          :aria-label="String(unreadCount)"
          aria-hidden="false"
        />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="notify-panel"
        :class="cls.content"
        :side-offset="8"
        side="bottom"
        align="end"
      >
        <!-- np-header（设计稿 §5.1） -->
        <div class="flex items-center justify-between px-4 py-2">
          <span class="text-xs text-surface">{{ dialogs.notifications }}</span>
          <button
            type="button"
            class="cursor-pointer text-[10px] text-muted hover:text-surface"
            data-test-id="notify-mark-all-read"
            @click="onMarkAllRead"
          >
            {{ dialogs.allRead }}
          </button>
        </div>

        <div v-if="notifications.length" class="flex flex-col gap-1.5">
          <div
            v-for="item in notifications"
            :key="item.id"
            class="flex items-center gap-2 rounded-md bg-canvas p-2"
            :data-test-id="`notify-item-${item.id}`"
            :data-type="item.type"
            :data-status="item.status"
          >
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
              :style="{ backgroundColor: TYPE_BG[item.type] }"
              :data-test-id="`notify-avatar-${item.id}`"
            >
              {{ actorChar(item) }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[11px] leading-tight text-surface" :data-test-id="`notify-title-${item.id}`">
                {{ item.title }}
              </p>
              <p class="text-[10px] leading-tight text-muted">
                {{ relativeTime(item.createdAt) }}
              </p>
            </div>

            <div v-if="actionable(item)" class="flex shrink-0 items-center gap-1.5">
              <!-- np-btn-accept（设计稿 §5.1：22 高 #3B82F6 圆角4） -->
              <button
                type="button"
                class="h-[22px] cursor-pointer rounded bg-accent px-2 text-[10px] font-medium text-white hover:bg-accent/90"
                :data-test-id="`notify-approve-${item.id}`"
                @click="onResolve(item, 'approve')"
              >
                {{ item.type === 'join_request' ? dialogs['notify.agree'] : dialogs['notify.approve'] }}
              </button>
              <button
                type="button"
                class="h-[22px] cursor-pointer rounded border border-border px-2 text-[10px] font-medium text-muted hover:bg-hover hover:text-surface"
                :data-test-id="`notify-reject-${item.id}`"
                @click="onResolve(item, 'reject')"
              >
                {{ dialogs['notify.reject'] }}
              </button>
            </div>

            <p
              v-else-if="statusLabel(item)"
              class="shrink-0 text-[10px] text-muted"
              :data-test-id="`notify-status-${item.id}`"
            >
              {{ statusLabel(item) }}
            </p>
          </div>
        </div>

        <p v-else class="py-4 text-center text-[10px] text-muted">{{ dialogs.noNotifications }}</p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
