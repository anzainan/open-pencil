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

async function decodeImageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return dimensions
  } catch {
    return null
  }
}

function estimateDisplaySize(payload: string): { width: number; height: number } {
  try {
    const parsed = JSON.parse(payload) as {
      url: string
      width?: number
      height?: number
      displayWidth?: number
      displayHeight?: number
    }
    if (parsed.displayWidth && parsed.displayHeight) {
      return { width: parsed.displayWidth, height: parsed.displayHeight }
    }
    if (parsed.width && parsed.height) {
      const estW = Math.min(parsed.width, 1200)
      return { width: estW, height: Math.round((estW * parsed.height) / parsed.width) }
    }
  } catch (error) {
    console.warn('Invalid stock image drag payload, using fallback size', error)
  }
  return { width: 200, height: 160 }
}

async function placeStockImage(payload: string, cx: number, cy: number, editor: Editor) {
  if (isPlacingStockImage) return // 防重复拖拽
  isPlacingStockImage = true

  // 解析拖拽数据（JSON：{url, width, height, displayWidth, displayHeight}），兼容旧格式（纯 url）。
  // 阶段 1 用估算尺寸立即建占位，阶段 2 解码后按真实尺寸校正。
  let url: string
  try {
    url = (JSON.parse(payload) as { url: string }).url
  } catch {
    url = payload
  }
  const estimate = estimateDisplaySize(payload)

  let placeholderId: string | null = null
  try {
    // 阶段 1：拖拽瞬间（fetch 之前）按估算尺寸立即建占位并选中，无空白期
    const placeholder = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      x: cx - estimate.width / 2,
      y: cy - estimate.height / 2,
      width: estimate.width,
      height: estimate.height,
      fills: [
        { type: 'SOLID', color: { r: 0.92, g: 0.92, b: 0.92, a: 1 }, opacity: 0.6, visible: true }
      ],
      name: '正在加载…'
    })
    placeholderId = placeholder.id
    // 占位中间加「图片加载中」文字，字号随占位尺寸缩放保证清晰可读
    const labelWidth = Math.min(120, estimate.width - 8)
    const fontSize = Math.min(32, Math.max(16, Math.round(estimate.width / 40)))
    const textNode = editor.graph.createNode('TEXT', placeholder.id, {
      name: '加载中',
      text: '图片加载中',
      x: (estimate.width - labelWidth) / 2,
      y: (estimate.height - fontSize) / 2,
      width: labelWidth,
      height: fontSize,
      fontSize,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'CENTER'
    })
    // 立即选中占位 → 显示选中态选框（蓝色虚线框 + 控制点 + 旋转手柄 + 尺寸标注）
    editor.select([placeholder.id])
    editor.requestRender()

    // 阶段 2：下载 → 解码 → 校正占位尺寸 → 换真图
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch stock image (${response.status})`)
    const blob = await response.blob()
    const file = new File([blob], 'stock-photo.jpg', {
      type: response.headers.get('content-type') ?? 'image/jpeg'
    })
    const decoded = await decodeImageDimensions(blob)

    // 解码成功且与估算尺寸偏差 > 1px：updateNode 校正占位（保持中心点不变，不删除重建），
    // 避免正在拖动的选框被破坏；同步校正 TEXT 子节点（x/y 相对父节点）。
    if (decoded && (Math.abs(decoded.width - estimate.width) > 1 || Math.abs(decoded.height - estimate.height) > 1)) {
      const width = decoded.width
      const height = decoded.height
      editor.graph.updateNode(placeholderId, {
        x: cx - width / 2,
        y: cy - height / 2,
        width,
        height
      })
      const resizedLabelWidth = Math.min(120, width - 8)
      const resizedFontSize = Math.min(32, Math.max(16, Math.round(width / 40)))
      editor.graph.updateNode(textNode.id, {
        x: (width - resizedLabelWidth) / 2,
        y: (height - resizedFontSize) / 2,
        width: resizedLabelWidth,
        height: resizedFontSize,
        fontSize: resizedFontSize
      })
    }
    editor.requestRender()

    // 删占位，放真图（真图落在解码尺寸，与校正后占位一致；placeFiles 后新图会保持选中）
    editor.graph.deleteNode(placeholder.id)
    placeholderId = null
    await editor.placeFiles([file], cx, cy)
  } catch (error) {
    console.error('Failed to place stock image', error)
    if (placeholderId) editor.graph.deleteNode(placeholderId) // 失败也删占位
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

    const stockURL = e.dataTransfer?.getData(STOCK_IMAGE_MIME)
    if (stockURL) {
      void placeStockImage(stockURL, point.x, point.y, editor)
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
