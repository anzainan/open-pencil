import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from '../../custom/file-bridge/server'
import { BridgeClient } from '@/app/bridge/client'
import { createBridgeStorageAdapter } from '@/app/bridge/storage-adapter'
import {
  BRIDGE_STORAGE_PROVIDER,
  storageProviderRegistry
} from '@/app/integrations/storage/providers'

const PORT = 18777
const TOKEN = 'testtoken'
const BASE = `http://127.0.0.1:${PORT}/api/v1`

const root = mkdtempSync(join(tmpdir(), 'p3-smoke-'))
const designRoot = join(root, 'design')
const stateDir = join(root, 'state')
const distDir = join(root, 'dist')
mkdirSync(designRoot, { recursive: true })
mkdirSync(distDir, { recursive: true })
writeFileSync(join(distDir, 'index.html'), '<html><body>smoke</body></html>')
mkdirSync(join(distDir, 'assets'), { recursive: true })
writeFileSync(join(distDir, 'assets', 'boot.js'), 'export const boot = true')
mkdirSync(join(designRoot, 'PixelMob'), { recursive: true })
writeFileSync(join(designRoot, 'PixelMob', 'login.fig'), 'FIG-LOGIN-CONTENT')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS ${name}`)
  } else {
    fail++
    console.error(`  FAIL ${name} ${detail}`)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type MsgEvent = { type: string; data: string; lastEventId: string }
class FakeEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, Set<(e: MsgEvent) => void>>()
  constructor(url: string) {
    void this.connect(url)
  }
  private async connect(url: string) {
    const res = await fetch(url)
    const reader = res.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      while (true) {
        const sep = buf.indexOf('\n\n')
        if (sep < 0) break
        const chunk = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        const evt = /^event: (\S+)/m.exec(chunk)?.[1]
        const data = /^data: (.+)$/m.exec(chunk)?.[1]
        const id = /^id: (.+)$/m.exec(chunk)?.[1]
        if (!evt) continue
        if (evt === 'hello') {
          this.onopen?.()
          continue
        }
        for (const fn of this.listeners.get(evt) ?? []) {
          fn({ type: evt, data: data ?? '', lastEventId: id ?? '' })
        }
      }
    }
  }
  addEventListener(type: string, fn: (e: MsgEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(fn)
  }
}
// @ts-expect-error polyfill EventSource (browser API absent in Bun)
globalThis.EventSource = FakeEventSource

async function main() {
  const server = startServer({ port: PORT, designRoot, stateDir, distDir, token: TOKEN })

  const client = new BridgeClient({ apiBase: BASE })

  // ---- 0. SPA static paths ----
  console.log('\n[0] SPA static paths')
  const asset = await fetch(`http://127.0.0.1:${PORT}/Mobai/assets/boot.js`)
  check('Mobai-prefixed asset resolves to dist asset', asset.status === 200)
  check('Mobai-prefixed asset is JavaScript, not SPA HTML', (await asset.text()) === 'export const boot = true')

  // ---- 1. bridge-fs provider registration ----
  console.log('\n[1] bridge-fs provider registration')
  check('provider id bridge-fs registered', storageProviderRegistry.get('bridge-fs').id === 'bridge-fs')
  check(
    'bridge-fs in registry list',
    storageProviderRegistry.list().some((p) => p.id === 'bridge-fs')
  )
  check('no credential fields required', BRIDGE_STORAGE_PROVIDER.credentialFields.length === 0)

  // ---- 2. open via provider ----
  console.log('\n[2] open file via bridge-fs provider')
  const adapter = createBridgeStorageAdapter(
    { preferences: {}, resolveCredential: async () => null },
    client
  )
  const docs = await adapter.listDocuments()
  check('listDocuments returns bridge file', docs.some((d) => d.id === 'PixelMob/login.fig'))
  const bytes = await adapter.getDocument('PixelMob/login.fig')
  check(
    'getDocument content matches disk',
    new TextDecoder().decode(bytes) === 'FIG-LOGIN-CONTENT',
    `got ${new TextDecoder().decode(bytes)}`
  )

  // ---- 3. write lands on disk (GET readback) ----
  console.log('\n[3] write via provider → disk readback')
  const payload = new TextEncoder().encode('HELLO-BRIDGE-V3')
  await adapter.putDocument('PixelMob/note.fig', payload, {
    name: 'note',
    updatedAt: new Date().toISOString()
  })
  const back = await adapter.getDocument('PixelMob/note.fig')
  check('putDocument then getDocument roundtrip', new TextDecoder().decode(back) === 'HELLO-BRIDGE-V3')
  const onDisk = readFileSync(join(designRoot, 'PixelMob', 'note.fig'))
  check(
    'file actually on disk',
    onDisk.toString() === 'HELLO-BRIDGE-V3',
    `disk=${onDisk.toString()}`
  )
  const meta = await client.getFileMeta('PixelMob/note.fig')
  check('meta after write', meta !== null && meta.size === payload.byteLength)

  // ---- 4. SSE events received (AI external write → file.changed) ----
  console.log('\n[4] SSE events')
  let reloads = 0
  let lastWrite = 0
  const stopWatch = client.watchPath('PixelMob/login.fig', () => lastWrite, () => {
    reloads++
  })
  await sleep(600)
  writeFileSync(join(designRoot, 'PixelMob', 'login.fig'), 'FIG-CHANGED-BY-AI')
  await sleep(1500)
  check('SSE/external change triggers reload', reloads >= 1, `reloads=${reloads}`)
  lastWrite = Date.now()
  writeFileSync(join(designRoot, 'PixelMob', 'login.fig'), 'FIG-CHANGED-SELF')
  await sleep(1500)
  check('self-write within guard is ignored', reloads === 1, `reloads=${reloads}`)
  stopWatch()

  // ---- 5. active report roundtrip ----
  console.log('\n[5] active report')
  await client.reportActive('PixelMob/note.fig')
  const active = await client.getActive()
  check('active set and read back', active?.path === 'PixelMob/note.fig', JSON.stringify(active))

  // ---- 6. recent list + ordering (history mode view dependency) ----
  console.log('\n[6] recent history')
  await client.reportRecent('PixelMob/login.fig')
  await sleep(10)
  await client.reportRecent('PixelMob/note.fig')
  await client.reportRecent('PixelMob/login.fig')
  const recents = await client.getRecent()
  const order = recents.map((r) => r.path).join(',')
  check('recent deduped + newest-first', order === 'PixelMob/login.fig,PixelMob/note.fig', order)
  const missing = await client.getFileMeta('PixelMob/gone.fig')
  check('missing file meta returns null (file-not-exist hint)', missing === null)

  // ---- 7. token flow ----
  console.log('\n[7] write token')
  const token = await client.getToken()
  check('token retrieved from /config', token === TOKEN, String(token))

  server.stop?.(true)
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('SMOKE ERROR', e)
  process.exit(1)
})
