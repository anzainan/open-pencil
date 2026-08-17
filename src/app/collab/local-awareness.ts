import type { Ref } from 'vue'
import type { Awareness } from 'y-protocols/awareness'

import { parseColor } from '@open-pencil/core/color'

import { currentUser } from '@/app/auth/session'
import { buildRemotePeers, remotePeersToCursors } from '@/app/collab/awareness'
import type { CollabState } from '@/app/collab/types'
import type { EditorStore } from '@/app/editor/active-store'

type LocalAwarenessOptions = {
  state: Ref<CollabState>
  storedName: Ref<string>
  getStore: () => EditorStore
  getAwareness: () => Awareness | null
}

export function createLocalAwarenessActions({
  state,
  storedName,
  getStore,
  getAwareness
}: LocalAwarenessOptions) {
  function broadcastAwareness() {
    const awareness = getAwareness()
    if (!awareness) return
    // P0 身份注入：优先取当前登录账号（name + avatar 图片/底色）；localStorage 匿名仅作游客兜底。
    const user = currentUser.value
    const name = user?.name ?? state.value.localName
    const avatarBg = user?.avatar.bg
    const avatarImage = user?.avatar.image
    awareness.setLocalStateField('user', {
      name: name || 'Anonymous',
      color: avatarBg ? parseColor(avatarBg) : state.value.localColor,
      avatarBg: avatarBg ?? null,
      avatarImage: avatarImage ?? null
    })
  }

  function updateCursor(x: number, y: number, pageId: string) {
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('cursor', { x, y, pageId, zoom: getStore().state.zoom })
  }

  function updateSelection(ids: string[]) {
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('selection', ids)
  }

  function updatePeersList() {
    const awareness = getAwareness()
    if (!awareness) return

    const store = getStore()
    const peers = buildRemotePeers(
      awareness.getStates() as Map<number, Record<string, unknown>>,
      awareness.clientID
    )

    state.value.peers = peers
    store.state.remoteCursors = remotePeersToCursors(peers, store.state.currentPageId)
    // P0 光标刷新只 bump renderVersion，不 bump sceneVersion（避免光标移动触发 autosave 误判 dirty）。
    store.requestRepaint()
  }

  function setLocalName(name: string) {
    state.value.localName = name
    storedName.value = name
    broadcastAwareness()
  }

  return { broadcastAwareness, updateCursor, updateSelection, updatePeersList, setLocalName }
}
