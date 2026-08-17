import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import type { connectCollabSession } from '@/app/collab/session'

import * as Y from 'yjs'

/**
 * REQ-2（RC-B）：y-indexeddb 缓存回灌时序。
 *
 * 根因：session.ts 在 IndexeddbPersistence 建立后立刻注册 Yjs 观测器，旧会话缓存以异步
 * IDB 载入的方式回灌，覆盖新图并 bump sceneVersion → autosave 写旧盘。修法：初次载入
 * 完成前 `suppressYjsEvents=true` 闸住回灌，`whenSynced` resolve 后复位并全量压过缓存。
 *
 * 本测试用模块 mock 替代 IndexeddbPersistence 与 Trystero，验证时序：
 *  1. connect 后（载入完成前）suppressYjsEvents === true；
 *  2. whenSynced 尚未 resolve 时 observer 回调被闸住（applyYjsToGraph 不被调用）；
 *  3. whenSynced resolve 后 suppressYjsEvents === false 且 syncAllNodesToYjs 被调用
 *     （用当前图压过缓存，LWW 定序收口）。
 */

type Deferred<T> = { resolve: (v: T) => void; reject: (e: unknown) => void; promise: Promise<T> }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { resolve, reject, promise }
}

// y-indexeddb mock：IndexeddbPersistence 暴露出 whenSynced（挂到 mock 便于测试控制）。
const mockPersistenceState = {
  whenSynced: null as Deferred<unknown> | null,
  instances: [] as Array<{ destroy: () => void }>
}
class IndexeddbPersistenceMock {
  whenSynced: Promise<unknown>
  destroy = () => undefined

  constructor(_name: string, _doc: Y.Doc) {
    mockPersistenceState.whenSynced = deferred()
    this.whenSynced = mockPersistenceState.whenSynced.promise
    mockPersistenceState.instances.push(this)
  }
}

mock.module('y-indexeddb', () => ({
  IndexeddbPersistence: IndexeddbPersistenceMock
}))

// trystero mock：joinRoom 返回最小可 leave 的 room。
const joinRoomSpy = mock((_config: object, _roomId: string) => ({
  makeAction: () => [(_data: unknown) => undefined, (_fn: unknown) => undefined],
  onPeerJoin: (_fn: unknown) => undefined,
  onPeerLeave: (_fn: unknown) => undefined,
  leave: () => Promise.resolve()
}))
mock.module('trystero/mqtt', () => ({
  joinRoom: joinRoomSpy
}))

let connectSession: typeof connectCollabSession
beforeAll(async () => {
  const sessionMod = await import('@/app/collab/session')
  connectSession = sessionMod.connectCollabSession
})

function fakeStore(): Parameters<typeof connectSession>[0]['store'] {
  const store: unknown = {
    graph: {
      getAllNodes: () => [] as unknown[],
      getNode: () => null,
      images: new Map()
    },
    state: { remoteCursors: [] },
    onEditorEvent: () => () => undefined,
    requestRender: mock(() => undefined),
    undo: { canUndo: false, undo: () => undefined }
  }
  return store as Parameters<typeof connectSession>[0]['store']
}

function createHarness() {
  const runtime = {
    ydoc: new Y.Doc(),
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
  const state = { value: { connected: false, roomId: null, peers: [] } }
  const calls = { applyYjsToGraph: 0, syncAllNodesToYjs: 0, syncNodeToYjs: 0 }
  connectSession({
    roomId: randomUUID().slice(0, 8),
    runtime,
    state,
    store: fakeStore(),
    disconnect: () => undefined,
    updatePeersList: () => undefined,
    tickFollow: () => undefined,
    broadcastAwareness: () => undefined,
    applyYjsToGraph: () => {
      calls.applyYjsToGraph++
    },
    syncNodeToYjs: () => {
      calls.syncNodeToYjs++
    },
    syncAllNodesToYjs: () => {
      calls.syncAllNodesToYjs++
    }
  })
  return { runtime, state, calls }
}

afterEach(() => {
  mockPersistenceState.whenSynced = null
  mockPersistenceState.instances = []
})

describe('connectCollabSession y-indexeddb 载入时序（REQ-2/RC-B）', () => {
  test('载入完成前闸住回灌（suppressYjsEvents=true），完成后复位并压过缓存', async () => {
    const { runtime, calls } = createHarness()

    // 1) connect 后（IDB 尚未 resolve）：suppressYjsEvents 应为 true（闸住旧缓存回灌）。
    expect(runtime.suppressYjsEvents).toBe(true)

    // 模拟 IDB 异步载入期间 ydoc 收到旧缓存更新：观测器被闸住，applyYjsToGraph 不被调用。
    const ynodes = runtime.ydoc.getMap('nodes')
    ynodes.set('stale', new Y.Map([['name', 'OLD']]))
    expect(calls.applyYjsToGraph).toBe(0)

    // 2) 初次载入完成 → whenSynced resolve：复位闸 + 用当前图压过缓存。
    const persistenceDeferred = mockPersistenceState.whenSynced
    expect(persistenceDeferred).not.toBeNull()
    persistenceDeferred?.resolve(null)
    // 链上 .catch().then() 需要完整微任务刷新后再断言。
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    // 微任务队列刷新后：
    expect(runtime.suppressYjsEvents).toBe(false)
    expect(calls.syncAllNodesToYjs).toBe(1)
  })
})
