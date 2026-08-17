import type { Color } from '@open-pencil/scene-graph/primitives'

export interface RemotePeer {
  clientId: number
  name: string
  color: Color
  /** P0 身份注入：远端账号头像（URL 字符串，不塞 blob；缺省回落字符+底色渲染）。 */
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
