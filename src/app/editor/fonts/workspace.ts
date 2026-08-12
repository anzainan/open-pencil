import {
  fontManager,
  resolveWorkspaceFontFace,
  type WorkspaceFontFace
} from '@open-pencil/core/text'

import { bridgeClient } from '@/app/bridge/client'

export { parseSfntNameTable } from '@open-pencil/core/text'

/**
 * 工作区字体加载：扫描 file-bridge 的 fonts/ 文件夹，把 .ttf/.otf/.woff/.woff2
 * 注册进 FontManager（CanvasKit + document.fonts），并让它们出现在画布字体列表。
 * 参考 core FontManager.markLoaded 的 registerFont 机制。
 */

export type { WorkspaceFontFace }

const registeredFamilies = new Map<string, string>()
let workspaceFamilies: string[] = []
let loadInFlight: Promise<boolean> | null = null

export function workspaceFontFamilies(): readonly string[] {
  return workspaceFamilies
}

/**
 * 扫描并注册工作区字体。幂等：同一文件（path+size）只注册一次；每次扫描重建家族列表。
 * bridge 不可达时静默返回并返回 false（保留上次成功注册的字体）。
 */
export async function loadWorkspaceFonts(): Promise<boolean> {
  if (loadInFlight) return loadInFlight
  loadInFlight = (async () => {
    let fonts
    try {
      fonts = await bridgeClient.listFonts()
    } catch {
      return false
    }
    const families = new Set<string>()
    await Promise.all(
      fonts.map(async (font) => {
        const key = `${font.path}|${font.size}`
        const cachedFamily = registeredFamilies.get(key)
        if (cachedFamily) {
          families.add(cachedFamily)
          return
        }
        try {
          const bytes = await bridgeClient.getFont(font.path)
          const buffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer
          const { family, style } = resolveWorkspaceFontFace(font.name, font.ext, buffer)
          fontManager.markLoaded(family, style, buffer)
          registeredFamilies.set(key, family)
          families.add(family)
        } catch (error) {
          console.warn('[workspace-fonts] 字体加载失败', font.path, error)
        }
      })
    )
    workspaceFamilies = [...families].sort((a, b) => a.localeCompare(b))
    return true
  })().finally(() => {
    loadInFlight = null
  })
  return loadInFlight
}
