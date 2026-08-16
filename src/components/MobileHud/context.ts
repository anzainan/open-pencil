import { useClipboard } from '@vueuse/core'
import { computed, inject, provide, proxyRefs } from 'vue'
import type { InjectionKey, Ref, ShallowUnwrapRef } from 'vue'
import { useRouter } from 'vue-router'
import IconFilePlus from '~icons/lucide/file-plus'
import IconFolderOpen from '~icons/lucide/folder-open'
import IconImageDown from '~icons/lucide/image-down'
import IconSave from '~icons/lucide/save'
import IconZoomIn from '~icons/lucide/zoom-in'

import { useEditorCommands, useI18n } from '@open-pencil/vue'

import { DEFAULT_COLLAB_STATE, useCollabInjected } from '@/app/collab/use'
import { useEditorStore } from '@/app/editor/active-store'
import { toolIcons } from '@/app/editor/icons'
import { openFileDialog } from '@/app/shell/menu/use'
import { toast } from '@/app/shell/ui'
import { currentUser } from '@/app/auth/session'
import type { BridgePresenceUser } from '@/app/bridge/client'
import { hashUserId, type PresenceAvatar } from '@/components/CollabPanel/context'
import type { ToolbarActionItem } from '@/components/Toolbar/types'
import { getShareURL } from '@/constants'

type MenuAction = ToolbarActionItem

/** 在线头像栈底色兜底（presence avatar.bg 缺失时）。 */
const PRESENCE_FALLBACK_COLOR = '#10B981'

function avatarFor(name: string, bg: string, image?: string): PresenceAvatar {
  return { char: (name.trim().charAt(0) || '?').toUpperCase(), bg, image }
}

function createMobileHudContext(onlineUsers?: Ref<BridgePresenceUser[]>) {
  const router = useRouter()
  const collab = useCollabInjected()
  const store = useEditorStore()
  const { copy } = useClipboard()
  const { dialogs } = useI18n()
  const { getCommand } = useEditorCommands()

  const collabState = computed(() => collab?.state.value ?? DEFAULT_COLLAB_STATE)
  // Yjs 房间 peers 兜底 + 按 clientId（userId hash）合并 presence 头像（无匹配回落字符+色块）。
  const collabPeers = computed(() =>
    (collab?.remotePeers.value ?? []).map((peer) => {
      const presence = (onlineUsers?.value ?? []).find(
        (user) => hashUserId(user.userId) === peer.clientId
      )
      const avatar = presence
        ? avatarFor(presence.name, presence.avatar.bg || PRESENCE_FALLBACK_COLOR, presence.avatar.image)
        : avatarFor(peer.name, PRESENCE_FALLBACK_COLOR)
      return { ...peer, avatar }
    })
  )
  const followingPeer = computed(() => collab?.followingPeer.value ?? null)
  const onlineCount = computed(() => collabPeers.value.length + 1)
  // 本地身份头像（当前登录账号 avatar；未登录回落匿名 initials）。
  const localAvatar = computed(() => {
    const user = currentUser.value
    if (!user) return avatarFor(collabState.value.localName || 'You', PRESENCE_FALLBACK_COLOR)
    return avatarFor(user.name, user.avatar.bg || PRESENCE_FALLBACK_COLOR, user.avatar.image)
  })
  const activeToolIcon = computed(() => toolIcons[store.state.activeTool])
  const actionToast = computed(() => store.state.actionToast)

  const menuItems: MenuAction[] = [
    {
      icon: IconFilePlus,
      label: 'New',
      action: () => void import('@/app/tabs').then((m) => m.createTab())
    },
    { icon: IconFolderOpen, label: 'Open…', action: () => void openFileDialog() },
    { icon: IconSave, label: 'Save to cloud', action: () => void store.saveFigFile() },
    { icon: IconImageDown, label: 'Export…', action: () => void store.exportSelection(1, 'png') },
    { icon: IconZoomIn, label: 'Zoom to fit', action: () => getCommand('view.zoomFit').run() }
  ]

  function undo() {
    getCommand('edit.undo').run()
  }

  function redo() {
    getCommand('edit.redo').run()
  }

  function share() {
    if (!collab) return
    const roomId = collab.shareCurrentDoc()
    void router.push(`/share/${roomId}`)
    void copy(getShareURL(roomId))
    toast.info('Link copied to clipboard')
  }

  function disconnect() {
    if (!collab) return
    collab.disconnect()
    void router.push('/')
  }

  function toggleFollowPeer(clientId: number) {
    collab?.followPeer(followingPeer.value === clientId ? null : clientId)
  }

  return {
    store,
    dialogs,
    collabState,
    collabPeers,
    localAvatar,
    followingPeer,
    onlineCount,
    activeToolIcon,
    actionToast,
    menuItems,
    undo,
    redo,
    share,
    disconnect,
    toggleFollowPeer
  }
}

export type MobileHudContext = ShallowUnwrapRef<ReturnType<typeof createMobileHudContext>>

const MOBILE_HUD_KEY: InjectionKey<MobileHudContext> = Symbol('MobileHudContext')

export function provideMobileHud(onlineUsers?: Ref<BridgePresenceUser[]>) {
  const ctx = proxyRefs(createMobileHudContext(onlineUsers))
  provide(MOBILE_HUD_KEY, ctx)
  return ctx
}

export function useMobileHudContext(): MobileHudContext {
  const ctx = inject(MOBILE_HUD_KEY)
  if (!ctx) throw new Error('Mobile HUD controls must be used within MobileHud')
  return ctx
}
