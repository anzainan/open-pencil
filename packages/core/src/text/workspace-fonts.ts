import { fontManager } from './fonts'

export interface WorkspaceFontFace {
  family: string
  style: string
  path: string
}

export const FONT_FILE_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'] as const

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

export function resolveWorkspaceFontFace(
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

export interface WorkspaceFontFile {
  name: string
  ext: string
  data: ArrayBuffer
}

export function isFontFileExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return FONT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * Scan a directory for font files (Node only). Returns raw file entries so
 * callers can register them through {@link registerWorkspaceFontFiles}.
 * Resolves the directory even when it does not exist (returns []).
 */
export async function scanFontDirectory(dir: string): Promise<WorkspaceFontFile[]> {
  const { readdir, readFile, stat } = await import(/* @vite-ignore */ 'node:fs/promises')
  const { extname, join } = await import(/* @vite-ignore */ 'node:path')
  let entries
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const files: WorkspaceFontFile[] = []
  for (const name of entries) {
    const ext = extname(name).toLowerCase().slice(1)
    if (!FONT_FILE_EXTENSIONS.includes(`.${ext}` as (typeof FONT_FILE_EXTENSIONS)[number])) {
      continue
    }
      const fullPath = join(dir, name)
      try {
        if ((await stat(fullPath)).isDirectory()) continue
        const bytes = await readFile(fullPath)
        const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        files.push({ name, ext, data })
      } catch (error) {
        // Skip unreadable files instead of failing the whole scan.
        console.warn(`[workspace-fonts] 跳过不可读字体文件 ${fullPath}:`, error)
      }
  }
  return files
}

/**
 * Register a list of font files into the shared FontManager (CanvasKit +
 * browser document.fonts). Idempotent per file. Returns the resolved family
 * names sorted, mirroring the browser workspace-fonts scan.
 */
export function registerWorkspaceFontFiles(files: WorkspaceFontFile[]): string[] {
  const families = new Set<string>()
  for (const file of files) {
    const { family, style } = resolveWorkspaceFontFace(file.name, file.ext, file.data)
    fontManager.markLoaded(family, style, file.data)
    families.add(family)
  }
  return [...families].sort((a, b) => a.localeCompare(b))
}
