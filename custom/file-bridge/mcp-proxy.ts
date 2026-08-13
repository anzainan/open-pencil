/**
 * Optional upstream MCP server integration for file-bridge.
 *
 * When `MCP_AUTH_TOKEN` is configured, file-bridge either spawns the upstream
 * `@open-pencil/mcp` server as a child process (default) or proxies to an
 * externally-running instance (`MCP_HTTP_URL`), then reverse-proxies the MCP
 * HTTP/WebSocket surface to the same origin the web app is served from:
 *
 *   /mcp    -> http://127.0.0.1:<MCP_PORT>/mcp      (MCP Streamable HTTP)
 *   /rpc    -> http://127.0.0.1:<MCP_PORT>/rpc      (raw JSON-RPC envelope)
 *   /health -> http://127.0.0.1:<MCP_PORT>/health   (ok | no_app)
 *   /ws     -> ws://127.0.0.1:<MCP_PORT>/ws         (browser RPC WebSocket)
 *
 * This keeps the MCP listener bound to loopback inside the container while the
 * browser talks to the same origin as the app (no CORS, no LAN exposure of the
 * MCP port). The container is a pure relay — it never parses the canvas.
 *
 * Failure is graceful: if spawning fails or the MCP server exits, the proxy
 * reports not-ready (502 on forwarded calls) and file-bridge keeps serving the
 * rest of its API, matching the `no_app` degradation model.
 */
import { spawn } from 'node:child_process'
import type { Server, ServerWebSocket } from 'bun'

const MCP_START_TIMEOUT_MS = 10_000

export interface McpProxyOptions {
  enabled: boolean
  authToken: string | null
  /** Base URL of the MCP server, e.g. http://127.0.0.1:7600 */
  httpUrl: string
  /** WebSocket URL of the MCP server, e.g. ws://127.0.0.1:7600 */
  wsURL: string
  /** Optional explicit spawn command. When omitted, the default repo entry is used. */
  serverCmd?: string | null
  /** Working directory to resolve the default spawn command from (repo root). */
  spawnCwd: string
  /** Design root passed to the MCP server for file-scoped tools. */
  designRoot: string
  /** State dir used for the MCP discovery file. */
  stateDir: string
}

interface PipeState {
  buffer: string[]
  client: WebSocket | null
}

export interface McpProxyHandle {
  isReady: () => boolean
  forward: (request: Request) => Promise<Response>
  upgrade: (request: Request, server: Server) => boolean
  /** Bind a server-side WebSocket (from an accepted upgrade) to the MCP client socket. */
  pipe: (ws: ServerWebSocket) => void
  /** Forward an inbound browser WebSocket message to the MCP client socket. */
  forwardMessage: (ws: ServerWebSocket, message: string | Buffer) => void
  close: () => void
}

function forwardHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export function createMcpProxy(options: McpProxyOptions): McpProxyHandle {
  const { enabled, authToken, httpUrl, wsURL, serverCmd, spawnCwd, designRoot, stateDir } = options

  let child: ReturnType<typeof spawn> | null = null
  let ready = false

  if (!enabled) {
    return {
      isReady: () => false,
      forward: () => Promise.resolve(new Response('MCP proxy disabled', { status: 503 })),
      upgrade: () => false,
      pipe: () => undefined,
      forwardMessage: () => undefined,
      close: () => undefined
    }
  }

  async function probeHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${httpUrl}/health`, { signal: AbortSignal.timeout(1500) })
      return res.ok
    } catch {
      return false
    }
  }

  function waitForHealth(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    return new Promise<boolean>((resolve) => {
      const tick = async () => {
        if (await probeHealth()) {
          resolve(true)
          return
        }
        if (Date.now() >= deadline) {
          resolve(false)
          return
        }
        setTimeout(() => void tick(), 300)
      }
      void tick()
    })
  }

  function markReady(): void {
    ready = true
    console.log('[file-bridge] MCP proxy ready ->', httpUrl)
  }

  async function startSpawn(): Promise<void> {
    const command = serverCmd?.trim() || 'bun run packages/mcp/src/index.ts'
    const env = {
      PORT: new URL(httpUrl).port,
      OPENPENCIL_MCP_AUTH_TOKEN: authToken ?? '',
      // 容器 env 可覆盖 MCP 文件工具根目录（如导出目录），默认仍是设计工作区。
      OPENPENCIL_MCP_ROOT: process.env.OPENPENCIL_MCP_ROOT?.trim() || designRoot,
      OPENPENCIL_MCP_DISCOVERY_PATH: `${stateDir}/mcp.json`
    }
    try {
      child = spawn(command, {
        cwd: spawnCwd,
        shell: true,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, ...env }
      })
      child.on('error', (err) => {
        console.error(`[file-bridge] MCP spawn failed: ${err.message}`)
        child = null
      })
      child.on('exit', (code) => {
        console.error(`[file-bridge] MCP server exited (code ${code ?? 'null'})`)
        ready = false
        child = null
      })
      const ok = await waitForHealth(MCP_START_TIMEOUT_MS)
      if (ok) {
        markReady()
      } else {
        console.error(`[file-bridge] MCP server did not become healthy within ${MCP_START_TIMEOUT_MS}ms; proxy disabled`)
        child?.kill()
        child = null
      }
    } catch (err) {
      console.error(`[file-bridge] MCP spawn threw: ${err instanceof Error ? err.message : String(err)}`)
      child = null
    }
  }

  async function start(): Promise<void> {
    // External instance (MCP_HTTP_URL set) — no spawn, just probe.
    const external = Boolean(process.env.MCP_HTTP_URL)
    if (external) {
      const ok = await waitForHealth(MCP_START_TIMEOUT_MS)
      if (ok) markReady()
      else console.error('[file-bridge] External MCP server at', httpUrl, 'did not become healthy')
      return
    }
    await startSpawn()
  }

  void start()

  return {
    isReady: () => ready,
    async forward(request: Request): Promise<Response> {
      if (!ready) return new Response('MCP server not ready', { status: 502 })
      const url = new URL(request.url)
      const target = `${httpUrl}${url.pathname}${url.search}`
      try {
        const body =
          request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
        const res = await fetch(target, {
          method: request.method,
          headers: forwardHeaders(request.headers),
          body
        })
        return new Response(res.body, {
          status: res.status,
          headers: forwardHeaders(res.headers)
        })
      } catch (err) {
        return new Response(`MCP proxy error: ${err instanceof Error ? err.message : String(err)}`, {
          status: 502
        })
      }
    },
    upgrade(request: Request, server: Server): boolean {
      if (!ready) return false
      return server.upgrade(request, { data: {} })
    },
    pipe(ws: ServerWebSocket) {
      const state: PipeState = { buffer: [], client: null }
      ws.data = state
      const client = new WebSocket(wsURL)
      state.client = client
      client.binaryType = 'arraybuffer'
      client.onopen = () => {
        for (const msg of state.buffer) client.send(msg)
        state.buffer.length = 0
      }
      client.onmessage = (event: MessageEvent) => {
        try {
          ws.send(event.data as string)
        } catch {
          // Socket already closing — drop.
          // oxlint-ignore-next-line no-silent-catch
          void ws
        }
      }
      client.onclose = () => {
        try {
          ws.close(1000, 'MCP proxy closed')
        } catch {
          // already closed
          // oxlint-ignore-next-line no-silent-catch
          void ws
        }
      }
      client.onerror = () => {
        try {
          client.close()
        } catch {
          // already closed
          // oxlint-ignore-next-line no-silent-catch
          void client
        }
      }
    },
    forwardMessage(ws: ServerWebSocket, message: string | Buffer) {
      const state = ws.data as PipeState | undefined
      const client = state?.client
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(typeof message === 'string' ? message : message.toString('utf8'))
      } else {
        state?.buffer.push(typeof message === 'string' ? message : message.toString('utf8'))
      }
    },
    close() {
      child?.kill()
      child = null
      ready = false
    }
  }
}
