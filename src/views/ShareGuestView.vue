<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'

import { readFigFile } from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { useI18n } from '@open-pencil/vue'

import { getShareContent, verifyShare, type BridgeShareVerify } from '@/app/bridge/share'
import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'
import { createTab } from '@/app/tabs'
import EditorCanvas from '@/components/EditorCanvas.vue'

defineOptions({ name: 'ShareGuestView' })

const route = useRoute()
const router = useRouter()
const { dialogs } = useI18n()

const token = computed(() => String(route.params.token ?? ''))

type Stage = 'loading' | 'notFound' | 'error' | 'password' | 'ready'

const stage = ref<Stage>('loading')
const passwordInput = ref('')
const passwordError = ref(false)
const submitting = ref(false)

useHead({
  title: computed(() => (stage.value === 'ready' ? '只读预览' : '分享'))
})

async function load(): Promise<void> {
  if (!token.value) {
    stage.value = 'notFound'
    return
  }
  // 真实失败（网络 / 非 2xx / 200 但非 JSON）与「链接不存在」区分开：
  // 只有服务端明确 exists:false 才进 notFound，其余一律独立 error 态并打日志定位。
  const verify = await verifyShare(token.value).catch((error: unknown) => {
    console.error('[share] verify failed', error)
    return null
  })
  if (verify === null) {
    stage.value = 'error'
    return
  }
  if (!verify.exists) {
    stage.value = 'notFound'
    return
  }
  if (verify.needPassword) {
    stage.value = 'password'
    return
  }
  await openPreview(verify)
}

async function submitPassword(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  passwordError.value = false
  try {
    const verify = await verifyShare(token.value, passwordInput.value).catch((error: unknown) => {
      console.error('[share] verify failed', error)
      return null
    })
    if (verify === null) {
      stage.value = 'error'
      return
    }
    if (!verify.exists) {
      stage.value = 'notFound'
      return
    }
    if (verify.needPassword) {
      passwordError.value = true
      return
    }
    await openPreview(verify)
  } finally {
    submitting.value = false
  }
}

async function openPreview(verify: BridgeShareVerify): Promise<void> {
  stage.value = 'loading'
  try {
    const bytes = await getShareContent(token.value)
    const fileName = verify.fileName ?? 'shared.fig'
    const tab = createTab()
    const target = tab.store
    target.state.loading = true
    const file = new File(
      [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)],
      fileName,
      { type: 'application/octet-stream' }
    )
    const imported = await readFigFile(file, { populate: 'first-page' })
    const firstPageId = imported.getPages()[0]?.id
    if (firstPageId) computeAllLayouts(imported, firstPageId)
    target.replaceGraph(imported)
    target.undo.clear()
    target.state.documentName = fileName.replace(/\.(fig|pen)$/i, '')
    // 游客强制只读：禁编辑/保存/导出，关 autosave，仅可查看缩放。
    target.state.readOnly = true
    target.state.autosaveEnabled = false
    target.setTool('SELECT')
    target.clearSelection()
    const pageId = target.graph.getPages()[0]?.id ?? target.graph.rootId
    await target.switchPage(pageId)
    await target.fitCurrentPageToViewport()
    stage.value = 'ready'
  } catch (error) {
    // 内容拉取/解析失败同样进入独立 error 态，不再伪装成「链接不存在」。
    console.error('[share] preview load failed', error)
    stage.value = 'error'
  } finally {
    const current = getActiveEditorStoreOrNull()
    if (current) current.state.loading = false
  }
}

// 只读兜底（游客无权限申请弹窗）：切到编辑工具复位回选择；图变更静默回滚内存改动。
let sceneBaseline: number | null = null
let lastInterceptedVersion = -1

watch(
  () => {
    const current = getActiveEditorStoreOrNull()
    return current ? current.state.activeTool : null
  },
  (tool) => {
    const current = getActiveEditorStoreOrNull()
    if (!current || !current.state.readOnly) return
    if (tool === 'SELECT' || tool === 'HAND') return
    current.setTool('SELECT')
  }
)

watch(
  () => {
    const current = getActiveEditorStoreOrNull()
    return current ? current.state.sceneVersion : null
  },
  (version) => {
    const current = getActiveEditorStoreOrNull()
    if (!current || !current.state.readOnly || sceneBaseline === null) return
    if (version === null || version === sceneBaseline || version === lastInterceptedVersion) return
    lastInterceptedVersion = version
    if (current.undo.canUndo) current.undo.undo()
    sceneBaseline = current.state.sceneVersion
  }
)

watch(
  () => {
    const current = getActiveEditorStoreOrNull()
    return current ? current.state.readOnly : false
  },
  (readOnly) => {
    const current = getActiveEditorStoreOrNull()
    if (!current) return
    if (readOnly) {
      sceneBaseline = current.state.sceneVersion
      lastInterceptedVersion = -1
    } else {
      sceneBaseline = null
      lastInterceptedVersion = -1
    }
  }
)

onMounted(() => {
  void load()
})

onUnmounted(() => {
  const current = getActiveEditorStoreOrNull()
  if (current) current.state.readOnly = false
})

function goLogin(): void {
  void router.push('/login')
}
</script>

<template>
  <div class="flex h-screen w-screen flex-col bg-canvas" data-test-id="share-guest-page">
    <!-- 顶部条：只读预览标识 + 引导登录 -->
    <header
      class="flex h-10 shrink-0 items-center justify-between border-b border-border bg-panel px-4"
    >
      <span class="flex items-center gap-1.5 text-[11px] font-medium text-muted">
        <icon-lucide-eye class="size-3.5" />
        {{ dialogs['share.readonlyNotice'] }}
      </span>
      <button
        type="button"
        class="flex h-7 cursor-pointer items-center gap-1.5 rounded px-2 text-[11px] font-medium text-accent hover:bg-hover"
        data-test-id="share-guest-login"
        @click="goLogin"
      >
        <icon-lucide-log-in class="size-3.5" />
        {{ dialogs['share.guestLogin'] }}
      </button>
    </header>

    <!-- 校验中 -->
    <div
      v-if="stage === 'loading'"
      class="flex flex-1 items-center justify-center text-xs text-muted"
    >
      …
    </div>

    <!-- 链接不存在或已关闭 -->
    <div
      v-else-if="stage === 'notFound'"
      class="flex flex-1 flex-col items-center justify-center gap-3"
      data-test-id="share-not-found"
    >
      <icon-lucide-link-2-off class="size-10 text-muted/50" />
      <div class="text-center">
        <p class="text-sm font-medium text-surface">{{ dialogs['share.linkNotFound'] }}</p>
        <p class="mt-1 text-xs text-muted">{{ dialogs['share.linkNotFoundDesc'] }}</p>
      </div>
    </div>

    <!-- 加载失败 / 网络错误（与「链接不存在」区分：非服务端明确 exists:false） -->
    <div
      v-else-if="stage === 'error'"
      class="flex flex-1 flex-col items-center justify-center gap-3"
      data-test-id="share-load-error"
    >
      <icon-lucide-alert-circle class="size-10 text-muted/50" />
      <div class="text-center">
        <p class="text-sm font-medium text-surface">{{ dialogs['share.loadError'] }}</p>
        <p class="mt-1 text-xs text-muted">{{ dialogs['share.loadErrorDesc'] }}</p>
      </div>
    </div>

    <!-- 密码门 -->
    <div
      v-else-if="stage === 'password'"
      class="flex flex-1 flex-col items-center justify-center px-4"
      data-test-id="share-password-gate"
    >
      <div
        class="flex w-[320px] max-w-full flex-col gap-3 rounded-xl border border-border bg-panel p-5"
      >
        <div class="flex items-center gap-2">
          <icon-lucide-lock class="size-4 text-accent" />
          <span class="text-sm font-semibold text-surface">{{ dialogs['share.password.title'] }}</span>
        </div>
        <input
          v-model="passwordInput"
          type="password"
          class="h-9 w-full rounded-md border border-border bg-canvas px-3 text-sm text-surface outline-none placeholder:text-muted focus:border-accent"
          :placeholder="dialogs['share.password.placeholder']"
          data-test-id="share-password-input"
          @keydown.enter="submitPassword"
        />
        <p v-if="passwordError" class="text-[11px] text-red-500" data-test-id="share-password-wrong">
          {{ dialogs['share.password.wrong'] }}
        </p>
        <button
          type="button"
          :disabled="submitting"
          class="h-8 w-full cursor-pointer rounded bg-accent text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-40"
          data-test-id="share-password-submit"
          @click="submitPassword"
        >
          {{ dialogs['share.password.submit'] }}
        </button>
      </div>
    </div>

    <!-- 只读预览（bare 画布） -->
    <div v-else-if="stage === 'ready'" class="flex min-h-0 flex-1">
      <EditorCanvas />
    </div>
  </div>
</template>
