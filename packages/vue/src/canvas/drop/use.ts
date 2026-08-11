import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'

import { findMoveDropTarget } from '#vue/shared/input/drop-target'

const RASTER_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif'
])
const COMPONENT_MIME = 'application/x-openpencil-component'
const STOCK_IMAGE_MIME = 'application/x-openpencil-stock-image'

function hasComponentData(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes(COMPONENT_MIME) ?? false
}

function hasStockImageData(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes(STOCK_IMAGE_MIME) ?? false
}

function dropPoint(e: DragEvent, canvas: HTMLCanvasElement, editor: Editor) {
  const rect = canvas.getBoundingClientRect()
  return editor.screenToCanvas(e.clientX - rect.left, e.clientY - rect.top)
}

let isPlacingStockImage = false // 模块级防重复

async function placeStockImage(payload: string, cx: number, cy: number, editor: Editor) {
  if (isPlacingStockImage) return // 防重复拖拽
  isPlacingStockImage = true

  // 解析拖拽数据（JSON：{url, width, height}），兼容旧格式（纯 url）
  let url: string
  let width = 200
  let height = 160
  try {
    const parsed = JSON.parse(payload) as { url: string; width?: number; height?: number }
    url = parsed.url
    if (parsed.width && parsed.height) {
      width = parsed.width
      height = parsed.height
    }
  } catch {
    url = payload
  }

  // 1. 放真实尺寸占位矩形（半透明灰）
  const placeholder = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    fills: [
      { type: 'SOLID', color: { r: 0.92, g: 0.92, b: 0.92, a: 1 }, opacity: 0.6, visible: true }
    ],
    name: '正在加载…'
  })
  // 2. 占位中间加「图片加载中」文字
  const labelWidth = Math.min(120, width - 8)
  editor.graph.createNode('TEXT', placeholder.id, {
    name: '加载中',
    text: '图片加载中',
    x: (width - labelWidth) / 2,
    y: (height - 20) / 2,
    width: labelWidth,
    height: 20,
    textAlignHorizontal: 'CENTER',
    textAlignVertical: 'CENTER'
  })
  // 3. 立即选中占位 → 显示选中态选框（蓝色虚线框 + 控制点 + 旋转手柄 + 尺寸标注）
  editor.select([placeholder.id])
  editor.requestRender()

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch stock image (${response.status})`)
    const file = new File([new Uint8Array(await response.arrayBuffer())], 'stock-photo.jpg', {
      type: response.headers.get('content-type') ?? 'image/jpeg'
    })
    // 删占位，放真图（placeFiles 后新图会保持选中）
    editor.graph.deleteNode(placeholder.id)
    await editor.placeFiles([file], cx, cy)
  } catch (error) {
    console.error('Failed to place stock image', error)
    editor.graph.deleteNode(placeholder.id) // 失败也删占位
    editor.requestRender()
  } finally {
    isPlacingStockImage = false
  }
}

function componentDropPlacement(componentId: string, cx: number, cy: number, editor: Editor) {
  const component = editor.graph.getNode(componentId)
  if (component?.type !== 'COMPONENT') return null

  const target = findMoveDropTarget(cx, cy, editor)
  const parentId = target?.id ?? editor.state.currentPageId
  const parentOffset =
    parentId === editor.state.currentPageId
      ? { x: 0, y: 0 }
      : editor.graph.getAbsolutePosition(parentId)
  return {
    parentId,
    x: cx - parentOffset.x - component.width / 2,
    y: cy - parentOffset.y - component.height / 2
  }
}

export function useCanvasDrop(canvasRef: Ref<HTMLCanvasElement | null>, editor: Editor) {
  const isDraggingOver = ref(false)

  useEventListener(canvasRef, 'dragover', (e: DragEvent) => {
    if (!hasComponentData(e) && !hasFileData(e) && !hasStockImageData(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    isDraggingOver.value = true
  })

  useEventListener(canvasRef, 'dragenter', (e: DragEvent) => {
    if (!hasComponentData(e) && !hasFileData(e) && !hasStockImageData(e)) return
    e.preventDefault()
    isDraggingOver.value = true
  })

  useEventListener(canvasRef, 'dragleave', () => {
    isDraggingOver.value = false
  })

  useEventListener(canvasRef, 'drop', (e: DragEvent) => {
    e.preventDefault()
    isDraggingOver.value = false

    const canvas = canvasRef.value
    if (!canvas) return
    const point = dropPoint(e, canvas, editor)

    const componentId = e.dataTransfer?.getData(COMPONENT_MIME)
    if (componentId) {
      const placement = componentDropPlacement(componentId, point.x, point.y, editor)
      if (!placement) return
      editor.createInstanceFromComponent(componentId, placement.x, placement.y, placement.parentId)
      editor.requestRender()
      return
    }

    const stockUrl = e.dataTransfer?.getData(STOCK_IMAGE_MIME)
    if (stockUrl) {
      void placeStockImage(stockUrl, point.x, point.y, editor)
      return
    }

    const files = filterCanvasFiles(e.dataTransfer?.files ?? null)
    if (!files.length) return
    void editor.placeFiles(files, point.x, point.y).catch((error: unknown) => {
      console.error('Failed to place dropped files', error)
    })
  })

  return { isDraggingOver }
}

function hasFileData(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false
}

function isSVGFile(file: File): boolean {
  return (
    file.type === 'image/svg+xml' || (file.type === '' && file.name.toLowerCase().endsWith('.svg'))
  )
}

export function filterCanvasFiles(files: ArrayLike<File> | Iterable<File> | null): File[] {
  if (!files) return []
  return Array.from(files).filter((file) => RASTER_IMAGE_TYPES.has(file.type) || isSVGFile(file))
}

export function extractImageFilesFromClipboard(e: ClipboardEvent): File[] {
  const files = e.clipboardData?.files
  return files ? Array.from(files).filter((file) => RASTER_IMAGE_TYPES.has(file.type)) : []
}
