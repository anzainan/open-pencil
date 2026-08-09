import { bridgeClient } from '@/app/bridge/client'
import { IS_BROWSER } from '@/constants'

/**
 * 把「打开工作区文件」的入参路径换算成 file-bridge 的相对路径（如 `PixelMob/login.fig`）。
 *
 * MCP open_file 走浏览器 RPC 时，上游 MCP server 会把路径 realpath 后以绝对路径下发
 * （如 `/data/design/test.fig`）；本地脚本/参数打开则可能是相对路径。这里统一先裁掉
 * designRoot 前缀，再去掉前导斜杠，并做安全校验（拒绝绝对路径逃逸 / .. / 空值）。
 */
export async function resolveWorkspaceRelPath(openPath: string): Promise<string> {
  const designRoot = await bridgeClient.getDesignRoot()
  let rel = openPath.trim()
  if (designRoot) {
    const normalizedRoot = designRoot.replace(/[\\/]+$/, '')
    if (rel.startsWith(normalizedRoot)) rel = rel.slice(normalizedRoot.length)
  }
  rel = rel.replace(/^[\\/]+/, '')

  if (
    !rel ||
    rel === '..' ||
    rel.startsWith('../') ||
    rel.includes('/../') ||
    rel.includes('\\..\\') ||
    rel.includes('\u0000')
  ) {
    throw new Error(`Invalid workspace path: ${openPath}`)
  }
  return rel
}

/**
 * 把 web 版存下的 filePath 换算成工作区相对路径：designRoot 绝对路径或同源 URL
 * （如 `http://host:8082/PixelMob/login.fig`）。不可换算（blob/data/跨域/非 .fig|.pen）返回 null。
 *
 * 供落盘管线（write.ts 的 web 兜底 PUT）与防丢失 journal 键控（op-journal.ts）共用，
 * 保证「写盘目标」与「journal 键」使用同一条换算逻辑。
 */
export function webFilePathToWorkspaceRel(
  filePath: string,
  designRoot: string | null
): string | null {
  if (!filePath || filePath.startsWith('blob:') || filePath.startsWith('data:')) return null
  let rel = filePath
  if (designRoot) {
    const normalizedRoot = designRoot.replace(/[\\/]+$/, '')
    if (rel.startsWith(normalizedRoot)) rel = rel.slice(normalizedRoot.length)
  }
  if (rel.startsWith('http://') || rel.startsWith('https://')) {
    if (!IS_BROWSER) return null
    let url: URL
    try {
      url = new URL(rel)
    } catch {
      return null
    }
    if (url.origin !== window.location.origin) return null
    rel = url.pathname
  }
  rel = rel.replace(/^[\\/]+/, '')
  if (!/\.(fig|pen)$/i.test(rel)) return null
  if (!rel || rel === '..' || rel.startsWith('../') || rel.includes('/../')) return null
  return rel
}
