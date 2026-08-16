import { useClipboard } from '@vueuse/core'
import { computed, inject, provide, proxyRefs, ref, watch } from 'vue'
import type { InjectionKey, Ref, ShallowUnwrapRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { colorToCSS, parseColor } from '@open-pencil/core/color'
import { useI18n } from '@open-pencil/vue'

import { currentUser } from '@/app/auth/session'
import type { BridgePresenceUser } from '@/app/bridge/client'
import { DEFAULT_COLLAB_STATE, useCollabInjected } from '@/app/collab/use'
import { toast } from '@/app/shell/ui'
import { getShareURL } from '@/constants'

/** 在线协作者头像底色兜底（avatar.bg 缺失时）。 */
const PRESENCE_FALLBACK_COLOR = '#10B981'

/** 简单字符串 hash（userId → 数值 clientId，CollabAvatarStack 的 :key 与 follow 用）。 */
export function hashUserId(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return hash
}

/** 在线头像数据（presence 快照带真实头像 image；本地身份/无头像 peer 回落字符+底色）。 */
export interface PresenceAvatar {
  char: string
  bg: string
  image?: string
}

function avatarFor(name: string, bg: string, image?: string): PresenceAvatar {
  return { char: (name.trim().charAt(0) || '?').toUpperCase(), bg, image }
}

function createCollabPanelContext(onlineUsers?: Ref<BridgePresenceUser[]>) {
  const route = useRoute()
  const router = useRouter()
  const collab = useCollabInjected()
  const { copy, copied } = useClipboard({ copiedDuring: 2000 })
  const { dialogs } = useI18n()

  const joinInput = ref('')
  const nameDraft = ref(collab?.state.value.localName ?? '')
  const pendingRoomId = computed(() =>
    typeof route.params.roomId === 'string' ? route.params.roomId : null
  )
  const popoverOpen = ref(!!pendingRoomId.value)
  // 本地头像身份取自账号（AuthUser.name / avatar.bg / avatar.image），非官方房间的 localStorage 匿名名。
  const state = computed(() => {
    const base = collab?.state.value ?? DEFAULT_COLLAB_STATE
    const user = currentUser.value
    if (!user) {
      return {
        ...base,
        localName: base.localName || dialogs.value.you,
        localColor: parseColor(PRESENCE_FALLBACK_COLOR),
        localAvatar: avatarFor(base.localName || dialogs.value.you, PRESENCE_FALLBACK_COLOR)
      }
    }
    return {
      ...base,
      localName: user.name,
      localColor: parseColor(user.avatar.bg || PRESENCE_FALLBACK_COLOR),
      localAvatar: avatarFor(user.name, user.avatar.bg || PRESENCE_FALLBACK_COLOR, user.avatar.image)
    }
  })
  // 在线协作者（C-live 方案二）：presence 快照优先（真实账号头像），Yjs 房间 peers 兜底合并。
  const peers = computed(() => {
    const presencePeers = (onlineUsers?.value ?? []).map((user) => ({
      clientId: hashUserId(user.userId),
      name: user.name,
      color: parseColor(user.avatar.bg || PRESENCE_FALLBACK_COLOR),
      avatar: avatarFor(user.name, user.avatar.bg || PRESENCE_FALLBACK_COLOR, user.avatar.image)
    }))
    const yjsPeers = (collab?.remotePeers.value ?? []).map((peer) => ({
      ...peer,
      avatar: avatarFor(peer.name, colorToCSS(peer.color))
    }))
    return [...presencePeers, ...yjsPeers]
  })
  const followingPeer = computed(() => collab?.followingPeer.value ?? null)
  const shareURL = computed(() => {
    if (!state.value.roomId) return ''
    return getShareURL(state.value.roomId)
  })
  const isJoining = computed(() => !!pendingRoomId.value && !state.value.connected)

  watch(
    pendingRoomId,
    (roomId) => {
      if (!state.value.connected) popoverOpen.value = !!roomId
    },
    { immediate: true }
  )

  function copyLink() {
    if (!shareURL.value) return
    void copy(shareURL.value)
    toast.info('Link copied to clipboard')
  }

  function share() {
    if (!collab || !nameDraft.value.trim()) return
    collab.setLocalName(nameDraft.value.trim())
    const roomId = collab.shareCurrentDoc()
    void router.push(`/share/${roomId}`)
    void copy(getShareURL(roomId))
    toast.info('Link copied to clipboard')
    popoverOpen.value = false
  }

  function join() {
    if (!collab) return
    const roomId = pendingRoomId.value || joinInput.value.trim().replace(/.*\/share\//, '')
    if (!roomId || !nameDraft.value.trim()) return
    collab.setLocalName(nameDraft.value.trim())
    collab.connect(roomId)
    void router.push(`/share/${roomId}`)
    popoverOpen.value = false
  }

  function disconnect() {
    if (!collab) return
    collab.disconnect()
    popoverOpen.value = false
    void router.push('/')
  }

  function toggleFollowPeer(clientId: number) {
    collab?.followPeer(followingPeer.value === clientId ? null : clientId)
  }

  return {
    dialogs,
    copied,
    joinInput,
    nameDraft,
    popoverOpen,
    state,
    peers,
    followingPeer,
    shareURL,
    isJoining,
    copyLink,
    share,
    join,
    disconnect,
    toggleFollowPeer
  }
}

export type CollabPanelContext = ShallowUnwrapRef<ReturnType<typeof createCollabPanelContext>>

const COLLAB_PANEL_KEY: InjectionKey<CollabPanelContext> = Symbol('CollabPanelContext')

export function provideCollabPanel(onlineUsers?: Ref<BridgePresenceUser[]>) {
  const ctx = proxyRefs(createCollabPanelContext(onlineUsers))
  provide(COLLAB_PANEL_KEY, ctx)
  return ctx
}

export function useCollabPanelContext(): CollabPanelContext {
  const ctx = inject(COLLAB_PANEL_KEY)
  if (!ctx) throw new Error('Collab panel controls must be used within CollabPanel')
  return ctx
}
