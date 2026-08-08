import type { BridgeFileInfo } from './client'
import { bridgeClient } from './client'

/**
 * 把用户输入的文件名清洗成单段安全文件名（去掉路径分隔符、前后点号、.fig/.pen 后缀）。
 * 空输入回退为 Untitled。
 */
export function sanitizeWorkspaceFileName(raw: string): string {
  let name = raw.trim()
  if (!name) return 'Untitled'
  name = name.replace(/[\\/]+/g, '_').replace(/^\.+/, '')
  name = name.replace(/\.(fig|pen)$/i, '')
  name = name.replace(/^\.+|\.+$/g, '')
  if (!name) return 'Untitled'
  return name
}

/**
 * 同名自动重命名（纯函数，便于单测）：在给定占用集合里为 `base.fig` 找第一个空闲名，
 * 依次尝试 `base.fig`、`base1.fig`、`base2.fig`…（不覆盖已有文件）。
 */
export function uniqueWorkspaceFileName(
  base: string,
  taken: Iterable<string>,
  ext = '.fig'
): string {
  const used = new Set<string>()
  for (const name of taken) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed) used.add(trimmed)
  }
  const safeBase = sanitizeWorkspaceFileName(base)
  if (!used.has(`${safeBase}${ext}`.toLowerCase())) return `${safeBase}${ext}`

  for (let n = 1; n < 10_000; n++) {
    const candidate = `${safeBase}${n}${ext}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }

  // 极端情况：仍不覆盖，追加随机后缀兜底。
  for (;;) {
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    const candidate = `${safeBase}${suffix}${ext}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/** 目标相对路径（可含品牌子目录）已存在时的同名重命名入口。 */
export function uniqueWorkspacePathFor(relPath: string, files: BridgeFileInfo[]): string {
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : ''
  const fileName = relPath.slice(dir.length)
  const ext = /\.(pen)$/i.test(fileName) ? '.pen' : '.fig'
  const base = sanitizeWorkspaceFileName(fileName)
  const taken = files
    .filter((file) => {
      if (dir) {
        return (
          file.path.startsWith(dir) && !file.path.slice(dir.length).includes('/')
        )
      }
      return !file.path.includes('/')
    })
    .map((file) => file.path.slice(dir.length))
  return `${dir}${uniqueWorkspaceFileName(base, taken, ext)}`
}

/**
 * 异步版：先拉工作区文件列表，再为 `desiredRelPath`（如 `扫地机器人.fig` 或 `PixelMob/首页.fig`）
 * 计算不冲突的路径。工作区不可达时抛错，由调用方决定回退策略。
 */
export async function resolveUniqueWorkspacePath(desiredRelPath: string): Promise<string> {
  const listing = await bridgeClient.listFiles()
  return uniqueWorkspacePathFor(desiredRelPath, listing.flat)
}
