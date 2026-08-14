import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

import { ALLOWED_DESIGN_EXTENSIONS, OPENPENCIL_REL_DIR, SYSTEM_REL_DIRS } from './paths'

export interface ManifestPinEntry {
  /** 被置顶文件夹的相对路径（相对 designRoot，顶层文件夹名）。 */
  name: string
  /** 置顶时间（ISO），同文件夹重复置顶刷新为最新；首页按倒序排最前。 */
  pinnedAt: string
}

export interface ManifestData {
  version: 1
  /** 经首页「新建项目」（POST /dirs）登记的文件夹，相对 designRoot。 */
  folders: string[]
  /** 经工作区新建/保存（PUT /files 首次写盘、rename/move/restore 同步）登记的文件，相对 designRoot。 */
  files: string[]
  /** 首页文件夹置顶台账（Phase 5 新功能）：多文件夹、置顶时间倒序、可取消；独立字段，旧台账兼容。 */
  pinnedFolders: ManifestPinEntry[]
}

const MANIFEST_VERSION = 1

function norm(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '')
}

function normalizeList(list: string[]): string[] {
  return [...new Set(list.map(norm).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** 置顶台账规范化：去重（同名保留最新 pinnedAt）、剔空、按 pinnedAt 倒序（最后置顶的最前）。 */
function normalizePins(list: ManifestPinEntry[]): ManifestPinEntry[] {
  const byName = new Map<string, string>()
  for (const entry of list) {
    const name = norm(String(entry?.name ?? ''))
    if (!name) continue
    const pinnedAt = String(entry?.pinnedAt ?? '')
    const previous = byName.get(name)
    if (!previous || pinnedAt > previous) byName.set(name, pinnedAt)
  }
  return [...byName.entries()]
    .map(([name, pinnedAt]) => ({ name, pinnedAt }))
    .sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt))
}

/** 将 from 前缀整体改写为 to（from 本身或 from/ 下任意子路径）。 */
function rewritePrefix(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

/** 迁移排除判断（任意层级）：`.` 开头段（.trash/.openpencil/隐藏文件/目录）或系统目录段（assets/fonts/lost+found）。 */
function isExcludedRel(rel: string): boolean {
  return rel.split('/').some((segment) => segment.startsWith('.') || SYSTEM_REL_DIRS.includes(segment))
}

/**
 * homepage 可见性白名单台账（方案 A）：
 * 只展示经首页/工作区「创建」链路登记的内容；物理文件不动，台账存于
 * `designRoot/.openpencil/index.json`（与 `.trash` 同级，进扫描排除表）。
 * 安全兜底：所有列表输出均为「台账条目 ∩ 实盘」（join），漏登记/已删 = 不显示。
 */
export class Manifest {
  private data: ManifestData = {
    version: MANIFEST_VERSION,
    folders: [],
    files: [],
    pinnedFolders: []
  }
  private readonly file: string

  constructor(private readonly root: string) {
    this.file = join(root, OPENPENCIL_REL_DIR, 'index.json')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) {
        this.migrate()
        return
      }
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ManifestData>
      if (typeof raw === 'object') {
        this.data = {
          version: MANIFEST_VERSION,
          folders: Array.isArray(raw.folders) ? normalizeList(raw.folders.map(String)) : [],
          files: Array.isArray(raw.files) ? normalizeList(raw.files.map(String)) : [],
          // 旧台账无 pinnedFolders → 空数组；合法数组直接规范化（防破坏兼容）。
          pinnedFolders: Array.isArray(raw.pinnedFolders)
            ? normalizePins(
                raw.pinnedFolders.map((entry) => ({
                  name: String((entry as { name?: unknown })?.name ?? ''),
                  pinnedAt: String((entry as { pinnedAt?: unknown })?.pinnedAt ?? '')
                }))
              )
            : []
        }
      }
    } catch (error) {
      // 文件损坏 → 空台账（宁可少显示），不影响服务启动。
      console.warn('[file-bridge] manifest load failed, using empty ledger', error)
    }
  }

  /**
   * 台账首次初始化迁移实盘存量：台账文件不存在时（隔离方案上线前已存在的用户内容），
   * 递归扫描 designRoot 将用户文件夹与 .fig/.pen 文件登记入台账，再落盘。
   * 隐藏项（. 开头）与系统目录（assets/fonts/lost+found）任意层级一律跳过、不递归。
   * 幂等：仅当台账不存在时执行；台账已存在（含手工恢复）不触碰不覆盖。
   */
  private migrate(): void {
    const folders: string[] = []
    const files: string[] = []

    const walk = (dir: string, relDir: string): void => {
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name
        if (isExcludedRel(rel)) continue
        if (entry.isDirectory()) {
          folders.push(rel)
          walk(join(dir, entry.name), rel)
        } else if (entry.isFile() && ALLOWED_DESIGN_EXTENSIONS.test(entry.name)) {
          files.push(rel)
        }
      }
    }
    walk(this.root, '')

    this.data.folders = normalizeList(folders)
    this.data.files = normalizeList(files)
    this.persist()
  }

  private persist(): void {
    try {
      mkdirSync(join(this.root, OPENPENCIL_REL_DIR), { recursive: true })
    } catch (error) {
      console.warn('[file-bridge] manifest dir create failed', error)
    }
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  get folders(): string[] {
    return [...this.data.folders]
  }

  get files(): string[] {
    return [...this.data.files]
  }

  /** 首页置顶台账（pinnedAt 倒序：最后置顶的最前）。 */
  get pins(): ManifestPinEntry[] {
    return this.data.pinnedFolders.map((entry) => ({ name: entry.name, pinnedAt: entry.pinnedAt }))
  }

  isPinned(rel: string): boolean {
    return this.data.pinnedFolders.some((entry) => entry.name === norm(rel))
  }

  /**
   * 置顶文件夹（幂等）：同文件夹重复置顶 → 刷新 pinnedAt 为最新，不产生重复条目。
   * 时间戳单调递增（同毫秒并发 → +1ms），保证「最后置顶的最前」稳定；
   * 排序由 normalizePins 统一按 pinnedAt 倒序维护。
   */
  pinFolder(path: string): ManifestPinEntry {
    const rel = norm(path)
    let pinnedAt = new Date().toISOString()
    let maxMs = 0
    for (const entry of this.data.pinnedFolders) {
      const ms = Date.parse(entry.pinnedAt)
      if (Number.isFinite(ms) && ms > maxMs) maxMs = ms
    }
    if (Date.parse(pinnedAt) <= maxMs) pinnedAt = new Date(maxMs + 1).toISOString()
    this.data.pinnedFolders = normalizePins([
      ...this.data.pinnedFolders.filter((entry) => entry.name !== rel),
      { name: rel, pinnedAt }
    ])
    this.persist()
    return { name: rel, pinnedAt }
  }

  /** 取消置顶。 */
  unpinFolder(path: string): void {
    const rel = norm(path)
    this.data.pinnedFolders = this.data.pinnedFolders.filter((entry) => entry.name !== rel)
    this.persist()
  }

  isFileRegistered(rel: string): boolean {
    return this.data.files.includes(norm(rel))
  }

  registerFile(path: string): void {
    const rel = norm(path)
    if (!rel || this.data.files.includes(rel)) return
    this.data.files = normalizeList([...this.data.files, rel])
    this.persist()
  }

  registerFolder(path: string): void {
    const rel = norm(path)
    if (!rel || this.data.folders.includes(rel)) return
    this.data.folders = normalizeList([...this.data.folders, rel])
    this.persist()
  }

  /** 路径整体改名/移动：同步所有受影响条目（含 from/ 子路径），用于 rename/move。 */
  renamePath(from: string, to: string): void {
    this.data.folders = normalizeList(this.data.folders.map((p) => rewritePrefix(p, from, to)))
    this.data.files = normalizeList(this.data.files.map((p) => rewritePrefix(p, from, to)))
    this.data.pinnedFolders = normalizePins(
      this.data.pinnedFolders.map((entry) => ({
        name: rewritePrefix(entry.name, from, to),
        pinnedAt: entry.pinnedAt
      }))
    )
    this.persist()
  }

  /** 移除路径及其子路径（用于彻底删除 / 回收站软删，join 兜底之外保持台账干净）。 */
  removePath(path: string): void {
    const rel = norm(path)
    const next = (list: string[]): string[] =>
      normalizeList(list.filter((p) => p !== rel && !p.startsWith(`${rel}/`)))
    this.data.folders = next(this.data.folders)
    this.data.files = next(this.data.files)
    // 文件夹被删除/回收 → 其置顶同步清除（不残留死条目）。
    this.data.pinnedFolders = normalizePins(
      this.data.pinnedFolders.filter((entry) => !(entry.name === rel || entry.name.startsWith(`${rel}/`)))
    )
    this.persist()
  }
}
