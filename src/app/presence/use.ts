import { tryOnScopeDispose, useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { ref, toValue, watch, type MaybeRef, type Ref } from 'vue'

import { currentUser } from '@/app/auth/session'
import { bridgeClient, type BridgePresenceUser } from '@/app/bridge/client'

/** 在线心跳间隔：8s 上报一次，服务端 15s 无心跳即清理下线。 */
const HEARTBEAT_MS = 8000

/**
 * 文档在线感知（C-live 方案二）。
 * 文档路径非空（bridge 文件已打开）时：挂载拉快照自愈 + 8s 心跳上报 +
 * SSE 订阅 online.changed 全量快照。按 userId 去重、排除自己。
 * 页面 hidden 时暂停心跳（省资源），visible 恢复并立即补一次心跳。
 * 卸载/文档切换自动清理（interval + SSE 订阅）。
 */
export function useDocumentPresence(
  documentPath: MaybeRef<string | null>
): { onlineUsers: Ref<BridgePresenceUser[]> } {
  const onlineUsers = ref<BridgePresenceUser[]>([])
  const visibility = useDocumentVisibility()

  function applyUsers(users: BridgePresenceUser[]) {
    const selfId = currentUser.value?.id ?? null
    const seen = new Set<string>()
    const filtered: BridgePresenceUser[] = []
    for (const user of users) {
      if (user.userId === selfId || seen.has(user.userId)) continue
      seen.add(user.userId)
      filtered.push(user)
    }
    onlineUsers.value = filtered
  }

  function beat(path: string) {
    void bridgeClient.reportOnline(path).then((users) => applyUsers(users))
  }

  const { pause, resume } = useIntervalFn(
    () => {
      const path = toValue(documentPath)
      if (path && visibility.value !== 'hidden') beat(path)
    },
    HEARTBEAT_MS,
    { immediate: false }
  )

  function stopPresence() {
    pause()
    onlineUsers.value = []
  }

  function startPresence(path: string) {
    stopPresence()
    void bridgeClient.getOnline(path).then((users) => applyUsers(users))
    if (visibility.value !== 'hidden') {
      beat(path)
      resume()
    }
  }

  watch(
    () => toValue(documentPath),
    (path) => {
      if (path) startPresence(path)
      else stopPresence()
    },
    { immediate: true }
  )

  watch(visibility, (state) => {
    if (state === 'hidden') {
      pause()
      return
    }
    const path = toValue(documentPath)
    if (path) {
      beat(path)
      resume()
    }
  })

  const unsubscribe = bridgeClient.subscribe((event) => {
    if (event.type !== 'online.changed') return
    if (event.path !== toValue(documentPath)) return
    applyUsers(event.users ?? [])
  })

  tryOnScopeDispose(() => {
    unsubscribe()
    pause()
    onlineUsers.value = []
  })

  return { onlineUsers }
}
