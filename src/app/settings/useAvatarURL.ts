import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { authHeader } from '@/app/bridge/client'

/**
 * 头像渲染（fetch + blob + objectURL）。
 *
 * `<img>` 发起的 GET 无法携带 `Authorization` 头，而 `serveAvatar` 强制登录态（未登录 401）。
 * 本组合式用带鉴权的 `fetch` 拉取头像 → `URL.createObjectURL`，让 4 个组件 7 处头像
 * 上传后立即可见；fetch 失败（401/网络/服务端异常）返回 null，由既有字符头像 fallback 接管。
 *
 * - watch(relImage)：换值重拉 + revoke 旧 objectURL；onUnmounted 统一 revoke。
 * - 鉴权头获取方式与全站其余 API 一致（authHeader()，见 bridge/client.ts:103-106）。
 */
export function useAvatarURL(relImage: MaybeRefOrGetter<string | null | undefined>) {
  const avatarURL = ref<string | null>(null)
  let currentObjectURL: string | null = null

  function revoke(): void {
    if (currentObjectURL) {
      URL.revokeObjectURL(currentObjectURL)
      currentObjectURL = null
    }
  }

  async function load(): Promise<void> {
    const image = toValue(relImage)
    const fileName = image?.split('/').pop()
    if (!fileName) {
      revoke()
      avatarURL.value = null
      return
    }
    const headers: Record<string, string> = {}
    const auth = authHeader()
    if (auth) headers.Authorization = auth
    try {
      const response = await fetch(`/api/v1/avatars/${encodeURIComponent(fileName)}`, { headers })
      if (!response.ok) {
        revoke()
        avatarURL.value = null
        return
      }
      const blob = await response.blob()
      revoke()
      currentObjectURL = URL.createObjectURL(blob)
      avatarURL.value = currentObjectURL
    } catch (error) {
      console.warn('[avatar] load failed', error)
      revoke()
      avatarURL.value = null
    }
  }

  watch(() => toValue(relImage), load, { immediate: true })

  onUnmounted(() => {
    revoke()
    avatarURL.value = null
  })

  return avatarURL
}
