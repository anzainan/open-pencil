import { createHmac } from 'node:crypto'

/**
 * 官方实时协作房间号派生（P0：同网多人实时协作）。
 *
 * 房间号不能直接拿 documentPath 当 ID（可枚举，破坏官方 crypto-safe 房间语义），
 * 由服务端鉴权后用服务端密钥对 path 做 HMAC-SHA256，截取前 8 字节映射到
 * [a-z0-9] 字符集 —— 与 `src/app/collab/awareness.ts` 的 `generateRoomId`
 * （ROOM_ID_CHARS / ROOM_ID_LENGTH = 8）同字符集、同长度，Trystero 房间完全兼容。
 *
 * 同一文件所有人拿到同一稳定房间号 → 同文件自动聚到同一房。
 */

export const COLLAB_ROOM_ID_LENGTH = 8
export const COLLAB_ROOM_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function deriveRoomId(secret: string, path: string): string {
  if (!path.trim()) {
    throw new Error('deriveRoomId requires a non-empty document path')
  }
  const digest = createHmac('sha256', secret).update(path).digest()
  let roomId = ''
  for (let i = 0; i < COLLAB_ROOM_ID_LENGTH; i++) {
    roomId += COLLAB_ROOM_ID_CHARS[digest[i] % COLLAB_ROOM_ID_CHARS.length]
  }
  return roomId
}