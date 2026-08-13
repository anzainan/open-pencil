import { statSync, watch, type FSWatcher } from 'node:fs'
import { join, sep } from 'node:path'

import { ALLOWED_DESIGN_EXTENSIONS, TRASH_REL_DIR } from './paths'

export type EventType =
  | 'hello'
  | 'ping'
  | 'file.changed'
  | 'file.created'
  | 'file.deleted'
  | 'active.changed'

export interface BroadcastEvent {
  type: EventType
  data: Record<string, unknown>
  seq: number
}

type Listener = (event: BroadcastEvent) => void

/** 简单事件总线：SSE 连接订阅 + 广播（带单调序号）。心跳 ping 由总线统一发。 */
export class EventBus {
  private listeners = new Set<Listener>()
  private seq = 0
  private pingTimer?: ReturnType<typeof setInterval>

  constructor(pingIntervalMs = 25_000) {
    if (pingIntervalMs > 0) {
      this.pingTimer = setInterval(() => this.broadcast('ping', {}), pingIntervalMs)
      this.pingTimer.unref?.()
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  broadcast(type: EventType, data: Record<string, unknown> = {}): BroadcastEvent {
    const event: BroadcastEvent = { type, data, seq: ++this.seq }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[events] listener error', error)
      }
    }
    return event
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.listeners.clear()
  }
}

export interface WatchEvent {
  type: 'file.changed' | 'file.created' | 'file.deleted'
  path: string
  brand: string
}

/**
 * 递归监听设计目录（fs.watch recursive）。维护 known 集合区分 created/changed；
 * 短防抖合并同一路径的密集事件；reconcile() 提供对丢失事件的兜底校正。
 */
export class FileWatcher {
  private known = new Set<string>()
  private pending = new Map<string, ReturnType<typeof setTimeout>>()
  private watcher?: FSWatcher
  private stopped = false

  constructor(
    private readonly root: string,
    private readonly onEvent: (event: WatchEvent) => void,
    private readonly debounceMs = 80
  ) {}

  seed(paths: string[]): void {
    this.known = new Set(paths)
  }

  start(): boolean {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (this.stopped || typeof filename !== 'string') return
        const rel = filename.split(sep).join('/')
        if (!ALLOWED_DESIGN_EXTENSIONS.test(rel)) return
        if (isTrashRelPath(rel)) return
        this.schedule(rel)
      })
      this.watcher.on('error', (error) => console.error('[file-watcher]', error))
      return true
    } catch (error) {
      console.error('[file-watcher] failed to start:', error)
      return false
    }
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
    this.watcher?.close()
  }

  private schedule(rel: string): void {
    const prev = this.pending.get(rel)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      this.pending.delete(rel)
      this.handle(rel)
    }, this.debounceMs)
    this.pending.set(rel, timer)
  }

  private handle(rel: string): void {
    if (isTrashRelPath(rel)) return
    const full = join(this.root, rel)
    let isFile = false
    try {
      isFile = statSync(full).isFile()
    } catch {
      isFile = false
    }
    if (isFile) {
      if (this.known.has(rel)) {
        this.emit('file.changed', rel)
      } else {
        this.known.add(rel)
        this.emit('file.created', rel)
      }
    } else if (this.known.delete(rel)) {
      this.emit('file.deleted', rel)
    }
  }

  private emit(type: WatchEvent['type'], rel: string): void {
    this.onEvent({ type, path: rel, brand: rel.split('/')[0] ?? '' })
  }

  /** 用一次扫描结果校准 known 集合，补齐漏掉的事件（品牌目录改名、inotify 溢出等）。 */
  reconcile(files: { path: string }[]): void {
    const actual = new Set(files.map((file) => file.path))
    for (const rel of [...this.known]) {
      if (!actual.has(rel)) {
        this.known.delete(rel)
        this.emit('file.deleted', rel)
      }
    }
    for (const rel of actual) {
      if (!this.known.has(rel)) {
        this.known.add(rel)
        this.emit('file.created', rel)
      }
    }
  }
}

function isTrashRelPath(rel: string): boolean {
  return rel === TRASH_REL_DIR || rel.startsWith(`${TRASH_REL_DIR}/`)
}

/** 构造 SSE 响应；连接断开时取消订阅（Bun 会在流关闭时调用 cancel）。 */
export function sseResponse(bus: EventBus, hello: Record<string, unknown> = {}): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: BroadcastEvent): void => {
        let chunk = `event: ${event.type}\n`
        chunk += `data: ${JSON.stringify(event.data)}\n`
        chunk += `id: ${event.seq}\n\n`
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          // 流已关闭
        }
      }
      unsubscribe = bus.subscribe(send)
      send({ type: 'hello', data: { ...hello }, seq: 0 })
    },
    cancel() {
      unsubscribe?.()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
}
