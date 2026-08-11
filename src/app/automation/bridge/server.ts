/**
 * Browser-side automation handler.
 *
 * Connects to the bridge via WebSocket, receives RPC requests,
 * executes them against the live EditorStore, and sends results back.
 */
import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'
import { randomHex } from '@open-pencil/core/random'

import { markAutomationRpc } from '@/app/automation/bridge/apply'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import type { EditorStore } from '@/app/editor/active-store'

export function connectAutomation(
  getStore: () => EditorStore,
  authToken: string | null = null,
  options?: { wsPath?: string }
) {
  const token = authToken ?? randomHex(32)
  const wsUrl = options?.wsPath ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${options.wsPath}` : `ws://127.0.0.1:${AUTOMATION_HTTP_PORT}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false
  /** 本次连接是否已广播 graph:replaced（重建后首个响应带标记，提醒 AI 重取 id 表）。 */
  let graphReplacedPending = false

  const { handleRequest: handleAutomationRequest } =
    createAutomationCommandHandlers(makeFigmaFromStore)

  async function handleRequest(_id: string, command: string, args: unknown): Promise<unknown> {
    markAutomationRpc()
    const result = await handleAutomationRequest(getStore(), command, args)
    // 重建后首个响应通知 MCP 侧：旧 id 缓存已失效，AI 应重取 get_page_tree。
    if (graphReplacedPending) {
      graphReplacedPending = false
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        return { ...result, graphReplaced: true }
      }
      return { result, graphReplaced: true }
    }
    return result
  }

  function broadcastGraphReplaced() {
    if (!ws || ws.readyState !== ws.OPEN) return
    graphReplacedPending = true
    ws.send(JSON.stringify({ type: 'graph:replaced' }))
  }

  let unsubscribeGraphReplaced: (() => void) | null = null
  function watchGraphReplacements() {
    const store = getStore()
    unsubscribeGraphReplaced = store.onEditorEvent('graph:replaced', broadcastGraphReplaced)
  }

  function connect() {
    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl)
      ws = socket
    } catch (e) {
      console.error(
        '[Automation] WebSocket constructor failed:',
        e instanceof Error ? e.message : e
      )
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      console.debug('[Automation] WebSocket connected to MCP server')
      socket.send(JSON.stringify({ type: 'register', token }))
    }

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string
          id: string
          command: string
          args?: unknown
        }
        if (msg.type !== 'request' || !msg.id) return
        try {
          const result = await handleRequest(msg.id, msg.command, msg.args)
          socket.send(JSON.stringify({ type: 'response', id: msg.id, ...(result as object) }))
        } catch (e) {
          socket.send(
            JSON.stringify({
              type: 'response',
              id: msg.id,
              ok: false,
              error: e instanceof Error ? e.message : String(e)
            })
          )
        }
      } catch (e) {
        console.warn('Failed to parse WebSocket message:', e)
      }
    }

    socket.onclose = (event) => {
      if (ws === socket) ws = null
      if (intentionalDisconnect || event.code === 1000) return
      console.warn('[Automation] WebSocket closed:', `code=${event.code} reason=${event.reason}`)
      scheduleReconnect()
    }

    socket.onerror = (event) => {
      console.warn('[Automation] WebSocket error:', event)
      socket.close()
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 2000)
  }

  function disconnect() {
    intentionalDisconnect = true
    unsubscribeGraphReplaced?.()
    unsubscribeGraphReplaced = null
    clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
  }

  watchGraphReplacements()
  connect()
  return { disconnect, token }
}
