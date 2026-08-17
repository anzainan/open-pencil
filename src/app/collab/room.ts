import type { Room } from 'trystero'
import { joinRoom as joinTrysteroRoom } from 'trystero/mqtt'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

import { peekCollabConfig } from '@/app/collab/config'
import { TRYSTERO_APP_ID } from '@/constants'

/** 官方默认 MQTT 中继（Trystero/mqtt 的 defaultRelayUrls，类型未导出故本地镜像）。 */
const DEFAULT_RELAY_URLS = [
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
]

type CollabRoomOptions = {
  roomId: string
  ydoc: Y.Doc
  awareness: awarenessProtocol.Awareness
  setConnected: () => void
  updatePeersList: () => void
}

/** 官方默认 ICE 服务器（Trystero 内置 STUN + 本项目兜底 TURN），配置缺失/失效时兜底。 */
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]

export type CollabRoomConnection = {
  room: Room
  sendYjsUpdate: (data: Uint8Array, peerId?: string) => void
  sendAwareness: (data: Uint8Array, peerId?: string) => void
  sendSyncStep1: (data: Uint8Array, peerId?: string) => void
}

export function connectCollabRoom({
  roomId,
  ydoc,
  awareness,
  setConnected,
  updatePeersList
}: CollabRoomOptions): CollabRoomConnection {
  const collabConfig = peekCollabConfig()
  // P0 传输配置化：自建 broker / ICE 有配置时优先注入，但**追加**在官方默认之后而非独占
  // （RC-D：配置失效自动回落默认信令，房间不静默建不起来）。ICE 同理：保留官方默认兜底。
  const configuredIce = collabConfig?.collabIceServers?.length
    ? collabConfig.collabIceServers
    : null
  const iceServers = configuredIce
    ? [...configuredIce, ...DEFAULT_ICE_SERVERS]
    : DEFAULT_ICE_SERVERS
  const relayUrls = collabConfig?.collabBrokerUrl
    ? [collabConfig.collabBrokerUrl, ...DEFAULT_RELAY_URLS]
    : DEFAULT_RELAY_URLS
  const room = joinTrysteroRoom(
    {
      appId: TRYSTERO_APP_ID,
      rtcConfig: {
        iceServers
      },
      relayUrls
    },
    roomId
  )

  const [sendUpdate, getUpdate] = room.makeAction<Uint8Array>('yjs-update')
  const [sendAw, getAw] = room.makeAction<Uint8Array>('awareness')
  const [sendSync, getSync] = room.makeAction<Uint8Array>('sync-step1')
  const [sendSyncReply, getSyncReply] = room.makeAction<Uint8Array>('sync-reply')

  const sendYjsUpdate = (data: Uint8Array, peerId?: string) =>
    void (peerId ? sendUpdate(data, peerId) : sendUpdate(data))
  const sendAwareness = (data: Uint8Array, peerId?: string) =>
    void (peerId ? sendAw(data, peerId) : sendAw(data))
  const sendSyncStep1 = (data: Uint8Array, peerId?: string) =>
    void (peerId ? sendSync(data, peerId) : sendSync(data))

  getUpdate((data) => {
    Y.applyUpdate(ydoc, new Uint8Array(data), 'remote')
  })

  getAw((data) => {
    awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(data), null)
  })

  getSync((data, peerId) => {
    const sv = new Uint8Array(data)
    const update = Y.encodeStateAsUpdate(ydoc, sv)
    void sendSyncReply(update, peerId)
  })

  getSyncReply((data) => {
    Y.applyUpdate(ydoc, new Uint8Array(data), 'remote')
  })

  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    sendYjsUpdate(update)
  })

  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = [...added, ...updated, ...removed]
      const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      sendAwareness(encodedUpdate)
    }
  )

  room.onPeerJoin((peerId) => {
    setConnected()
    const sv = Y.encodeStateVector(ydoc)
    sendSyncStep1(sv, peerId)

    const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
    sendAwareness(encodedUpdate, peerId)
  })

  room.onPeerLeave(() => {
    const remoteClients = [...awareness.getStates().keys()].filter(
      (id) => id !== awareness.clientID
    )
    awarenessProtocol.removeAwarenessStates(awareness, remoteClients, 'peer-left')
    updatePeersList()
  })

  return { room, sendYjsUpdate, sendAwareness, sendSyncStep1 }
}
