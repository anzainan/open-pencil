import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { getCollabConfig, peekCollabConfig, resetCollabConfigCache } from '@/app/collab/config'

/**
 * P0 官方实时协作传输配置（src/app/collab/config.ts）断言：
 * - 成功拉取：collab 字段完整透传（broker / ice / ws relay）；
 * - 失败静默回退 null（fetch 抛异常 / 非 2xx / 无 collab 字段），不抛错不阻塞；
 * - 缓存语义：重复调用只发一次请求；reset 后可重新拉取。
 */
function mockFetch(response: { ok: boolean; json: unknown } | (() => Promise<unknown>)) {
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const value =
      typeof response === 'function'
        ? await response()
        : (response as { ok: boolean; json: unknown })
    return {
      ok: value.ok,
      async json() {
        return value.json
      }
    } as Response
  })
  return fetchMock
}

function mockFetchError() {
  const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
  return fetchMock
}

const collabPayload = {
  collab: {
    collabBrokerUrl: 'wss://184.3.123.56:9001/mqtt',
    collabIceServers: [{ urls: ['stun:10.0.0.1:3478'] }],
    collabWsRelayUrl: 'wss://hub.local/collab-ws'
  }
}

afterEach(() => {
  resetCollabConfigCache()
  spyOn(globalThis, 'fetch').mockRestore()
})

describe('collab/config', () => {
  test('成功拉取：透传 collab 三个字段（broker / ice / ws relay）', async () => {
    const fetchMock = mockFetch({ ok: true, json: collabPayload })
    const config = await getCollabConfig()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(config).toEqual(collabPayload.collab)
    expect(config?.collabBrokerUrl).toBe('wss://184.3.123.56:9001/mqtt')
    expect(config?.collabIceServers).toEqual([{ urls: ['stun:10.0.0.1:3478'] }])
    expect(config?.collabWsRelayUrl).toBe('wss://hub.local/collab-ws')
  })

  test('缓存语义：重复调用只发一次请求（首个结果被缓存复用）', async () => {
    const fetchMock = mockFetch({ ok: true, json: collabPayload })
    const first = await getCollabConfig()
    const second = await getCollabConfig()
    const third = await getCollabConfig()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  test('p eek 同步读：拉取前为 null，拉取后为已缓存配置', async () => {
    mockFetch({ ok: true, json: collabPayload })
    // 未拉取前：同步读为 null（room.ts 回退官方默认，不阻塞连接）。
    expect(peekCollabConfig()).toBeNull()
    await getCollabConfig()
    expect(peekCollabConfig()).toEqual(collabPayload.collab)
  })

  test('失败静默回退：fetch 抛异常 → null 且不抛错', async () => {
    const fetchMock = mockFetchError()
    const config = await getCollabConfig()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(config).toBeNull()
    // 失败缓存 null：后续调用不再重发包（不产生异常风暴）
    const second = await getCollabConfig()
    expect(second).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('失败静默回退：非 2xx（401）→ null（服务端未部署 collab 通道时兼容）', async () => {
    mockFetch({ ok: false, json: { error: 'Unauthorized' } })
    const config = await getCollabConfig()
    expect(config).toBeNull()
  })

  test('失败静默回退：响应无 collab 字段（旧服务端）→ null', async () => {
    mockFetch({ ok: true, json: { version: '0.2.0', token: 'x' } })
    const config = await getCollabConfig()
    expect(config).toBeNull()
  })

  test('reset 清缓存：失败缓存 null 后可重新拉取（测试/预热用）', async () => {
    const fetchMock = mockFetchError()
    expect(await getCollabConfig()).toBeNull()
    fetchMock.mockRestore()
    const goodMock = mockFetch({ ok: true, json: collabPayload })
    resetCollabConfigCache()
    const config = await getCollabConfig()
    expect(goodMock).toHaveBeenCalledTimes(1)
    expect(config).toEqual(collabPayload.collab)
  })
})
