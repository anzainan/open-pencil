import { IS_BROWSER } from '@/constants'

/**
 * 刷新恢复：把当前打开的工作区文件记进 URL（`?file=<相对路径>`），
 * 刷新/重开后由 `openFileFromQueryParam` 自动重新打开。
 * 用 replaceState，避免污染浏览器历史栈。
 */
const FILE_PARAM = 'file'

export function rememberWorkspaceFile(relPath: string): void {
  if (!IS_BROWSER || !relPath) return
  const url = new URL(window.location.href)
  url.searchParams.set(FILE_PARAM, relPath)
  history.replaceState(history.state, '', `${url.pathname}${url.search}`)
}

export function clearRememberedWorkspaceFile(): void {
  if (!IS_BROWSER) return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(FILE_PARAM)) return
  url.searchParams.delete(FILE_PARAM)
  history.replaceState(history.state, '', `${url.pathname}${url.search}`)
}
