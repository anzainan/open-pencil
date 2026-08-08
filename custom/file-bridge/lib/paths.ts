import { lstatSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

export const ALLOWED_DESIGN_EXTENSIONS = /\.(fig|pen)$/i

export function isSafeRelativePath(rel: string): boolean {
  if (!rel || rel.length === 0) return false
  if (rel.includes('\0')) return false
  if (rel.startsWith('/') || rel.startsWith('\\')) return false
  if (rel.includes('\\')) return false
  const segments = rel.split('/').filter(Boolean)
  if (segments.length === 0) return false
  if (segments.some((segment) => segment === '..' || segment === '.')) return false
  const last = segments[segments.length - 1] ?? ''
  return ALLOWED_DESIGN_EXTENSIONS.test(last)
}

export function isSafeBrand(brand: string): boolean {
  if (!brand || brand.length === 0) return false
  if (brand.includes('\0')) return false
  if (brand.includes('/') || brand.includes('\\')) return false
  if (brand === '.' || brand === '..') return false
  return true
}

/**
 * 解析设计根下的相对路径。在词法前缀校验（防 `..` 穿越）之外，追加 realpath
 * 复查：从根沿路径逐段解析，任何已存在组件的真实路径都必须落在设计根内。
 * 以此阻止符号链接逃逸（含悬空符号链接，写入时不可见）。
 */
export function resolveDesignPath(root: string, rel: string): string | null {
  if (!isSafeRelativePath(rel)) return null

  const rootResolved = resolve(root)
  const full = resolve(rootResolved, rel)
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) return null

  let realRoot: string
  try {
    realRoot = realpathSync(rootResolved)
  } catch {
    realRoot = rootResolved
  }

  const relParts = relative(rootResolved, full).split(sep).filter(Boolean)
  let probe = rootResolved
  for (const part of relParts) {
    probe = join(probe, part)
    try {
      const real = realpathSync(probe)
      if (real !== realRoot && !real.startsWith(realRoot + sep)) return null
    } catch {
      // probe 解析失败：可能是悬空符号链接，或尚不存在的组件
      try {
        if (lstatSync(probe).isSymbolicLink()) return null // 悬空符号链接 → 拒绝
      } catch {
        // 确实不存在（新建文件/目录的正常路径），放行
      }
    }
  }
  return full
}
