import { fontManager } from '@open-pencil/core/text'

import { bridgeClient } from '@/app/bridge/client'

/**
 * 工作区字体加载：扫描 file-bridge 的 fonts/ 文件夹，把 .ttf/.otf/.woff/.woff2
 * 注册进 FontManager（CanvasKit + document.fonts），并让它们出现在画布字体列表。
 * 参考 core FontManager.markLoaded 的 registerFont 机制。
 */

export interface WorkspaceFontFace {
  family: string
  style: string
  path: string
}

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

const STYLE_TOKENS = new Set([
  'thin',
  'extralight',
  'ultralight',
  'light',
  'regular',
  'normal',
  'book',
  'roman',
  'medium',
  'semibold',
  'demibold',
  'bold',
  'extrabold',
  'ultrabold',
  'black',
  'heavy',
  'italic',
  'oblique'
])

function resolveWorkspaceFontFace(
  fileName: string,
  ext: string,
  buffer?: ArrayBuffer
): WorkspaceFontFace {
  if (buffer && (ext === 'ttf' || ext === 'otf')) {
    const parsed = parseSfntNameTable(buffer)
    if (parsed?.family) {
      return {
        family: parsed.family,
        style: parsed.subfamily?.trim() || 'Regular',
        path: fileName
      }
    }
  }
  const base = fileName.replace(/\.(ttf|otf|woff|woff2)$/i, '')
  const { family, style } = splitFamilyStyleFromFileName(base)
  return { family: family || 'Untitled Font', style, path: fileName }
}

function splitFamilyStyleFromFileName(base: string): { family: string; style: string } {
  const parts = base.split(/[\s\-_]+/u).filter((part) => part.length > 0)
  const styleParts: string[] = []
  for (;;) {
    const last = parts[parts.length - 1]
    if (!last || !STYLE_TOKENS.has(last.toLowerCase())) break
    styleParts.unshift(parts.pop() as string)
  }
  return {
    family: parts.join(' ') || base,
    style: styleParts.length > 0 ? styleParts.join(' ') : 'Regular'
  }
}

// ---- sfnt name table 解析（TTF/OTF，取 family/subfamily）----

function decodeUtf16BE(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let i = start; i + 1 < start + length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1]
    if (code === 0) continue
    out += String.fromCharCode(code)
  }
  return out
}

function decodeLatin1(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let i = start; i < start + length; i++) {
    if (bytes[i] === 0) continue
    out += String.fromCharCode(bytes[i])
  }
  return out
}

interface SfntNameEntry {
  nameID: number
  platform: number
  text: string
}

export function parseSfntNameTable(
  buffer: ArrayBuffer
): { family?: string; subfamily?: string } | null {
  const length = buffer.byteLength
  if (length < 12) return null
  const view = new DataView(buffer)
  const version = view.getUint32(0, false)
  if (version === 0x74746366) return null // 'ttcf' 字体集合不支持

  const numTables = view.getUint16(4, false)
  let nameOffset = -1
  let nameLength = 0
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    if (record + 16 > length) break
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3)
    )
    if (tag === 'name') {
      nameOffset = view.getUint32(record + 8, false)
      nameLength = view.getUint32(record + 12, false)
      break
    }
  }
  if (nameOffset < 0 || nameOffset + nameLength > length || nameLength < 6) return null

  const nameView = new DataView(buffer, nameOffset, nameLength)
  const count = nameView.getUint16(2, false)
  const stringOffset = nameView.getUint16(4, false)
  const bytes = new Uint8Array(buffer, nameOffset, nameLength)

  const entries: SfntNameEntry[] = []
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12
    if (record + 12 > nameLength) break
    const platform = nameView.getUint16(record, false)
    const nameID = nameView.getUint16(record + 6, false)
    const strLength = nameView.getUint16(record + 8, false)
    const strOffset = nameView.getUint16(record + 10, false)
    const start = stringOffset + strOffset
    if (start + strLength > nameLength) continue
    const text =
      platform === 0 || platform === 3
        ? decodeUtf16BE(bytes, start, strLength)
        : decodeLatin1(bytes, start, strLength)
    if (text) entries.push({ nameID, platform, text })
  }

  const pick = (nameIDs: number[]): string | undefined => {
    for (const id of nameIDs) {
      const candidates = entries.filter((entry) => entry.nameID === id)
      if (candidates.length === 0) continue
      candidates.sort(
        (first, second) => (second.platform === 3 ? 1 : 0) - (first.platform === 3 ? 1 : 0)
      )
      return candidates[0].text
    }
    return undefined
  }

  return {
    family: pick([16, 1]),
    subfamily: pick([17, 2])
  }
}
