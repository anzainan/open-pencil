import { describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { SceneGraph } from '@open-pencil/scene-graph'

import { startServer } from '#mcp/server'

import {
  connectMockBrowser,
  waitForBrowserRegistration,
  type MockBrowser
} from '#tests/helpers/mcp/server'

const isUnix = process.platform !== 'win32'
const SOCKET_DIR = join(tmpdir(), `openpencil-save-path-${process.pid}`)
const TEST_MCP_ROOT = join(tmpdir(), 'open-pencil-save-path-root')
const AUTH_TOKEN = 'test-save-path-token'
let testCounter = 0

function testSocketPath(): string | null {
  if (!isUnix) return null
  return join(SOCKET_DIR, `mcp-save-${process.pid}-${++testCounter}.sock`)
}

/**
 * 起真实 MCP server（mcpRoot）＋ 可覆写命令的 mock 浏览器，跑 save_file 路径一致性 warning。
 * 浏览器路径场景：save_file 传 path 时相对/绝对路径按 MCP root 解析，与浏览器当前打开文档
 * path 不一致会写入新文件（刷新回旧文件假象）——工具层应给出 warning。
 */
async function withSavePathServer(
  openPath: string,
  savePath: string,
  fn: (client: Client, browser: MockBrowser) => Promise<void>
) {
  if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
  await mkdir(TEST_MCP_ROOT, { recursive: true })
  const handle = await startServer({
    httpPort: 0,
    withTcp: true,
    socketPath: testSocketPath(),
    authToken: AUTH_TOKEN,
    enableEval: false,
    mcpRoot: TEST_MCP_ROOT
  })

  let browser: MockBrowser | null = null
  let client: Client | null = null
  try {
    const httpPort = handle.httpPort
    if (!httpPort) throw new Error('TCP listener not started')

    browser = await connectMockBrowser(httpPort, new SceneGraph(), AUTH_TOKEN, {
      list_documents: () => ({
        documents: [
          {
            id: 'doc-1',
            name: 'Mock document',
            active: true,
            current_page_id: 'page-1',
            current_page_name: 'Page 1',
            pages: [],
            path: openPath
          }
        ]
      })
    })
    await waitForBrowserRegistration(httpPort)

    client = new Client({ name: 'save-path-test', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${httpPort}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } } }
    )
    await client.connect(transport)

    await fn(client, browser)
  } finally {
    await client?.close().catch(() => undefined)
    browser?.close()
    await handle.close().catch(() => undefined)
  }
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.find((c) => c.type === 'text')?.text ?? ''
}

describe('MCP save_file path-consistency warning', () => {
  test('warns when explicit path differs from the browser-open document path', async () => {
    const openPath = join(TEST_MCP_ROOT, 'current.fig')
    const targetPath = join(TEST_MCP_ROOT, 'task2', 'other.fig')
    await withSavePathServer(openPath, targetPath, async (client) => {
      const result = await client.callTool({
        name: 'save_file',
        arguments: { path: targetPath }
      })

      expect(result.isError).not.toBe(true)
      const text = resultText(result)
      expect(text).toContain('⚠️')
      expect(text).toContain(`保存路径 ${targetPath}`)
      expect(text).toContain('不一致')
      expect(text).toContain('覆盖当前文档请不传 path')
    })
  })

  test('does not warn when explicit path matches the browser-open document path', async () => {
    const samePath = join(TEST_MCP_ROOT, 'same.fig')
    await withSavePathServer(samePath, samePath, async (client) => {
      const result = await client.callTool({
        name: 'save_file',
        arguments: { path: samePath }
      })

      expect(result.isError).not.toBe(true)
      const text = resultText(result)
      expect(text).not.toContain('⚠️')
      expect(text).not.toContain('不一致')
    })
  })
})
