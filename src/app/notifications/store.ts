import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

export interface AppNotification {
  id: string
  /** 头像底色（tailwind bg 类） */
  color: string
  /** 头像 emoji */
  emoji: string
  title: string
  detail: string
  createdAt: number
  /** 操作按钮文案（如「接受」），缺省不显示按钮 */
  actionLabel?: string
  accepted?: boolean
}

const STORAGE_KEY = 'openpencil:notifications'
const READ_KEY = 'openpencil:notifications-read'
const SEEDED_KEY = 'openpencil:notifications-seeded'

/** 纯前端本地通知列表（内网版数据源：示例事件；生产事件等团队功能接入后替换）。 */
export const notifications = useLocalStorage<AppNotification[]>(STORAGE_KEY, [])

/** 面板是否已读（面板展开即置 true → 红点消失；「全部已读」也置 true）。 */
const readMark = useLocalStorage<boolean>(READ_KEY, false)

/** 是否已注入过示例事件（避免每次进入首页都重复注入）。 */
const seeded = useLocalStorage<boolean>(SEEDED_KEY, false)

export const hasUnread = computed(() => !readMark.value && notifications.value.length > 0)

export const unreadCount = computed(() => (hasUnread.value ? notifications.value.length : 0))

export function markAllRead(): void {
  readMark.value = true
}

/** 首次注入 1~2 个示例事件（团队功能接入前的事件源）。 */
export function seedSampleNotifications(): void {
  if (seeded.value || notifications.value.length > 0) return
  const now = Date.now()
  notifications.value = [
    {
      id: 'sample-join-request',
      color: 'bg-accent',
      emoji: '👋',
      title: '收到新的加入团队请求',
      detail: '张伟 请求加入「团队空间」',
      createdAt: now,
      actionLabel: '接受'
    },
    {
      id: 'sample-permission',
      color: 'bg-success',
      emoji: '🔓',
      title: '权限变更通知',
      detail: '李娜 已将「首页.fig」设为可查看',
      createdAt: now - 1000,
      actionLabel: '接受'
    }
  ]
  seeded.value = true
}

export function clearNotifications(): void {
  notifications.value = []
}

export function acceptNotification(id: string): void {
  const found = notifications.value.find((item) => item.id === id)
  if (found) found.accepted = true
}
