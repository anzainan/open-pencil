import type { Room } from 'trystero'
import type { Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { randomIndex } from '@open-pencil/core/random'

import { connectCollabRoom } from '@/app/collab/room'
import type { CollabState } from '@/app/collab/types'
import { bindCollabGraphEvents, registerYjsObservers } from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'
import { IS_BROWSER, PEER_COLORS } from '@/constants'

export type CollabRuntime = {
  ydoc: Y.Doc | null
  awareness: awarenessProtocol.Awareness | null
  ynodes: Y.Map<Y.Map<unknown>> | null
  yimages: Y.Map<Uint8Array> | null
  room: Room | null
  persistence: IndexeddbPersistence | null
  connectedStore: EditorStore | null
  suppressGraphSync: boolean
  suppressYjsEvents: boolean
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
}

type ConnectCollabSessionOptions = {
  roomId: string
  runtime: CollabRuntime
  state: Ref<CollabState>
  store: EditorStore
  disconnect: () => void
  updatePeersList: () => void
  tickFollow: () => void
  broadcastAwareness: () => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  syncNodeToYjs: (nodeId: string) => void
  syncAllNodesToYjs: () => void
}

type CollabConnectionActionsOptions = {
  runtime: CollabRuntime
  state: Ref<CollabState>
  getStore: () => EditorStore
  updatePeersList: () => void
  tickFollow: () => void
  broadcastAwareness: () => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  syncNodeToYjs: (nodeId: string) => void
  syncAllNodesToYjs: () => void
  resetFollow: () => void
}

type CollabSessionResources = {
  store: EditorStore
  room: Room | null
  awareness: awarenessProtocol.Awareness | null
  persistence: IndexeddbPersistence | null
  ydoc: Y.Doc | null
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
  resetFollow: () => void
}

/**
 * Trystero's encrypted WebRTC transport uses Web Crypto. Browsers expose
 * `crypto.subtle` only in a secure context, so an HTTP LAN deployment must
 * not create a room and then repeatedly fail on every document update.
 */
function supportsRealtimeTransport(): boolean {
  if (!IS_BROWSER) return true
  if (!window.isSecureContext) return false
  const subtle = window.crypto.subtle
  return (
    typeof subtle.digest === 'function' &&
    typeof subtle.importKey === 'function'
  )
}

export function createCollabRuntime(): CollabRuntime {
  return {
    ydoc: null,
    awareness: null,
    ynodes: null,
    yimages: null,
    room: null,
    persistence: null,
    connectedStore: null,
    suppressGraphSync: false,
    suppressYjsEvents: false,
    unbindGraphEvents: null,
    stopZoomWatch: null
  }
}

export function createInitialCollabState(localName: string): CollabState {
  return {
    connected: false,
    roomId: null,
    peers: [],
    localName,
    localColor: PEER_COLORS[randomIndex(PEER_COLORS.length)]
  }
}

export function createCollabConnectionActions({
  runtime,
  state,
  getStore,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  syncNodeToYjs,
  syncAllNodesToYjs,
  resetFollow
}: CollabConnectionActionsOptions) {
  function connect(roomId: string) {
    connectCollabSession({
      roomId,
      runtime,
      state,
      store: getStore(),
      disconnect,
      updatePeersList,
      tickFollow,
      broadcastAwareness,
      applyYjsToGraph,
      syncNodeToYjs,
      syncAllNodesToYjs
    })
  }

  function disconnect() {
    const store = runtime.connectedStore ?? getStore()
    disposeCollabSessionResources({
      store,
      room: runtime.room,
      awareness: runtime.awareness,
      persistence: runtime.persistence,
      ydoc: runtime.ydoc,
      unbindGraphEvents: runtime.unbindGraphEvents,
      stopZoomWatch: runtime.stopZoomWatch,
      resetFollow
    })
    resetCollabRuntime(runtime)
    resetCollabConnectionState(state)
  }

  return { connect, disconnect }
}

export function watchAwarenessZoom(store: EditorStore, getAwareness: () => Awareness | null) {
  return store.onEditorEvent('viewport:changed', (viewport) => {
    const awareness = getAwareness()
    if (!awareness) return
    const prev = awareness.getLocalState()?.cursor as
      | { x: number; y: number; pageId: string; zoom: number }
      | undefined
    if (prev) {
      awareness.setLocalStateField('cursor', { ...prev, zoom: viewport.zoom })
    }
  })
}

export function connectCollabSession({
  roomId,
  runtime,
  state,
  store,
  disconnect,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  syncNodeToYjs,
  syncAllNodesToYjs
}: ConnectCollabSessionOptions) {
  if (runtime.room) disconnect()
  if (!supportsRealtimeTransport()) {
    console.warn('[collab] real-time transport requires an HTTPS secure context')
    return
  }

  runtime.connectedStore = store
  state.value.roomId = roomId
  runtime.ydoc = new Y.Doc()
  runtime.awareness = new awarenessProtocol.Awareness(runtime.ydoc)
  runtime.ynodes = runtime.ydoc.getMap('nodes')
  runtime.yimages = runtime.ydoc.getMap('images')
  // RC-B：IndexeddbPersistence 建立后旧会话缓存以异步 IDB 载入方式回灌进 Yjs。
  // 在载入完成前注册观测器会让陈旧快照逐属性 LWW 覆盖新图（bump sceneVersion →
  // autosave 把旧状态写盘）。修法：先用 suppressYjsEvents 闸住加载回灌，等 whenSynced
  // resolve（初次载入完成）后再放行并全量压过缓存一次，保证「缓存先落、最新图后写」。
  const persistence = new IndexeddbPersistence(`op-room-${roomId}`, runtime.ydoc)
  runtime.persistence = persistence

  runtime.awareness.on('change', () => {
    updatePeersList()
    tickFollow()
  })

  // 注册观测器保持原样（连接即注册，不延迟事件流）；只在缓存回灌完成前抑制回放。
  registerYjsObservers({
    store,
    ynodes: runtime.ynodes,
    yimages: runtime.yimages,
    getSuppressYjsEvents: () => runtime.suppressYjsEvents,
    setSuppressGraphSync: (value) => {
      runtime.suppressGraphSync = value
    },
    applyYjsToGraph
  })

  // RC-B：初次载入完成前闸住旧缓存回灌，完成后用当前图压过缓存（LWW 定序收口）。
  runtime.suppressYjsEvents = true
  void persistence.whenSynced
    .catch(() => undefined)
    .then(() => {
      // 连接可能在 IDB 初次载入完成前被 disconnect 销毁；此时 runtime.ydoc 已置 null，
      // 不再对已销毁的 ydoc 做压盖，避免在我方断开后再操作失效内存。
      if (!runtime.ydoc) return undefined
      runtime.suppressYjsEvents = false
      syncAllNodesToYjs()
      return undefined
    })

  const roomConnection = connectCollabRoom({
    roomId,
    ydoc: runtime.ydoc,
    awareness: runtime.awareness,
    setConnected: () => {
      state.value.connected = true
    },
    updatePeersList
  })
  runtime.room = roomConnection.room
  state.value.connected = true
  broadcastAwareness()

  runtime.stopZoomWatch = watchAwarenessZoom(store, () => runtime.awareness)

  runtime.unbindGraphEvents = bindCollabGraphEvents({
    store,
    getYdoc: () => runtime.ydoc,
    getYnodes: () => runtime.ynodes,
    getSuppressGraphSync: () => runtime.suppressGraphSync,
    setSuppressYjsEvents: (value) => {
      runtime.suppressYjsEvents = value
    },
    syncNodeToYjs
  })
}

export function resetCollabRuntime(runtime: CollabRuntime) {
  runtime.unbindGraphEvents = null
  runtime.stopZoomWatch = null
  runtime.room = null
  runtime.awareness = null
  runtime.persistence = null
  runtime.ydoc = null
  runtime.ynodes = null
  runtime.yimages = null
  runtime.connectedStore = null
  runtime.suppressYjsEvents = false
}

export function resetCollabConnectionState(state: Ref<CollabState>) {
  state.value.connected = false
  state.value.roomId = null
  state.value.peers = []
}

export function disposeCollabSessionResources(resources: CollabSessionResources) {
  resources.unbindGraphEvents?.()
  resources.stopZoomWatch?.()
  void resources.room?.leave()
  resources.awareness?.destroy()
  if (resources.persistence) {
    void resources.persistence.destroy()
  }
  resources.ydoc?.destroy()
  resources.resetFollow()
  resources.store.state.remoteCursors = []
  resources.store.requestRender()
}
