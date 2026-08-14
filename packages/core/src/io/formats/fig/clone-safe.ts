/**
 * 数据安全深拷贝（clone-safe）。
 *
 * 保存链路（exportFigFile / snapshotPage）曾依赖原生 `structuredClone`，遇到内存图里
 * 任意可达的不可克隆值（函数、Symbol 值、类实例、Proxy、WeakMap/Promise 等）即抛
 * `DataCloneError`，导致「批量 AI 操作后保存崩溃」。本模块提供与 structuredClone 同
 * 语义覆盖「可序列化数据」的深拷贝，但遇到不可克隆值时**跳过该字段并告警**，而不是
 * 中断整次保存——非数据字段本就不该落盘，丢弃不损失数据。
 *
 * 覆盖类型：plain object / array / Map / Set / ArrayBuffer / TypedArray / DataView /
 * Date / 原始值。TypedArray（images / textPicture / figSchemaDeflated / blobs）按字节
 * 拷贝，避免 JSON 方案的二进制破坏；字节视图与 schema 落盘格式零变化。
 *
 * 这是上游 bc79d16a 引入 structuredClone 的同链路合规修复（packages/core 仅动
 * export.ts / snapshot.ts 两处 + 本新文件）。
 */
export type CloneSkipKind =
  | 'function'
  | 'symbol'
  | 'weak-map'
  | 'weak-set'
  | 'promise'
  | 'regexp'
  | 'error'
  | 'class-instance'
  | 'proxy'

export interface CloneSkipReport {
  /** 相对被拷贝值的字段路径，如 `fills/0/color`。 */
  path: string
  kind: CloneSkipKind
}

/** 数据字段的可枚举记录对象。 */
interface DataRecord {
  [key: string]: unknown
}

interface ValueClass {
  cloneable: boolean
  kind: 'empty' | 'primitive' | 'typed-array' | 'array-buffer' | 'date' | 'map' | 'set' | 'plain' | CloneSkipKind
}

function classify(value: unknown): ValueClass {
  if (value === null || value === undefined) return { cloneable: true, kind: 'empty' }
  if (typeof value !== 'object') {
    if (typeof value === 'function') return { cloneable: false, kind: 'function' }
    if (typeof value === 'symbol') return { cloneable: false, kind: 'symbol' }
    return { cloneable: true, kind: 'primitive' }
  }
  if (ArrayBuffer.isView(value)) return { cloneable: true, kind: 'typed-array' }
  if (value instanceof ArrayBuffer) return { cloneable: true, kind: 'array-buffer' }
  if (value instanceof Date) return { cloneable: true, kind: 'date' }
  if (value instanceof Map) return { cloneable: true, kind: 'map' }
  if (value instanceof Set) return { cloneable: true, kind: 'set' }
  if (value instanceof WeakMap) return { cloneable: false, kind: 'weak-map' }
  if (value instanceof WeakSet) return { cloneable: false, kind: 'weak-set' }
  if (value instanceof Promise) return { cloneable: false, kind: 'promise' }
  if (value instanceof RegExp) return { cloneable: false, kind: 'regexp' }
  if (value instanceof Error) return { cloneable: false, kind: 'error' }
  if (Array.isArray(value)) return { cloneable: true, kind: 'plain' }
  try {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      return { cloneable: false, kind: 'class-instance' }
    }
  } catch {
    return { cloneable: false, kind: 'proxy' }
  }
  return { cloneable: true, kind: 'plain' }
}

function reportSkip(path: string, kind: CloneSkipKind, onSkip?: (path: string, kind: CloneSkipKind) => void): void {
  onSkip?.(path, kind)
}

function cloneTypedArray(view: ArrayBufferView): ArrayBufferView {
  const bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
  if (view instanceof DataView) return new DataView(bytes, 0, view.byteLength)
  const Ctor = view.constructor as new (buffer: ArrayBuffer) => ArrayBufferView
  return new Ctor(bytes as ArrayBuffer)
}

function cloneValue(value: unknown, path: string, onSkip?: (path: string, kind: CloneSkipKind) => void): unknown {
  const cls = classify(value)
  if (!cls.cloneable) {
    reportSkip(path, cls.kind as CloneSkipKind, onSkip)
    return undefined
  }
  switch (cls.kind) {
    case 'empty':
    case 'primitive':
      return value
    case 'typed-array':
      return cloneTypedArray(value as ArrayBufferView)
    case 'array-buffer':
      return (value as ArrayBuffer).slice(0)
    case 'date':
      return new Date(value as Date)
    case 'map': {
      const out = new Map<unknown, unknown>()
      for (const [key, entry] of value as Map<unknown, unknown>) {
        out.set(cloneValue(key, `${path}→key`, onSkip), cloneValue(entry, `${path}→value`, onSkip))
      }
      return out
    }
    case 'set': {
      const out = new Set<unknown>()
      for (const entry of value as Set<unknown>) {
        out.add(cloneValue(entry, `${path}→value`, onSkip))
      }
      return out
    }
    case 'plain': {
      try {
        if (Array.isArray(value)) {
          const out: unknown[] = []
          for (let index = 0; index < value.length; index++) {
            const entry = value[index]
            const cloned = cloneValue(entry, `${path}[${index}]`, onSkip)
            if (entry === undefined || cloned !== undefined) out.push(cloned)
          }
          return out
        }
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(value as DataRecord)) {
          out[key] = cloneValue((value as DataRecord)[key], `${path}/${key}`, onSkip)
        }
        return out
      } catch {
        reportSkip(path, 'proxy', onSkip)
        return undefined
      }
    }
  }
  return undefined
}

/**
 * 数据安全深拷贝：返回值与原值等价的纯数据副本；遇不可克隆字段跳过并回调 `onSkip`。
 * 不修改输入值，永不抛 DataCloneError。
 */
export function dataSafeClone<T>(
  value: T,
  onSkip?: (path: string, kind: CloneSkipKind) => void
): T {
  return cloneValue(value, 'root', onSkip) as T
}
