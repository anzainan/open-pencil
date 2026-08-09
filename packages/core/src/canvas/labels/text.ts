import type { Font } from 'canvaskit-wasm'

export function measureLabelText(font: Font, text: string): number {
  const glyphIds = font.getGlyphIDs(text)
  const widths = font.getGlyphWidths(glyphIds)
  let result = 0
  for (const width of widths) result += width
  return result
}

export function ellipsizeLabelText(font: Font, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (measureLabelText(font, text) <= maxWidth) return text

  const ellipsis = '…'
  const ellipsisWidth = measureLabelText(font, ellipsis)
  if (maxWidth <= ellipsisWidth) return ellipsis

  let width = 0
  let end = 0
  const glyphIds = font.getGlyphIDs(text)
  const widths = font.getGlyphWidths(glyphIds)
  for (let index = 0; index < widths.length; index++) {
    if (width + widths[index] + ellipsisWidth > maxWidth) break
    width += widths[index]
    end = index + 1
  }
  return text.slice(0, end) + ellipsis
}

/** 文本在 `font` 里是否有缺失字形（glyph id 为 0 = 无此字形，如 Inter 缺中文）。 */
export function fontMissingGlyphs(font: Font, text: string): boolean {
  if (!text) return false
  const glyphIds = font.getGlyphIDs(text)
  for (const id of glyphIds) {
    if (id === 0) return true
  }
  return false
}

/**
 * 选择绘制标签的字体：主字体（Inter）缺字形（如中文）且存在 CJK 兜底字体时，
 * 改用 CJK 变体；否则保持主字体（西文样式不退化）。
 */
export function pickLabelFont(
  primary: Font,
  cjk: Font | null | undefined,
  text: string
): Font {
  if (cjk && fontMissingGlyphs(primary, text)) return cjk
  return primary
}
