import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import { nextTick, ref, shallowReactive, watch } from 'vue'

/**
 * SharePopover documentPath 冻结根因（ARCH-share-password-toggle.md §2.1，方案 A）回归断言。
 *
 * 根因：getStorageBinding() 读 source-state 闭包、非响应式；旧实现用 computed 包裹，
 * 唯一响应式依赖 storeRef 值不变 → 首文件复用初始 Untitled tab（tab id 不变不重挂）
 * → computed 永不再求值 → documentPath 永久='' → withSaving 静默早退（启用密码无反应）
 * + copyLink 真发 path='' 被服务端 400（复制链接失败）。
 *
 * 断言分两层：
 * 1. 静态：读取真实源码，禁止「对非响应式 binding 的 frozen computed」模式回归；
 *    withSaving 空路径分支必须 toast（不许裸 return）；面板打开/copyLink 必须先 sync 再 load。
 * 2. 场景模拟：以与组件一致的 ref+watch+sync 契约 + 假 store，复现
 *    「冷启动 → 开首个文件（reusableTabStore 复用路径，documentName 先置值、
 *    binding 后写同值不再触发 watch）→ 打开面板 → syncDocumentPath 补时序 → documentPath 非空」；
 *    并验证 documentName 变化可纯 watch 触发更新。
 */
const sourcePath = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  'src',
  'components',
  'workspace',
  'SharePopover.vue'
)
const source = readFileSync(sourcePath, 'utf-8')

type FakeBinding = { providerId: string; documentId: string } | null

function createFakeStore() {
  const state = shallowReactive<{ documentName: string }>({ documentName: 'Untitled' })
  let storageBinding: FakeBinding = null
  return {
    state,
    setStorageBinding(binding: FakeBinding) {
      storageBinding = binding
    },
    getStorageBinding() {
      return storageBinding
    }
  }
}

/** 组件同款契约：ref + 命名 sync 函数 + documentName watch（immediate）。 */
function createShareDocumentPathContract(store: ReturnType<typeof createFakeStore>) {
  const documentPath = ref('')
  function syncDocumentPath(): void {
    documentPath.value = store.getStorageBinding()?.documentId ?? ''
  }
  const stopWatch = watch(
    () => store.state.documentName,
    () => {
      syncDocumentPath()
    },
    { immediate: true }
  )
  return { documentPath, syncDocumentPath, stopWatch }
}

describe('SharePopover documentPath 静态断言（读真实源码）', () => {
  test('documentPath 是 ref + watch(sync)，不再有对非响应式 getStorageBinding 的 frozen computed', () => {
    expect(source).toContain('const documentPath = ref(')
    const frozenComputedPattern = /const documentPath\s*=\s*computed\(\s*\(\s*\)\s*=>\s*store\.getStorageBinding\(\)/s
    expect(frozenComputedPattern.test(source)).toBe(false)
    // watch 依赖 documentName（binding 的唯一响应式代理），回调走 sync 重读 binding。
    expect(/watch\(\s*\(\s*\)\s*=>\s*store\.state\.documentName/.test(source)).toBe(true)
    // sync 函数必须声明为具名函数并被 watch 引用（方案 A 第 2 条）。
    expect(/function syncDocumentPath\(\): void/.test(source)).toBe(true)
    expect(source).toContain('getStorageBinding()?.documentId ??')
    expect(
      /function syncDocumentPath\(\): void \{[\s\S]*?getStorageBinding\(\)\?\.documentId \?\?/.test(
        source
      )
    ).toBe(true)
  })

  test('withSaving 空路径分支有 toast 调用（不再是裸 return、不再静默）', () => {
    const withSavingMatch = source.match(/function withSaving[\s\S]*?\n}/)
    expect(withSavingMatch).not.toBeNull()
    const body = withSavingMatch?.[0] ?? ''
    const guard = body.match(/if \(!documentPath\.value\) \{[\s\S]*?\n  \}/)
    expect(guard).not.toBeNull()
    const guardBody = guard?.[0] ?? ''
    expect(guardBody).toContain('toast.error')
    expect(guardBody).toContain('share.notReady')
    // 空路径分支后面不得紧跟裸 return（必须带 toast）。
    expect(/if \(!documentPath\.value\) return/.test(body)).toBe(false)
  })

  test('面板 @update:open 先 syncDocumentPath() 再 void load()', () => {
    const openHandler = source.match(/@update:open="\(open: boolean\)[\s\S]*?syncDocumentPath\(\); void load\(\)/)
    expect(openHandler).not.toBeNull()
  })

  test('copyLink 两处 void load() 前都先 syncDocumentPath()', () => {
    const occurrences = source.match(/syncDocumentPath\(\)\n\s*void load\(\)/g) ?? []
    expect(occurrences.length).toBe(2)
  })
})

describe('场景：冷启动 → 首个文件（reusableTabStore 复用路径）→ 打开分享面板', () => {
  test('documentPath 非空：面板打开时 syncDocumentPath 补时序缺口', async () => {
    const store = createFakeStore()
    const { documentPath, syncDocumentPath, stopWatch } = createShareDocumentPathContract(store)
    try {
      // ① 冷启动（SharePopover 挂载期 immediate）：无 binding → ''。
      expect(documentPath.value).toBe('')

      // ② 打开首个文件（模拟 openStorageDocumentInNewTab，tabs/index.ts）：
      //    documentName 先置值（binding 尚未写入）→ watch 触发但 sync 读不到 binding。
      store.state.documentName = 'login'
      await nextTick()
      expect(documentPath.value).toBe('')

      //    binding 随后写入，且 documentName 同值不再触发 watch（时序缺口根因）。
      store.setStorageBinding({ providerId: 'bridge', documentId: 'PixelMob/login.fig' })
      await nextTick()
      expect(documentPath.value).toBe('')

      // ③ 打开分享面板：@update:open 显式 syncDocumentPath() 先于 load() → 路径非空。
      syncDocumentPath()
      expect(documentPath.value).toBe('PixelMob/login.fig')
    } finally {
      stopWatch()
    }
  })

  test('mock documentName 变化（改新值）触发 watch → documentPath 随新 binding 更新', async () => {
    const store = createFakeStore()
    const { documentPath, stopWatch } = createShareDocumentPathContract(store)
    try {
      store.setStorageBinding({ providerId: 'bridge', documentId: 'PixelMob/login.fig' })
      store.state.documentName = 'login'
      await nextTick()
      expect(documentPath.value).toBe('PixelMob/login.fig')

      // 切换到第二个工作区文件（新 tab 路径）：documentName 改新值 + 新 binding。
      store.setStorageBinding({ providerId: 'bridge', documentId: 'PixelMob/home.fig' })
      store.state.documentName = 'home'
      await nextTick()
      expect(documentPath.value).toBe('PixelMob/home.fig')
    } finally {
      stopWatch()
    }
  })

  test('strict 契约：watch 回调 + 具名 sync 与组件实现文案一致（防止实现漂移）', () => {
    expect(source).toContain('{ immediate: true }')
    expect(/\{\s*immediate:\s*true\s*\}/.test(source)).toBe(true)
    expect(source).toContain('documentPath.value = store.getStorageBinding()?.documentId ??')
    expect(source).not.toContain('documentPath = computed(')
  })
})