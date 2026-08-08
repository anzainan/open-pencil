import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const fixture = readFileSync('tests/fixtures/gold-preview.fig')

function mockBridgeWorkspace(page: import('@playwright/test').Page) {
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
