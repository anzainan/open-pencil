import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

import { ALLOWED_DESIGN_EXTENSIONS, OPENPENCIL_REL_DIR, SYSTEM_REL_DIRS } from './paths'

export interface ManifestData {
  version: 1
  /** 经首页「新建项目」（POST /dirs）登记的文件夹，相对 designRoot。 */
  folders: string[]
  /** 经工作区新建/保存（PUT /files 首次写盘、rename/move/restore 同步）登记的文件，相对 designRoot。 */
  files: string[]
}

const MANIFEST_VERSION = 1

function norm(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '')
}

function normalizeList(list: string[]): string[] {
  return [...new Set(list.map(norm).filter(Boolean))].sort((a, b) => a.localeCompare(b))
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
  private data: ManifestData = { version: MANIFEST_VERSION, folders: [], files: [] }
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
          files: Array.isArray(raw.files) ? normalizeList(raw.files.map(String)) : []
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
    this.persist()
  }

  /** 移除路径及其子路径（用于彻底删除 / 回收站软删，join 兜底之外保持台账干净）。 */
  removePath(path: string): void {
    const rel = norm(path)
    const next = (list: string[]): string[] =>
      normalizeList(list.filter((p) => p !== rel && !p.startsWith(`${rel}/`)))
    this.data.folders = next(this.data.folders)
    this.data.files = next(this.data.files)
    this.persist()
  }
}
