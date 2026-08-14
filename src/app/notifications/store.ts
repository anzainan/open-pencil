import { computed, ref } from 'vue'

import {
  listNotifications,
  markAllNotificationsRead,
  resolveNotification,
  type BridgeNotification
} from '@/app/bridge/share'

export type { BridgeNotification as AppNotification } from '@/app/bridge/share'

/**
 * 通知中心 store（Phase D）：服务端数据源（GET /api/v1/notifications）。
 * 登录态首页铃铛按人拉取（targetUserId = 当前用户）；未读红点 = unread 计数；
 * 「全部已读」→ POST read-all；批准/拒绝 → POST :id/action 后刷新列表。
 */
const items = ref<BridgeNotification[]>([])

export const notifications = computed(() => items.value)

export const unreadCount = computed(
  () => items.value.filter((item) => item.status === 'unread').length
)

export const hasUnread = computed(() => unreadCount.value > 0)

/** 拉取当前用户通知列表（登录态）。 */
export async function loadNotifications(): Promise<void> {
  items.value = await listNotifications()
}

/** 全部已读（服务端 + 本地同步标记）。 */
export async function markAllRead(): Promise<void> {
  await markAllNotificationsRead()
  items.value = items.value.map((item) =>
    item.status === 'unread' ? { ...item, status: 'read' as const } : item
  )
}

/** 处理通知（批准/拒绝）→ 成功后刷新列表。 */
export async function actOnNotification(id: string, action: 'approve' | 'reject'): Promise<void> {
  await resolveNotification(id, action)
  await loadNotifications()
}

/** 清空本地列表（登出/切用户时调用，避免残留他人通知）。 */
export function clearNotifications(): void {
  items.value = []
}
