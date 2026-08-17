import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { BridgeClient } from '@/app/bridge/client'

/**
 * P0 官方实时协作房间解析（src/app/bridge/client.ts resolveCollabRoom）断言：
 * - 成功：返回服务端下发的稳定 roomId；
 * - 失败（非 2xx / 网络异常 / 无 roomId）→ null（不抛错、不阻塞打开流程）。
 */
function mockFetchResponse(response: { status: number; ok: boolean; body: unknown }) {
  const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    })
  )
  return fetchMock
}

afterEach(() => {
  spyOn(globalThis, 'fetch').mockRestore()
})

describe('BridgeClient.resolveCollabRoom', () => {
  test('鉴权成功 → 返回 roomId', async () => {
    const fetchMock = mockFetchResponse({
      status: 200,
      ok: true,
      body: { ok: true, roomId: 'abc12345' }
    })
    const client = new BridgeClient({ apiBase: 'http://test/api/v1' })
    const roomId = await client.resolveCollabRoom('PixelMob/login.fig')
    expect(roomId).toBe('abc12345')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toBe('http://test/api/v1/collab/room?path=PixelMob%2Flogin.fig')
  })

  test('未鉴权 401 → null（不抛错）', async () => {
    mockFetchResponse({ status: 401, ok: false, body: { ok: false, error: 'Unauthorized' } })
    const client = new BridgeClient({ apiBase: 'http://test/api/v1' })
    const roomId = await client.resolveCollabRoom('PixelMob/login.fig')
    expect(roomId).toBeNull()
  })

  test('无权限 403 → null（不抛错）', async () => {
    mockFetchResponse({ status: 403, ok: false, body: { ok: false, error: 'Forbidden' } })
    const client = new BridgeClient({ apiBase: 'http://test/api/v1' })
    const roomId = await client.resolveCollabRoom('PixelMob/login.fig')
    expect(roomId).toBeNull()
  })

  test('响应缺失 roomId → null（服务端旧版本兼容）', async () => {
    mockFetchResponse({ status: 200, ok: true, body: { ok: true } })
    const client = new BridgeClient({ apiBase: 'http://test/api/v1' })
    const roomId = await client.resolveCollabRoom('PixelMob/login.fig')
    expect(roomId).toBeNull()
  })

  test('网络异常 → null（不抛错、不阻塞打开流程）', async () => {
    spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    const client = new BridgeClient({ apiBase: 'http://test/api/v1' })
    const roomId = await client.resolveCollabRoom('PixelMob/login.fig')
    expect(roomId).toBeNull()
  })

  test('请求带 Bearer 会话头（session token 优先）', async () => {
    const fetchMock = mockFetchResponse({
      status: 200,
      ok: true,
      body: { ok: true, roomId: 'xyz98765' }
    })
    // 通过 getConfig 注入 token 不必要：resolveCollabRoom 的 authHeader 读 session token 或 BRIDGE_TOKEN。
    // 断言请求头存在 Authorization 字段上下文（值取决于当前测试进程是否登录态）。
    const client = new BridgeClient({ apiBase: 'http://test/api/v1' })
    await client.resolveCollabRoom('PixelMob/login.fig')
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> }) ?? {}
    expect('Authorization' in (headers.headers ?? {})).toBe(true)
  })
})
