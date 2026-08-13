import { lstatSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

export const ALLOWED_DESIGN_EXTENSIONS = /\.(fig|pen)$/i

/** 工作区 fonts/ 文件夹内可加载的字体扩展名（ttf/otf/woff/woff2）。 */
export const ALLOWED_FONT_EXTENSIONS = /\.(ttf|otf|woff|woff2)$/i

/** 工作区字体根目录名（相对设计根）。 */
export const FONTS_REL_DIR = 'fonts'

/** 回收站目录名（相对设计根，软删文件的落地目录）。 */
export const TRASH_REL_DIR = '.trash'

function isSafeRelSegments(rel: string, lastMustMatch: RegExp): boolean {
  if (!rel || rel.length === 0) return false
  if (rel.includes('\0')) return false
  if (rel.startsWith('/') || rel.startsWith('\\')) return false
  if (rel.includes('\\')) return false
  const segments = rel.split('/').filter(Boolean)
  if (segments.length === 0) return false
  if (segments.some((segment) => segment === '..' || segment === '.')) return false
  const last = segments[segments.length - 1] ?? ''
  return lastMustMatch.test(last)
}

export function isSafeRelativePath(rel: string): boolean {
  return isSafeRelSegments(rel, ALLOWED_DESIGN_EXTENSIONS)
}

/** 校验工作区任意相对路径（文件或目录，末段无扩展名要求，如 `工作`/`工作/设计`）。 */
export function isSafeWorkspaceRelPath(rel: string): boolean {
  return isSafeRelSegments(rel, /.+/)
}

/** 校验工作区单个名称段（文件夹名 / 重命名目标名）：不得含路径分隔符、`.`、`..`、空。 */
export function isSafeWorkspaceName(name: string): boolean {
  return isSafeRelSegments(name, /.+/)
}

/** 校验字体相对路径：必须位于 fonts/ 子树下且扩展名在白名单内。 */
export function isSafeFontRelPath(rel: string): boolean {
  const [first, ...rest] = rel.split('/')
  if (first !== FONTS_REL_DIR) return false
  if (rest.length === 0) return false
  return isSafeRelSegments(rel, ALLOWED_FONT_EXTENSIONS)
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
  return resolveSafePath(root, rel, isSafeRelativePath)
}

/** 解析字体相对路径（fonts/ 子树，见 isSafeFontRelPath）。 */
export function resolveFontPath(root: string, rel: string): string | null {
  return resolveSafePath(root, rel, isSafeFontRelPath)
}

function resolveSafePath(root: string, rel: string, validate: (rel: string) => boolean): string | null {
  if (!validate(rel)) return null

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
