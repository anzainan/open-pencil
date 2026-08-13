import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const fixture = readFileSync('tests/fixtures/gold-preview.fig')

function mockBridgeWorkspace(page: Page) {
  void page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const pathname = decodeURIComponent(url.pathname)

    if (pathname === '/api/v1/config') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          version: '0.3.0',
          designRoot: '/data/design',
          token: 'test-token'
        })
      })
      return
    }

    if (pathname === '/api/v1/fonts') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ fonts: [] }) })
      return
    }

    if (pathname === '/api/v1/events') {
      await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' })
      return
    }

    if (pathname === '/api/v1/files') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            {
              brand: '',
              files: [
                {
                  path: 'remote-1.fig',
                  name: 'remote-1.fig',
                  ext: 'fig',
                  size: fixture.byteLength,
                  mtime: '2026-01-02T03:04:05.000Z',
                  updatedAt: '2026-01-02T03:04:05.000Z'
                }
              ]
            }
          ],
          flat: [
            {
              path: 'remote-1.fig',
              name: 'remote-1.fig',
              ext: 'fig',
              size: fixture.byteLength,
              mtime: '2026-01-02T03:04:05.000Z',
              updatedAt: '2026-01-02T03:04:05.000Z'
            }
          ]
        })
      })
      return
    }

    if (pathname === '/api/v1/files/remote-1.fig' && method === 'GET') {
      await route.fulfill({
        contentType: 'application/octet-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: fixture
      })
      return
    }

    if (pathname === '/api/v1/files/remote-1.fig/meta') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          path: 'remote-1.fig',
          name: 'remote-1.fig',
          ext: 'fig',
          size: fixture.byteLength,
          mtime: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z'
        })
      })
      return
    }

    if ((pathname === '/api/v1/recent' || pathname === '/api/v1/active') && method === 'POST') {
      await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
      return
    }

    await route.fulfill({ status: 404, body: '{}' })
  })
}

test('bridge-fs storage workspace lists and opens a workspace document', async ({ page }) => {
  mockBridgeWorkspace(page)

  await page.goto('/storage?test')
  const canvas = new CanvasHelper(page)

  await expect(page.getByTestId('storage-workspace')).toBeVisible()
  await expect(page.getByTestId('storage-new-document')).toBeEnabled()
  await expect(page.getByText('remote-1')).toBeVisible()

  await page.locator('[data-document-id="remote-1.fig"]').click()
  await expect(page).toHaveURL(/\/$/)
  await canvas.waitForInit()
  await expect(page.getByText('remote-1').first()).toBeVisible()
})

test('bridge-fs storage workspace is configured by default (no S3 config form)', async ({
  page
}) => {
  mockBridgeWorkspace(page)

  await page.goto('/storage?test')

  await expect(page.getByTestId('storage-workspace')).toBeVisible()
  await expect(
    page.getByText('Configure storage before using this workspace.')
  ).not.toBeVisible()
  await expect(page.getByTestId('storage-new-document')).toBeEnabled()

  await page.getByRole('button', { name: 'Settings' }).last().click()
  await expect(page.getByTestId('settings-storage-panel')).toBeVisible()
  await expect(page.getByTestId('settings-storage-workspace-managed')).toBeVisible()
  await expect(page.getByLabel('Endpoint')).not.toBeVisible()
})

test('configured storage lists previews through ranges before opening the document', async ({
  page
}) => {
  let fullDocumentGets = 0
  let rangeGets = 0
  await page.route('https://s3.example.com/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('list-type') === '2') {
      await route.fulfill({
        contentType: 'application/xml',
        body: `<ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Contents>
            <Key>open_pencil_storage/canvases/remote-1.fig</Key>
            <LastModified>2026-01-02T03:04:05.000Z</LastModified>
            <Size>${fixture.byteLength}</Size>
          </Contents>
        </ListBucketResult>`
      })
      return
    }
    if (url.pathname.endsWith('/remote-1.meta.json')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ name: 'Remote design', updatedAt: '2026-01-02T03:04:05.000Z' })
      })
      return
    }
    if (url.pathname.endsWith('/remote-1.fig') && route.request().headers().range) {
      const range = route.request().headers().range
      const explicit = range?.match(/^bytes=(\d+)-(\d+)$/)
      const suffix = range?.match(/^bytes=-(\d+)$/)
      let start: number
      let end: number
      if (explicit) {
        start = Number(explicit[1])
        end = Math.min(Number(explicit[2]), fixture.byteLength - 1)
      } else if (suffix) {
        const length = Math.min(Number(suffix[1]), fixture.byteLength)
        start = fixture.byteLength - length
        end = fixture.byteLength - 1
      } else {
        await route.fulfill({ status: 416 })
        return
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        await route.fulfill({ status: 416 })
        return
      }
      await route.fulfill({
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fixture.byteLength}`
        },
        contentType: 'application/octet-stream',
        body: fixture.subarray(start, end + 1)
      })
      rangeGets++
      return
    }
    if (url.pathname.endsWith('/remote-1.fig') && route.request().method() === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Length': String(fixture.byteLength) }
      })
      return
    }
    if (url.pathname.endsWith('/remote-1.fig')) {
      fullDocumentGets++
      await route.fulfill({ contentType: 'application/octet-stream', body: fixture })
      return
    }
    await route.fulfill({ status: 404 })
  })

  await page.goto('/storage?test')
  const canvas = new CanvasHelper(page)
  await page.getByRole('button', { name: 'Settings' }).last().click()
  await page.getByLabel('Endpoint').fill('https://s3.example.com')
  await page.getByLabel('Bucket').fill('designs')

  for (const [field, value] of [
    ['access-key-id', 'access-key'],
    ['secret-access-key', 'secret-key']
  ] as const) {
    const container = page.locator(`[data-credential="${field}"]`)
    await container.locator('input').fill(value)
    await container.getByRole('button', { name: 'Save' }).click()
  }

  await page.getByTestId('settings-storage-open-workspace').click()
  await expect(page.getByTestId('storage-workspace')).toBeVisible()
  await expect(page.getByText('Remote design')).toBeVisible()
  const preview = page.locator('[data-document-id="remote-1"] img')
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('src', /^blob:/)
  expect(rangeGets).toBe(3)
  expect(fullDocumentGets).toBe(0)

  await page.locator('[data-document-id="remote-1"]').click()
  await expect(page).toHaveURL(/\/$/)
  await canvas.waitForInit()
  await expect(page.getByText('Remote design').first()).toBeVisible()
  expect(fullDocumentGets).toBe(1)
})

test('storage workspace directs unconfigured users to Settings', async ({ page }) => {
  await page.goto('/storage?test')

  await expect(page.getByTestId('storage-workspace')).toBeVisible()
  await expect(page.getByText('Configure storage before using this workspace.')).toBeVisible()
  await expect(page.getByTestId('storage-new-document')).toBeDisabled()

  await page.getByRole('button', { name: 'Settings' }).last().click()
  await expect(page.getByTestId('settings-storage-panel')).toBeVisible()
})
