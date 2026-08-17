import { afterEach, describe, expect, mock, test } from 'bun:test'
import type * as TeamStoreModule from '@/app/settings/team-store'

/**
 * 团队空间 store 健壮性（ARCH-usersys-member-load-fail §6 P0-1 / §7 新增断言）：
 * - 单飞锁：并发 ensureLoad/load 只发一次 GET；
 * - 请求序列号：过期（慢）响应不覆盖新值；
 * - 失败置 teamMembersError 且不清空已载 rows，成功后清除；
 * - addTeamMember 误报消除：createMember 成功即成功，刷新失败不再产生「添加失败」、
 *   且成员不重复创建。
 *
 * 桩掉 @/app/bridge/share（真实模块会连桥接 HTTP），store 直接用 mock 导出。
 */
const listMembersMock = mock()
const createMemberMock = mock()
const updateMemberMock = mock()
const deleteMemberMock = mock()

mock.module('@/app/bridge/share', () => ({
  listMembers: listMembersMock,
  createMember: createMemberMock,
  updateMember: updateMemberMock,
  deleteMember: deleteMemberMock
}))

interface FakeMember {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member'
  avatar: { char: string; bg: string }
  email: string
  createdAt: string
}

function member(name: string, role: 'owner' | 'admin' | 'member' = 'member'): FakeMember {
  return {
    id: name,
    name,
    role,
    avatar: { char: name.charAt(0) || '?', bg: '#3B82F6' },
    email: '',
    createdAt: '2026-08-17T00:00:00.000Z'
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function loadStore(): Promise<typeof TeamStoreModule> {
  return import('@/app/settings/team-store')
}

afterEach(() => {
  listMembersMock.mockReset()
  createMemberMock.mockReset()
  updateMemberMock.mockReset()
  deleteMemberMock.mockReset()
})

describe('team-store 成员列表加载健壮性', () => {
  test('并发 2 次 ensureLoad 只发 1 次 GET（单飞锁 spy）', async () => {
    const store = await loadStore()
    const slow = deferred<FakeMember[]>()
    listMembersMock.mockImplementation(() => slow.promise)

    const p1 = store.ensureLoad()
    const p2 = store.ensureLoad()
    // 第二次调用共享 in-flight Promise，不发起新请求。
    expect(listMembersMock.mock.calls.length).toBe(1)

    slow.resolve([member('m1')])
    await Promise.all([p1, p2])
    expect(listMembersMock.mock.calls.length).toBe(1)
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['m1'])
    expect(store.teamMembersError.value).toBe(false)

    // 完成后锁释放：再次 ensureLoad 发起新请求（重试/后续刷新可正常触发）。
    listMembersMock.mockImplementation(() => Promise.resolve([member('m2')]))
    await store.ensureLoad()
    expect(listMembersMock.mock.calls.length).toBe(2)
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['m2'])
  })

  test('请求 B 晚到不覆盖请求 A 的新值（序列号守卫）', async () => {
    const store = await loadStore()
    const slowA = deferred<FakeMember[]>()
    const slowB = deferred<FakeMember[]>()
    let callIndex = 0
    listMembersMock.mockImplementation(() => {
      const index = callIndex
      callIndex += 1
      return index === 0 ? slowA.promise : slowB.promise
    })

    const pA = store.loadTeamMembers()
    const pB = store.loadTeamMembers()
    slowB.resolve([member('b')])
    await pB
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['b'])

    // A（更早发起、更晚返回）是过期响应，不得覆盖 B 的新值。
    slowA.resolve([member('a')])
    await pA
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['b'])
    expect(store.teamMembersError.value).toBe(false)
  })

  test('失败置 teamMembersError=true 且不清空已载 rows；成功清除', async () => {
    const store = await loadStore()
    listMembersMock.mockImplementation(() => Promise.resolve([member('m1')]))
    await store.loadTeamMembers()
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['m1'])
    expect(store.teamMembersError.value).toBe(false)

    // 桥接窗口期失败：列表保持已载值，仅置错误标记（UI 显示「加载失败·点击重试」）。
    listMembersMock.mockImplementation(() => Promise.reject(new Error('network down')))
    await expect(store.loadTeamMembers()).rejects.toThrow('network down')
    expect(store.teamMembersError.value).toBe(true)
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['m1'])

    // 恢复后成功：清除错误标记并把列表更新为新值。
    listMembersMock.mockImplementation(() => Promise.resolve([member('m2')]))
    await store.loadTeamMembers()
    expect(store.teamMembersError.value).toBe(false)
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['m2'])
  })

  test('过期失败响应不覆盖新值也不置错（序列号同样守卫失败路径）', async () => {
    const store = await loadStore()
    const slowA = deferred<FakeMember[]>()
    const slowB = deferred<FakeMember[]>()
    let callIndex = 0
    listMembersMock.mockImplementation(() => {
      const index = callIndex
      callIndex += 1
      return index === 0 ? slowA.promise : slowB.promise
    })

    const pA = store.loadTeamMembers()
    const pB = store.loadTeamMembers()
    slowB.resolve([member('fresh')])
    await pB
    // A（旧请求）稍后失败：过期失败既不动数据也不置错误标记（真实最新已成功）。
    slowA.reject(new Error('stale failure'))
    await expect(pA).rejects.toThrow('stale failure')
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['fresh'])
    expect(store.teamMembersError.value).toBe(false)
  })
})

describe('team-store 添加成员误报消除', () => {
  test('createMember 成功 + 刷新失败 → 不产生 team.addFailed 分支、成员不重复创建', async () => {
    const store = await loadStore()
    createMemberMock.mockImplementation(async (input: { name: string; password: string }) => {
      return { user: member(input.name), password: input.password }
    })

    const outcome = await store.addTeamMember({ name: '新成员', password: 'abc123', role: 'member' })
    // createMember 成功即 ok（组件成功分支 → toast 成功 + 复制 + 关闭；绝无 addFailed）。
    expect(outcome.ok).toBe(true)
    expect(createMemberMock.mock.calls.length).toBe(1)

    // 组件第二步：成功后独立刷新；刷新失败走 team.listRefreshFailed 独立提示，
    // 既不会再次调用 createMember（不重复创建），addFailed 只可能来自 ok=false 分支。
    listMembersMock.mockImplementation(() => Promise.reject(new Error('refresh failed')))
    await expect(store.ensureLoad()).rejects.toThrow('refresh failed')
    expect(store.teamMembersError.value).toBe(true)
    expect(createMemberMock.mock.calls.length).toBe(1)

    // createMember 真失败（如 409 重名）→ ok=false（组件唯一展示「添加失败」的入口）。
    createMemberMock.mockImplementation(() => Promise.reject(new Error('user already exists: 重名')))
    const failed = await store.addTeamMember({ name: '重名', password: 'x1', role: 'member' })
    expect(failed.ok).toBe(false)
    expect(createMemberMock.mock.calls.length).toBe(2)
  })

  test('addTeamMember 成功后列表刷新可恢复（failure 后重试成功清错误）', async () => {
    const store = await loadStore()
    createMemberMock.mockImplementation(async (input: { name: string; password: string }) => {
      return { user: member(input.name), password: input.password }
    })
    const outcome = await store.addTeamMember({ name: '阿田', password: 'pw1', role: 'member' })
    expect(outcome.ok).toBe(true)

    // 先成功装载旧列表 → 失败 → 重试成功：现值不丢且错误标记清除。
    listMembersMock.mockImplementation(() => Promise.resolve([member('阿白')]))
    await store.ensureLoad()
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['阿白'])

    listMembersMock.mockImplementation(() => Promise.reject(new Error('down')))
    await expect(store.ensureLoad()).rejects.toThrow('down')
    expect(store.teamMembersError.value).toBe(true)
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['阿白'])

    listMembersMock.mockImplementation(() => Promise.resolve([member('阿白'), member('阿田')]))
    await store.ensureLoad()
    expect(store.teamMembersError.value).toBe(false)
    expect(store.teamMembers.value.map((entry) => entry.id)).toEqual(['阿白', '阿田'])
  })

  test('失败不清空/错误标记不残留：成功后再失败可重复进入错误态', async () => {
    const store = await loadStore()
    listMembersMock.mockImplementation(() => Promise.reject(new Error('first')))
    await expect(store.loadTeamMembers()).rejects.toThrow('first')
    expect(store.teamMembersError.value).toBe(true)

    listMembersMock.mockImplementation(() => Promise.resolve([member('ok')]))
    await store.loadTeamMembers()
    expect(store.teamMembersError.value).toBe(false)
  })
})