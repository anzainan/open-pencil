<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { currentUser, useCurrentUser } from '@/app/auth/session'
import { openLogoutDialog } from '@/app/auth/logout-dialog'
import { uploadAvatar } from '@/app/bridge/share'
import { useAvatarURL } from '@/app/settings/useAvatarURL'
import { toast } from '@/app/shell/ui'

defineOptions({ name: 'ProfileSettingsPanel' })

const { dialogs } = useI18n()
const currentUser = useCurrentUser()

const roleLabel = computed(() => {
  const role = currentUser.value?.role
  if (role === 'owner') return dialogs.value['role.owner']
  if (role === 'admin') return dialogs.value['role.admin']
  if (role === 'member') return dialogs.value['role.member']
  return ''
})

const roleWorkspaceLabel = computed(() =>
  dialogs.value['profile.roleAndWorkspace']({ role: roleLabel.value })
)

const avatarBg = computed(() => currentUser.value?.avatar.bg ?? '#3B82F6')
const avatarChar = computed(() => currentUser.value?.avatar.char ?? '?')
const avatarURL = useAvatarURL(computed(() => currentUser.value?.avatar.image ?? null))
const accountName = computed(() => currentUser.value?.name ?? '')
const email = computed(() => currentUser.value?.email ?? dialogs.value['profile.emailPlaceholder'])

const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)

const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const AVATAR_TARGET_BYTES = 100 * 1024
const AVATAR_MAX_EDGE = 256

function pickAvatar(): void {
  if (avatarUploading.value) return
  avatarInput.value?.click()
}

function readFileAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.replace(/^data:[^;]+;base64,/, ''))
    }
    reader.onerror = () => {
      reject(new Error('FileReader failed'))
    }
    reader.readAsDataURL(blob)
  })
}

function blobTypeToExt(type: string): string {
  if (type === 'image/webp') return 'webp'
  if (type === 'image/png') return 'png'
  return 'jpg'
}

async function canvasToBlob(
  type: string,
  quality: number,
  width: number,
  height: number,
  source: CanvasImageSource
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.clearRect(0, 0, width, height)
    context.drawImage(source, 0, 0, width, height)
    return canvas.convertToBlob({ type, quality })
  }
  // oxlint-disable-next-line open-pencil/no-browser-side-effects-in-vue
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.clearRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

async function decodeImageSource(
  file: File
): Promise<{ width: number; height: number; source: CanvasImageSource }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => {
        resolve()
      }
      image.onerror = () => {
        reject(new Error('image decode failed'))
      }
      image.src = url
    })
    return { width: image.naturalWidth, height: image.naturalHeight, source: image }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 头像压缩：canvas 重绘，最长边 cap ≤256px，质量循环（q 0.9→0.3，优先 webp/png 保透明），
 * blob.size ≤100KB 即停；仍超则边长 ×0.8 重试。返回 base64 + 实际 ext（与服务端 magic bytes 校验一致）。
 */
async function compressAvatar(file: File): Promise<{ data: string; ext: string }> {
  const decoded = await decodeImageSource(file)
  const hasAlpha = file.type !== 'image/jpeg'
  const types = hasAlpha ? ['image/webp', 'image/png'] : ['image/jpeg']
  const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(decoded.width, decoded.height))
  let width = Math.max(1, Math.round(decoded.width * scale))
  let height = Math.max(1, Math.round(decoded.height * scale))

  let lastBlob: Blob | null = null
  let lastExt = 'jpg'

  for (let attempt = 0; attempt < 6; attempt++) {
    for (const type of types) {
      for (let quality = 0.9; quality >= 0.3; quality -= 0.1) {
        const blob = await canvasToBlob(type, Math.round(quality * 100) / 100, width, height, decoded.source)
        if (!blob) continue
        lastBlob = blob
        lastExt = blobTypeToExt(blob.type)
        if (blob.size <= AVATAR_TARGET_BYTES) {
          return { data: await readFileAsBase64(blob), ext: lastExt }
        }
      }
    }
    if (width <= 16 && height <= 16) break
    width = Math.max(1, Math.round(width * 0.8))
    height = Math.max(1, Math.round(height * 0.8))
  }
  if (lastBlob) return { data: await readFileAsBase64(lastBlob), ext: lastExt }
  throw new Error('avatar compression failed')
}

async function onAvatarSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    toast.error(dialogs.value['profile.avatarInvalid'])
    return
  }
  if (file.size > AVATAR_MAX_BYTES) {
    toast.error(dialogs.value['profile.avatarTooLarge'])
    return
  }
  avatarUploading.value = true
  try {
    // 大小校验之后、上传之前压缩到 ≤100KB（透明 PNG 保 alpha，无黑底）。
    const compressed = await compressAvatar(file)
    const avatar = await uploadAvatar(compressed.data, compressed.ext)
    if (currentUser.value) currentUser.value = { ...currentUser.value, avatar }
    toast.info(dialogs.value['profile.avatarUpdated'])
  } catch (error) {
    console.warn('[profile] avatar upload failed', error)
    toast.error(dialogs.value['profile.avatarFailed'])
  } finally {
    avatarUploading.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-4" data-test-id="settings-profile-panel">
    <!-- SecTitle（设计稿 §3.1） -->
    <div>
      <h3 class="text-base font-semibold text-surface">{{ dialogs.settingsProfile }}</h3>
      <p class="mt-0.5 text-xs text-muted">{{ dialogs['profile.manageDescription'] }}</p>
    </div>

    <!-- ProfileCard（设计稿 §3.1） -->
    <div class="flex items-center gap-4 rounded-lg border border-border bg-panel p-3" data-test-id="profile-card">
      <img
        v-if="avatarURL"
        :src="avatarURL"
        class="size-16 shrink-0 rounded-full object-cover"
        :alt="accountName"
        data-test-id="profile-avatar"
      />
      <span
        v-else
        class="flex size-16 shrink-0 items-center justify-center rounded-full text-2xl font-semibold text-white"
        :style="{ backgroundColor: avatarBg }"
        data-test-id="profile-avatar"
      >
        {{ avatarChar }}
      </span>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-surface" data-test-id="profile-name">
          {{ accountName }}
        </p>
        <p class="mt-0.5 truncate text-[11px] text-muted" data-test-id="profile-role">
          {{ roleWorkspaceLabel }}
        </p>
      </div>
      <button
        type="button"
        class="ml-auto h-7 shrink-0 cursor-pointer rounded border border-border px-2.5 text-[11px] text-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        data-test-id="profile-change-avatar"
        :disabled="avatarUploading"
        @click="pickAvatar"
      >
        {{ dialogs['profile.changeAvatar'] }}
      </button>
      <input
        ref="avatarInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        class="hidden"
        data-test-id="profile-avatar-input"
        @change="onAvatarSelected"
      />
    </div>

    <!-- Fields（设计稿 §3.1） -->
    <div class="flex flex-col gap-2.5">
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] text-muted">{{ dialogs['profile.accountName'] }}</span>
        <input
          :value="accountName"
          type="text"
          readonly
          class="h-8 rounded bg-panel-field px-2.5 text-xs text-surface outline-none placeholder:text-muted"
          data-test-id="profile-name-input"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] text-muted">{{ dialogs['profile.email'] }}</span>
        <input
          :value="email"
          type="text"
          readonly
          class="h-8 rounded bg-panel-field px-2.5 text-xs text-muted outline-none placeholder:text-muted"
          data-test-id="profile-email-input"
        />
      </label>
    </div>

    <!-- BtnRow（设计稿 §3.1：红色描边+红字「退出登录」） -->
    <div class="mt-auto flex justify-end">
      <button
        type="button"
        class="h-8 cursor-pointer rounded border border-[#EF4444] px-3.5 text-xs font-medium text-[#EF4444] hover:bg-red-600/10"
        data-test-id="profile-logout"
        @click="openLogoutDialog"
      >
        {{ dialogs['profile.logout'] }}
      </button>
    </div>
  </section>
</template>
