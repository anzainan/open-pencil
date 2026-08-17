import { describe, expect, test } from 'bun:test'

import { createDocumentSourceState } from '@/app/document/io/source-state'

/**
 * REQ-1（RC-A）：binding 就绪的真反应式信号。
 *
 * 根因是自动进房 watch 依赖 documentName，而「先置 documentName、后设 binding」的时序
 * 下 documentName 同值二次赋值不触发（值不变陷阱）。修法是给 `setStorageBinding` 同步刷新
 * 一个 reactive ref（getBindingDocumentId），binding null → 有值 必然产生依赖变化。
 *
 * 本测试断言：setStorageBinding 后 ref 立即更新；置 null 后复位；多 store 实例互不串扰。
 */
describe('document/io source-state binding signal（REQ-1）', () => {
  test('setStorageBinding(binding) → getBindingDocumentId ref 变为 documentId', () => {
    const state = createDocumentSourceState()
    const ref = state.getBindingDocumentId()
    expect(ref.value).toBeNull()

    state.setStorageBinding({ providerId: 'bridge-fs', documentId: 'PixelMob/login.fig' })
    expect(ref.value).toBe('PixelMob/login.fig')
    expect(state.getStorageBinding()?.documentId).toBe('PixelMob/login.fig')
  })

  test('setStorageBinding(null) → ref 复位为 null（值不变陷阱的解除）', () => {
    const state = createDocumentSourceState()
    state.setStorageBinding({ providerId: 'bridge-fs', documentId: 'A/B.fig' })
    state.setStorageBinding(null)
    expect(state.getBindingDocumentId().value).toBeNull()
  })

  test('两个 store 实例信号互不串扰（每 store 独立 ref）', () => {
    const a = createDocumentSourceState()
    const b = createDocumentSourceState()
    a.setStorageBinding({ providerId: 'bridge-fs', documentId: 'a.fig' })
    b.setStorageBinding({ providerId: 'bridge-fs', documentId: 'b.fig' })
    expect(a.getBindingDocumentId().value).toBe('a.fig')
    expect(b.getBindingDocumentId().value).toBe('b.fig')
  })
})
