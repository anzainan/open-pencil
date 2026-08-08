import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

import { ALLOWED_DESIGN_EXTENSIONS } from './paths'

export interface DesignFileInfo {
  path: string
  name: string
  ext: string
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

/** 递归扫描设计目录，按顶层品牌目录分组。根目录下的散文件归入 brand: ''。 */
export function scanDesignRoot(root: string): DesignListing {
  const byBrand = new Map<string, DesignFileInfo[]>()
  const flat: DesignFileInfo[] = []

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
