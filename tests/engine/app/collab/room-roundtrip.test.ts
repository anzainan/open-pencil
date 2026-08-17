import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { connectCollabRoom } from '@/app/collab/room'

/**
 * P0 官方实时协作双连接同房间 round-trip（ARCH-collab-official-eval §4.4-④）。
 *
 * 基建说明：真实 Trystero MQTT（mqtt.js→ws）在 Bun 运行时不受支持
 * （`createWebSocketStream: Not supported yet in Bun`），且容器内无浏览器 WebRTC。
 * 因此本测试以「内存 relay mock 替代 Trystero 信令/传输」验证 `connectCollabRoom` 的
 * Yjs 状态同步 + awareness 互通逻辑（同一份网关代码），并按要求写明基建不支持原因。
 *
 * 模拟内容（与 room.ts 消费的 Trystero 接口一致）：
 * - joinRoom 返回 { makeAction, onPeerJoin, onPeerLeave, leave }；
 * - makeAction 做「同房间点对点内存转发」（A 发 → B 收，B 发 → A 收）；
 * - 先建立 A 后建立 B 触发 onPeerJoin（B 向 A 发起 sync-step1 全量同步）；
 * - 双方 MakeAction 的 action 全量互通（yjs-update / awareness / sync-step1 / sync-reply）。
 *
 * 端到端断言：A 写入 Y.Doc → B 收到并收敛；B 广播 awareness（身份）→ A 可见。
 */

type Receiver = (data: ArrayBuffer, peerId: string) => void

// 房间 → action key → 成员id → 该成员的接收器（发送者按目标成员精准投递，不自投）。
const roomActions = new Map<string, Map<string, Map<string, Receiver>>>()
const roomJoinHandlers = new Map<string, ((peerId: string) => void)[]>()
const joinedMembers = new Map<string, Set<string>>()

interface FakeRoom {
  makeAction: <T>(
    namespace: string
  ) => [(data: T) => void, (fn: (data: T, peerId: string) => void) => void]
  onPeerJoin: (fn: (peerId: string) => void) => void
  onPeerLeave: (fn: (peerId: string) => void) => void
  leave: () => Promise<void>
}

function createLocalRoom(_roomId: string, selfMember: string): FakeRoom {
  const roomId = _roomId
  const actions = roomActions.get(roomId) ?? new Map<string, Map<string, Receiver>>()
  roomActions.set(roomId, actions)
  const members = joinedMembers.get(roomId) ?? new Set<string>()
  members.add(selfMember)
  joinedMembers.set(roomId, members)

  const room: FakeRoom = {
    makeAction<T>(
      namespace: string
    ): [(data: T) => void, (fn: (data: T, peerId: string) => void) => void] {
      const key = `${roomId}:${namespace}`
      const targets = actions.get(key) ?? new Map<string, Receiver>()
      actions.set(key, targets)

      const sender = (data: T) => {
        const bytes = serialize(data)
        const payload = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
        // 广播给同房间其它成员（各自的目标接收器收到）。
        for (const other of members) {
          if (other === selfMember) continue
          targets.get(other)?.(payload, selfMember)
        }
      }
      const receiver = (fn: (data: T, peerId: string) => void) => {
        targets.set(selfMember, (data, peerId) => fn(data as T, peerId))
      }
      return [sender, receiver]
    },
    onPeerJoin(fn) {
      const handlers = roomJoinHandlers.get(roomId) ?? []
      handlers.push(fn)
      roomJoinHandlers.set(roomId, handlers)
    },
    onPeerLeave() {
      // No-op in test harness.
    },
    async leave() {
      members.delete(selfMember)
      joinedMembers.set(roomId, members)
    }
  }
  return room
}

// 捕获 joinRoom 收到的 config，供断言「配置追加官方默认」。
const lastJoinConfig = { config: null as object | null }
const joinRoomSpy = mock((config: object, roomId: string) => {
  lastJoinConfig.config = config
  const memberId = `member-${(joinedMembers.get(roomId)?.size ?? 0) + 1}`
  return createLocalRoom(roomId, memberId)
})

mock.module('trystero/mqtt', () => ({
  joinRoom: joinRoomSpy
}))

function serialize(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  // action 数据在 room.ts 均以 Uint8Array 传递（Yjs 字节 / awareness 字节）。
  return new Uint8Array(0)
}

// 动态导入：确保 mock.module 已注册后才加载 room.ts（ESM 顶层 import 会先于 mock 执行）。
let connectRoom: typeof connectCollabRoom | null = null
beforeAll(async () => {
  const mod = await import('@/app/collab/room')
  connectRoom = mod.connectCollabRoom
})

function createConnection(roomId: string) {
  const ydoc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(ydoc)
  let connected = false
  let peersUpdated = 0
  const conn = (connectRoom as typeof connectCollabRoom)({
    roomId,
    ydoc,
    awareness,
    setConnected: () => {
      connected = true
    },
    updatePeersList: () => {
      peersUpdated++
    }
  })
  return {
    ydoc,
    awareness,
    conn,
    get connected() {
      return connected
    },
    get peersUpdated() {
      return peersUpdated
    }
  }
}

// 模拟 Trystero 入房广播：触发房间内已有成员（existing）的 onPeerJoin（告知 joiner 入房）。
function announceJoin(roomId: string, joinerId: string, existingId: string) {
  const handlers = roomJoinHandlers.get(roomId) ?? []
  const members = joinedMembers.get(roomId) ?? new Set()
  if (!members.has(existingId) || !members.has(joinerId)) return
  for (const handler of handlers) handler(joinerId)
}

afterEach(() => {
  // 清理本测试创建的房间，避免跨测试串扰。
  roomActions.clear()
  roomJoinHandlers.clear()
  joinedMembers.clear()
})

describe('connectCollabRoom 双连接同房间 round-trip（内存 relay mock 替代 Trystero）', () => {
  test('A 写 Yjs → B 收敛；B 广播 awareness（身份）→ A 可见', async () => {
    const roomId = randomUUID().slice(0, 8)
    joinedMembers.set(roomId, new Set())
    const a = createConnection(roomId) // member-1
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    const b = createConnection(roomId) // member-2
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    // A 写入 Yjs 文档 → 经 yjs-update action 转发给 B（A 广播，B 的目标接收器命中）。
    a.ydoc.getMap('nodes').set('nA', new Y.Map([['type', 'RECTANGLE']]))
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(b.ydoc.getMap('nodes').size).toBe(1)
    const nA = b.ydoc.getMap('nodes').get('nA') as Y.Map<unknown>
    expect(nA.get('type')).toBe('RECTANGLE')

    // B 广播 awareness（模拟 local-awareness 注入身份）→ A 侧取到 B 的 user 信息。
    b.awareness.setLocalStateField('user', {
      name: '远程同事',
      color: { r: 0, g: 0, b: 1, a: 1 },
      avatarImage: 'https://hub.local/avatar/b.png',
      avatarBg: '#3B82F6'
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })

    const bState = a.awareness.getStates().get(b.awareness.clientID)
    expect(bState).toBeDefined()
    if (bState) {
      const user = bState.user as { name?: string; avatarImage?: string; avatarBg?: string }
      expect(user.name).toBe('远程同事')
      expect(user.avatarImage).toBe('https://hub.local/avatar/b.png')
      expect(user.avatarBg).toBe('#3B82F6')
    }

    await a.conn.room.leave()
    await b.conn.room.leave()
  })

  test('B 后入房 onPeerJoin → sync-step1/reply：B 收到 A 已有状态（全量同步）', async () => {
    const roomId = randomUUID().slice(0, 8)
    joinedMembers.set(roomId, new Set())
    const a = createConnection(roomId) // member-1
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    a.ydoc.getMap('nodes').set('n1', new Y.Map([['type', 'RECTANGLE']]))
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const b = createConnection(roomId) // member-2
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    // 模拟 B 入房：A 的 onPeerJoin 被触发 → A 向 B 发送 sync-step1(stateVector)；
    // B 的 getSync 收到后回 sync-reply（全量更新）→ B 应用后收敛。
    announceJoin(roomId, 'member-2', 'member-1')
    await new Promise((resolve) => {
      setTimeout(resolve, 30)
    })

    expect(b.ydoc.getMap('nodes').size).toBe(1)
    const n1 = b.ydoc.getMap('nodes').get('n1') as Y.Map<unknown>
    expect(n1.get('type')).toBe('RECTANGLE')

    // 双向回灌：B 写入 → A 也收敛（verify reverse direction）。
    b.ydoc.getMap('nodes').set('n2', new Y.Map([['type', 'ELLIPSE']]))
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(a.ydoc.getMap('nodes').size).toBe(2)
    const n2 = a.ydoc.getMap('nodes').get('n2') as Y.Map<unknown>
    expect(n2.get('type')).toBe('ELLIPSE')

    await a.conn.room.leave()
    await b.conn.room.leave()
  })

  test('joinRoom 被调用（默认传输路径可执行；未配置自定义配置时沿用官方默认）', () => {
    const roomId = randomUUID().slice(0, 8)
    joinedMembers.set(roomId, new Set())
    createConnection(roomId)
    expect(joinRoomSpy).toHaveBeenCalled()
  })

  test('REQ-3（RC-D）：relayUrls / ICE 配置**追加**官方默认而非独占', async () => {
    const roomId = randomUUID().slice(0, 8)
    joinedMembers.set(roomId, new Set())
    // 注入自定义 broker + ICE 后连接。config.ts 缓存是模块级单例；先 reset 再喂缓存。
    const configModule = await import('@/app/collab/config')
    configModule.resetCollabConfigCache()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      async json() {
        return {
          collab: {
            collabBrokerUrl: 'wss://custom-broker.local:9001/mqtt',
            collabIceServers: [{ urls: 'stun:custom-stun.local:3478' }],
            collabWsRelayUrl: null
          }
        }
      }
    })) as typeof fetch
    try {
      await configModule.getCollabConfig()
      expect(configModule.peekCollabConfig()?.collabBrokerUrl).toBe(
        'wss://custom-broker.local:9001/mqtt'
      )
      createConnection(roomId)
      // 断言：relayUrls = [自定义 broker, ...官方默认]；ICE = [自定义, ...官方默认]。
      const config = lastJoinConfig.config as {
        relayUrls?: string[]
        rtcConfig?: { iceServers: Array<{ urls: string | string[] }> }
      }
      expect(config.relayUrls?.[0]).toBe('wss://custom-broker.local:9001/mqtt')
      expect(config.relayUrls).toContain('wss://test.mosquitto.org:8081/mqtt')
      expect(config.relayUrls).toContain('wss://broker.emqx.io:8084/mqtt')
      expect(config.relayUrls).toContain('wss://broker.hivemq.com:8884/mqtt')
      // ICE：自定义在前，官方 STUN/TURN 兜底在后。
      expect(config.rtcConfig?.iceServers[0]?.urls).toBe('stun:custom-stun.local:3478')
      const urls = config.rtcConfig?.iceServers?.map((s) =>
        Array.isArray(s.urls) ? s.urls.join('|') : s.urls
      )
      expect(urls).toContain('stun:stun.l.google.com:19302')
      expect(urls).toContain('turn:openrelay.metered.ca:443')
    } finally {
      globalThis.fetch = originalFetch
      configModule.resetCollabConfigCache()
    }
  })
})
