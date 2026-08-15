import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** AES-256-GCM 密文载荷（iv 12 字节随机、data = 密文 + GCM tag，均 base64）。 */
export interface PasswordCipher {
  iv: string
  data: string
}

/**
 * 加密 key：`PASSWORD_ENC_KEY` 环境变量任意口令 → sha256 派生 32 字节 AES-256 key。
 * 未配置 → null（优雅降级：不落明文副本、回显空，不影响 scrypt 登录/验证链路）。
 */
function encryptionKey(): Buffer | null {
  const raw = process.env.PASSWORD_ENC_KEY?.trim() || ''
  if (!raw) return null
  return createHash('sha256').update(raw).digest()
}

/** 明文 → AES-256-GCM 密文副本（无 key / 失败 → null，不抛错）。 */
export function encryptPassword(plain: string): PasswordCipher | null {
  if (!plain) return null
  const key = encryptionKey()
  if (!key) return null
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return { iv: iv.toString('base64'), data: Buffer.concat([encrypted, tag]).toString('base64') }
  } catch {
    return null
  }
}

/** 密文副本 → 明文。缺 key / 解不出（key 变更 / 损坏）→ null，不抛错不降级明文。 */
export function decryptPassword(cipher: PasswordCipher | null | undefined): string | null {
  if (!cipher || typeof cipher.iv !== 'string' || typeof cipher.data !== 'string') return null
  const key = encryptionKey()
  if (!key) return null
  try {
    const iv = Buffer.from(cipher.iv, 'base64')
    const payload = Buffer.from(cipher.data, 'base64')
    const data = payload.subarray(0, -16)
    const tag = payload.subarray(-16)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
