import { useEventListener, useIntervalFn, watchDebounced } from '@vueuse/core'

import type { EditorState } from '@open-pencil/core/editor'

import { toast } from '@/app/shell/ui'

/** 兜底落盘看门狗：覆盖「AI 连续小操作永不停、3s debounce 永不触发」场景。 */
const WATCHDOG_MS = 60_000

type AutosaveState = EditorState & { autosaveEnabled: boolean }

type AutosaveOptions = {
  state: AutosaveState
  getSavedVersion: () => number
  hasWritableSource: () => boolean
  saveCurrentDocument: () => Promise<void>
}

export function createAutosave({
  state,
  getSavedVersion,
  hasWritableSource,
  saveCurrentDocument
}: AutosaveOptions) {
  async function flushIfDirty(): Promise<void> {
    if (state.sceneVersion === getSavedVersion()) return
    if (!state.autosaveEnabled) return
    if (!hasWritableSource()) return
    try {
      await saveCurrentDocument()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // 自动保存失败绝不能静默：校验失败（如枚举不合法）会导致磁盘停留旧版，
      // 用户刷新即丢数据。toast 去重机制保证同一错误不刷屏。
      console.warn('Autosave failed:', e)
      toast.error(`自动保存失败：${message}`)
    }
  }

  const stop = watchDebounced(
    () => state.sceneVersion,
    () => {
      void flushIfDirty()
    },
    { debounce: 3000 }
  )

  // 60s 看门狗：dirty 且距上次落盘 >60s 时强制保存（ux-live-collab §8.2）。
  const interval = useIntervalFn(() => {
    void flushIfDirty()
  }, WATCHDOG_MS)

  // 页面隐藏/关闭前立即 flush，避免未落盘的操作丢失。
  const stopBeforeUnload = useEventListener(window, 'beforeunload', () => {
    void flushIfDirty()
  })
  const stopVisibility = useEventListener(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushIfDirty()
  })

  return {
    disposeAutosave: () => {
      stop()
      interval.pause()
      stopBeforeUnload()
      stopVisibility()
    }
  }
}
