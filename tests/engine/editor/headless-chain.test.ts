import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { HeadlessEditSession } from '@open-pencil/core/editor'
import { executeRPCCommand } from '@open-pencil/core/rpc'

import { expectDefined } from '#tests/helpers/assert'

beforeAll(async () => {
  await initCodec()
})

describe('headless edit chain: 建→改→质检→落盘→重开 (core pieces used by the MCP node backend)', () => {
  test('new doc → render → batch_update → describe → save to disk → reopen → verify', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'op-headless-chain-'))
    const path = join(dir, 'app.fig')
    try {
      // 建
      const graph = new SceneGraph()
      const session = new HeadlessEditSession({ graph, filePath: path })

      // 改
      const render = await session.applyTool('render', {
        jsx: '<Frame name="登录页" w={390} h={844} bg="#F6F7F8"><Text name="标题">欢迎回来</Text></Frame>'
      })
      expect(render.ok).toBe(true)
      const frameId = (render.result as { id: string }).id
      await session.applyTool('set_fill', { id: frameId, color: '#FFFFFF' })

      // 质检 (describe via executeRPCCommand — the same impl the MCP node backend uses)
      const describeResult = executeRPCCommand(graph, 'describe', { id: frameId }) as {
        nodes: Array<{ name: string; role: string }>
      }
      const report = describeResult.nodes[0]
      expect(report.name).toBe('登录页')
      expect(report.role).toBeDefined()

      // 落盘 (session.exportBytes → writeFile, mirrors the backend save_file)
      const bytes = await session.exportBytes()
      await writeFile(path, bytes)
      expect((await readFile(path)).byteLength).toBeGreaterThan(100)

      // 重开验证 (loadDocument path via parseFigFile)
      const reloadedBytes = new Uint8Array(await readFile(path))
      const reloaded = await parseFigFile(reloadedBytes.buffer as ArrayBuffer, { populate: 'all' })
      const reopened = new HeadlessEditSession({ graph: reloaded })
      expect(reopened.pages().length).toBe(1)
      const frame = [...reloaded.getAllNodes()].find((n) => n.name === '登录页')
      expectDefined(frame, 'reopened 登录页')
      expect(reloaded.getChildren(frame.id).some((c) => c.name === '标题')).toBe(true)
      // layout was recomputed before write: frame still 390x844
      expect(frame.width).toBe(390)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
