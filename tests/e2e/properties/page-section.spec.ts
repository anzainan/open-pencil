import type { Color } from '@open-pencil/core'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { propertySection } from '#tests/helpers/properties'

const editor = useEditorSetup()

function pageColor() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.pageColor
  })
}

test('page background uses the shared paint field for hex and alpha', async () => {
  const pageSection = propertySection(editor.page, 'Page')
  await expect(pageSection).toBeVisible()

  const hex = pageSection.getByRole('textbox', { name: 'Page background' })
  await hex.fill('336699')
  await hex.press('Enter')
  await editor.canvas.waitForRender()

  let color = await pageColor()
  expect(color.r).toBeCloseTo(0.2, 2)
  expect(color.g).toBeCloseTo(0.4, 2)
  expect(color.b).toBeCloseTo(0.6, 2)

  const opacity = pageSection.getByRole('spinbutton', { name: 'Opacity' })
  await opacity.click()
  await opacity.fill('50')
  await opacity.press('Enter')
  await editor.canvas.waitForRender()

  color = await pageColor()
  expect(color.a).toBeCloseTo(0.5, 2)
  editor.canvas.assertNoErrors()
})

test('page background persists to the page node and restores after reload', async () => {
  const pageSection = propertySection(editor.page, 'Page')
  await expect(pageSection).toBeVisible()

  const hex = pageSection.getByRole('textbox', { name: 'Page background' })
  await hex.fill('336699')
  await hex.press('Enter')
  await editor.canvas.waitForRender()

  const pageId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.currentPageId
  })

  // Write-back: the color is stored on the page node so .fig export keeps it.
  const fields = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(id)
    return page?.source?.fig?.rawNodeFields
  }, pageId)
  const bg = fields?.backgroundColor as Color | undefined
  expect(bg?.r).toBeCloseTo(0.2, 2)
  expect(bg?.g).toBeCloseTo(0.4, 2)
  expect(bg?.b).toBeCloseTo(0.6, 2)
  expect(Array.isArray(fields?.backgroundPaints)).toBe(true)

  // Read-back: leave the page and return — the background comes back from the node.
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.addPage('Reload Check')
  })
  await editor.canvas.waitForRender()

  let color = await pageColor()
  expect(color.r).toBeCloseTo(0.96, 2)

  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    void store.switchPage(id)
  }, pageId)
  await editor.canvas.waitForRender()

  color = await pageColor()
  expect(color.r).toBeCloseTo(0.2, 2)
  expect(color.g).toBeCloseTo(0.4, 2)
  expect(color.b).toBeCloseTo(0.6, 2)
  editor.canvas.assertNoErrors()
})
