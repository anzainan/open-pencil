import type { Color } from '@open-pencil/scene-graph/primitives'

export interface RemotePeer {
  clientId: number
  name: string
  color: Color
  /** 兼容字段：官方 awareness 不再下发，仅 CollabPanel context（白名单文件）读取，恒为 undefined。 */
  avatarImage?: string | null
  avatarBg?: string | null
  cursor?: { x: number; y: number; pageId: string }
  selection?: string[]
}

export interface CollabState {
  connected: boolean
  roomId: string | null
  peers: RemotePeer[]
  localName: string
  localColor: Color
}

export const DEFAULT_COLLAB_STATE: CollabState = {
  connected: false,
  roomId: null,
  peers: [],
  localName: '',
  localColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 }
}
