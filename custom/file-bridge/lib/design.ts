import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

import {
  ALLOWED_DESIGN_EXTENSIONS,
  ALLOWED_FONT_EXTENSIONS,
  FONTS_REL_DIR,
  isHiddenRelDir,
  TRASH_REL_DIR
} from './paths'

export interface DesignFileInfo {
  path: string
  name: string
  ext: string
  size: number
  mtime: string
  updatedAt: string
}

export interface TrashEntryInfo {
  path: string
  name: string
  ext: string
  type: 'file' | 'dir'
  size: number
  mtime: string
  updatedAt: string
}

export interface BrandGroup {
  brand: string
  files: DesignFileInfo[]
}

export interface DesignListing {
  groups: BrandGroup[]
  flat: DesignFileInfo[]
}

export function designFileExt(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
}

export function fileMeta(root: string, rel: string): DesignFileInfo | null {
  try {
    const st = statSync(join(root, rel))
    if (!st.isFile()) return null
    const name = rel.split('/').pop() ?? rel
    const mtime = st.mtime.toISOString()
    return { path: rel, name, ext: designFileExt(rel), size: st.size, mtime, updatedAt: mtime }
  } catch {
    return null
  }
}

/** 递归扫描设计目录，按顶层品牌目录分组。根目录下的散文件归入 brand: ''。回收站与内部隐藏目录被排除。 */
export function scanDesignRoot(root: string): DesignListing {
  const byBrand = new Map<string, DesignFileInfo[]>()
  const flat: DesignFileInfo[] = []

  const walk = (dir: string, relDir: string) => {
    if (isHiddenRelDir(relDir)) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel)
      } else if (entry.isFile() && ALLOWED_DESIGN_EXTENSIONS.test(entry.name)) {
        const info = fileMeta(root, rel)
        if (!info) continue
        flat.push(info)
        const brand = relDir.split('/')[0] ?? ''
        const list = byBrand.get(brand)
        if (list) list.push(info)
        else byBrand.set(brand, [info])
      }
    }
  }
  walk(root, '')

  flat.sort((a, b) => a.path.localeCompare(b.path))
  const groups: BrandGroup[] = [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, files]) => ({ brand, files: files.sort((a, b) => a.path.localeCompare(b.path)) }))

  return { groups, flat }
}

/** 台账 join：只返回台账登记且实盘存在的文件（漏登记/已删 → 不显示，安全侧冗余）。 */
export function scanManifestFiles(root: string, registered: string[]): DesignFileInfo[] {
  const out: DesignFileInfo[] = []
  for (const rel of registered) {
    const info = fileMeta(root, rel)
    if (info) out.push(info)
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** 台账 join：只返回台账登记且实盘存在的目录（含空目录，漏登记 → 不显示）。 */
export function scanManifestDirs(root: string, registered: string[]): string[] {
  const out: string[] = []
  for (const rel of registered) {
    if (rel === '.trash' || rel.startsWith('.trash/') || rel.startsWith('.openpencil')) continue
    if (isDirectory(join(root, rel))) out.push(rel)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 由平铺文件清单构建与 scanDesignRoot 同构的 { groups, flat } 列表。 */
export function listingFromFiles(files: DesignFileInfo[]): DesignListing {
  const flat = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const byBrand = new Map<string, DesignFileInfo[]>()
  for (const info of flat) {
    const brand = info.path.includes('/') ? info.path.split('/')[0] : ''
    const list = byBrand.get(brand)
    if (list) list.push(info)
    else byBrand.set(brand, [info])
  }
  const groups: BrandGroup[] = [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, files]) => ({ brand, files }))
  return { groups, flat }
}

/** 递归列目录（含空文件夹），返回相对设计根的目录路径。回收站与内部隐藏目录被排除。 */
export function scanDesignDirs(root: string): string[] {
  const dirs: string[] = []

  const walk = (dir: string, relDir: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (isHiddenRelDir(rel)) continue
      dirs.push(rel)
      walk(join(dir, entry.name), rel)
    }
  }
  walk(root, '')

  return dirs.sort((a, b) => a.localeCompare(b))
}

/** 扫描回收站 `.trash/`：path 为原相对路径（去掉 .trash 前缀），便于恢复。 */
export function scanTrashRoot(root: string): TrashEntryInfo[] {
  const out: TrashEntryInfo[] = []
  const trashRoot = join(root, TRASH_REL_DIR)

  const walk = (dir: string, relDir: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, rel)
        continue
      }
      if (!entry.isFile() || !ALLOWED_DESIGN_EXTENSIONS.test(entry.name)) continue
      const st = statSync(full)
      out.push({
        path: rel,
        name: entry.name,
        ext: designFileExt(rel),
        type: 'file',
        size: st.size,
        mtime: st.mtime.toISOString(),
        updatedAt: st.mtime.toISOString()
      })
    }
  }
  walk(trashRoot, '')

  // 顶层文件夹本身（无文件时也要能恢复/删除）。
  let entries: Dirent[]
  try {
    entries = readdirSync(trashRoot, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const rel = entry.name
    if (out.some((file) => file.path === rel || file.path.startsWith(`${rel}/`))) continue
    const full = join(trashRoot, entry.name)
    const st = statSync(full)
    out.push({
      path: rel,
      name: entry.name,
      ext: '',
      type: 'dir',
      size: st.size,
      mtime: st.mtime.toISOString(),
      updatedAt: st.mtime.toISOString()
    })
  }

  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export interface FontFileInfo {
  path: string
  name: string
  ext: string
  size: number
  mtime: string
  updatedAt: string
}

/** 递归扫描工作区 fonts/ 文件夹下的字体文件（ttf/otf/woff/woff2）。返回相对设计根的路径。 */
export function scanFontsRoot(root: string): FontFileInfo[] {
  const fontsRoot = join(root, FONTS_REL_DIR)
  const out: FontFileInfo[] = []

  const walk = (dir: string, relDir: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel)
      } else if (entry.isFile() && ALLOWED_FONT_EXTENSIONS.test(entry.name)) {
        const info = fileMeta(root, rel)
        if (!info) continue
        out.push(info)
      }
    }
  }
  walk(fontsRoot, FONTS_REL_DIR)

  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}
