import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/**
 * 头像渲染（fetch + blob + objectURL）。
 *
 * `<img>` 发起的 GET 无法携带 `Authorization` 头，本组合式用 fetch 拉取头像 →
 * `URL.createObjectURL`；fetch 失败（404/网络/服务端异常）返回 null，由既有字符头像 fallback 接管。
 *
 * - watch(relImage)：换值重拉 + revoke 旧 objectURL；onUnmounted 统一 revoke。
 */
export function useAvatarURL(relImage: MaybeRefOrGetter<string | null | undefined>) {
  const avatarURL = ref<string | null>(null)
  let currentObjectURL: string | null = null
  // 请求序号守卫：同一组件快速换 image（如上传同名覆盖、成员列表刷新）时，
  // 丢弃过期响应，防止旧 objectURL 覆盖新头像（C3 竞态）。
  let requestSeq = 0

  function revoke(): void {
    if (currentObjectURL) {
      URL.revokeObjectURL(currentObjectURL)
      currentObjectURL = null
    }
  }

  async function load(): Promise<void> {
    const image = toValue(relImage)
    const fileName = image?.split('/').pop()
    const seq = ++requestSeq
    if (!fileName) {
      revoke()
      avatarURL.value = null
      return
    }
    try {
      const response = await fetch(`/api/v1/avatars/${encodeURIComponent(fileName)}`)
      if (seq !== requestSeq) return
      if (!response.ok) {
        revoke()
        avatarURL.value = null
        return
      }
      const blob = await response.blob()
      if (seq !== requestSeq) return
      revoke()
      currentObjectURL = URL.createObjectURL(blob)
      avatarURL.value = currentObjectURL
    } catch (error) {
      if (seq !== requestSeq) return
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
