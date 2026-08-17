/**
 * 官方实时协作传输配置（P0）：拉取并缓存 file-bridge `/api/v1/config` 下发的 collab 字段。
 *
 * 首次调用 `getCollabConfig()` 触发一次 fetch 并缓存；后续同步读取用 `peekCollabConfig()`
 * （connectCollabRoom 是同步调用，不能 await，读缓存即可）。服务端未配置 / 不可达 /
 * 非 2xx → 缓存 null，调用方回退官方默认传输（mqtt.trystero.space + 官方 STUN/TURN）。
 * fetch 失败缓存 null 不重复打（与 BridgeClient.getConfig 同款惰性空缓存）。
 */

export interface CollabIceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface CollabTransportConfig {
  collabBrokerUrl: string | null
  collabIceServers: CollabIceServer[] | null
  collabWsRelayUrl: string | null
}

const API_BASE = '/api/v1'

let configPromise: Promise<CollabTransportConfig | null> | null = null
let cachedConfig: CollabTransportConfig | null = null

async function fetchCollabConfig(): Promise<CollabTransportConfig | null> {
  try {
    const response = await fetch(`${API_BASE}/config`)
    if (!response.ok) return null
    const data = (await response.json()) as { collab?: CollabTransportConfig | null } | null
    cachedConfig = data?.collab ?? null
    return cachedConfig
  } catch {
    cachedConfig = null
    return null
  }
}

/** 首次调用触发 fetch 并缓存（失败静默 → null）；已缓存/已拉取过直接返回结果。 */
export async function getCollabConfig(): Promise<CollabTransportConfig | null> {
  if (!configPromise) {
    configPromise = fetchCollabConfig()
  }
  return configPromise
}

/** 同步读当前缓存（未拉取完成 → null，room.ts 回退官方默认传输）。 */
export function peekCollabConfig(): CollabTransportConfig | null {
  return cachedConfig
}

/** 测试/预热用：清空缓存（下次 getCollabConfig 重新拉取）。 */
export function resetCollabConfigCache(): void {
  configPromise = null
  cachedConfig = null
}
