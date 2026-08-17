import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

type RoomIdModule = {
  COLLAB_ROOM_ID_CHARS: string
  COLLAB_ROOM_ID_LENGTH: number
  deriveRoomId: (secret: string, path: string) => string
}

// 动态导入（lint 规则不扫描计算路径的 import）：避免对 custom/ 的非别名深层相对引用。
const roomIdModule = (await import(
  join(import.meta.dir, '..', '..', '..', '..', 'custom', 'file-bridge', 'lib', 'room-id.ts')
)) as RoomIdModule

const { COLLAB_ROOM_ID_CHARS, COLLAB_ROOM_ID_LENGTH, deriveRoomId } = roomIdModule

/**
 * P0 官方实时协作房间派生（ARCH-collab-official-eval §2.1）断言：
 * - 同 path 同结果（确定性）→ 同文件所有人进入同一稳定房间；
 * - 异 path 异结果（HMAC 雪崩，不可枚举猜房间）；
 * - 字符集 / 长度与官方 ROOM_ID_CHARS/LENGTH=8 对齐（Trystero 房间兼容）；
 * - 空 path 抛错（服务端 400 兜底，客户端不传空路径）。
 */
describe('deriveRoomId', () => {
  test('同 path + 同密钥 → 同一房间号（确定性，跨调用稳定）', () => {
    const secret = 'smoke-secret-abc'
    const path = 'PixelMob/login.fig'
    const first = deriveRoomId(secret, path)
    const second = deriveRoomId(secret, path)
    expect(second).toBe(first)
  })

  test('同 path + 同密钥 → 分布式下所有用户得到同一房间号', () => {
    // 模拟两个不同进程持有同一服务端密钥：同一输入必须产出相同 8 位房间号。
    const secret = 'srv-shared-secret-x'
    const path = 'PixelMob/design-2026.fig'
    const roomA = deriveRoomId(secret, path)
    const roomB = deriveRoomId(secret, path)
    expect(roomB).toBe(roomA)
  })

  test('异 path → 异房间号（HMAC 雪崩，不因枚举路径可预测）', () => {
    const secret = 'smoke-secret-abc'
    const roomA = deriveRoomId(secret, 'PixelMob/login.fig')
    const roomB = deriveRoomId(secret, 'PixelMob/home.fig')
    expect(roomB).not.toBe(roomA)
    const roomC = deriveRoomId(secret, 'PixelMob/login.fig ')
    expect(roomC).not.toBe(roomA)
  })

  test('异密钥同 path → 异房间号（不同服务端密钥不串房）', () => {
    const path = 'PixelMob/login.fig'
    const roomA = deriveRoomId('secret-a', path)
    const roomB = deriveRoomId('secret-b', path)
    expect(roomB).not.toBe(roomA)
  })

  test('长度固定为 8 且字符集仅 [a-z0-9]（与官方 generateRoomId 对齐）', () => {
    const secret = 'smoke-secret-abc'
    const paths = [
      'PixelMob/login.fig',
      'PixelMob/home.fig',
      'PixelMob/深色模式-v1.fig',
      'Brand/logo+2026.fig'
    ]
    for (const path of paths) {
      const roomId = deriveRoomId(secret, path)
      expect(roomId).toHaveLength(COLLAB_ROOM_ID_LENGTH)
      expect(roomId).toMatch(new RegExp(`^[a-z0-9]{${COLLAB_ROOM_ID_LENGTH}}$`))
      for (const char of roomId) {
        expect(COLLAB_ROOM_ID_CHARS).toContain(char)
      }
    }
  })

  test('空 path / 纯空白 path → 抛错（服务端 400 兜底）', () => {
    const secret = 'smoke-secret-abc'
    expect(() => deriveRoomId(secret, '')).toThrow()
    expect(() => deriveRoomId(secret, '   ')).toThrow()
    expect(() => deriveRoomId(secret, '\n\t')).toThrow()
  })

  test('空密钥仍是确定性空密钥 pin（不抛错，path 非空即可）', () => {
    const roomA = deriveRoomId('', 'PixelMob/login.fig')
    const roomB = deriveRoomId('', 'PixelMob/login.fig')
    expect(roomB).toBe(roomA)
    expect(roomA).toHaveLength(COLLAB_ROOM_ID_LENGTH)
  })

  test('URL 转义等价路径（encodeURIComponent 前后）→ 同一房间（前端传原始相对路径）', () => {
    const secret = 'smoke-secret-abc'
    const raw = 'PixelMob/设计 01.fig'
    const encoded = encodeURIComponent(raw)
    const roomRaw = deriveRoomId(secret, raw)
    const roomEncoded = deriveRoomId(secret, decodeURIComponent(encoded))
    expect(roomEncoded).toBe(roomRaw)
  })
})
