import { bridgeClient } from './client'

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
