import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  COMPONENT_LABEL_FONT_SIZE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  LABEL_FONT_SIZE,
  SECTION_TITLE_FONT_SIZE,
  SIZE_FONT_SIZE
} from '#core/constants'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGraphFontScripts } from '#core/text/resolved-requirements'
import type { FontResolutionSnapshot } from '#core/text/resolver'

export function syncFontGeneration(r: SkiaRenderer): void {
  r.fontGeneration = fontManager.generation()
}

export function trackFontDemand(r: SkiaRenderer, node: SceneNode, key: string): void {
  const pending = r.pendingFontNodes.get(node.id) ?? { node, keys: new Set<string>() }
  pending.node = node
  pending.keys.add(key)
  r.pendingFontNodes.set(node.id, pending)
}

interface TextPictureGenerationState {
  fontGeneration: number
  textPictureGenerations: Map<string, { data: Uint8Array; generation: number }>
}

export function isTextPictureCurrent(r: TextPictureGenerationState, node: SceneNode): boolean {
  const data = node.textPicture
  if (!data) {
    r.textPictureGenerations.delete(node.id)
    return false
  }
  const cached = r.textPictureGenerations.get(node.id)
  if (!cached || cached.data !== data) {
    r.textPictureGenerations.set(node.id, { data, generation: r.fontGeneration })
    return true
  }
  return cached.generation === r.fontGeneration
}

function settleFontDemand(
  r: SkiaRenderer,
  snapshot: FontResolutionSnapshot,
  nodeIds: readonly string[]
): void {
  syncFontGeneration(r)
  for (const nodeId of nodeIds) {
    const pending = r.pendingFontNodes.get(nodeId)
    if (pending) {
      pending.node.textPicture = null
      pending.keys.delete(snapshot.key)
      if (pending.keys.size === 0) r.pendingFontNodes.delete(nodeId)
    }
    r.textPictureGenerations.delete(nodeId)
    r.invalidateNodePicture(nodeId)
  }
}

export function getFontProvider(r: SkiaRenderer) {
  return r.isDestroyed() || !r.fontProvider ? null : r.fontProvider
}

export async function loadFonts(
  r: SkiaRenderer,
  onFallbackFontsLoaded?: () => void
): Promise<void> {
  if (r.isDestroyed()) return
  r.onFontResolutionSettled = (snapshot, nodeIds) => {
    if (r.isDestroyed()) return
    settleFontDemand(r, snapshot, nodeIds)
    onFallbackFontsLoaded?.()
  }
  r.fontProvider?.delete()
  r.fontProvider = r.ck.TypefaceFontProvider.Make()

  fontManager.attachProvider(r.ck, r.fontProvider)
  syncFontGeneration(r)

  const fontData = await fontManager.loadFont(DEFAULT_FONT_FAMILY, 'Regular')
  if (r.isDestroyed()) return
  if (fontData) {
    const typeface = r.ck.Typeface.MakeFreeTypeFaceFromData(fontData)
    if (typeface) {
      r.textFont?.delete()
      r.labelFont?.delete()
      r.sizeFont?.delete()
      r.sectionTitleFont?.delete()
      r.componentLabelFont?.delete()
      r.textFont = new r.ck.Font(typeface, DEFAULT_FONT_SIZE)
      r.labelFont = new r.ck.Font(typeface, LABEL_FONT_SIZE)
      r.sizeFont = new r.ck.Font(typeface, SIZE_FONT_SIZE)
      r.sectionTitleFont = new r.ck.Font(typeface, SECTION_TITLE_FONT_SIZE)
      r.componentLabelFont = new r.ck.Font(typeface, COMPONENT_LABEL_FONT_SIZE)
      r.profiler.setTypeface(typeface)
    }
    r.fontMgr = r.ck.FontMgr.FromData(fontData) ?? null
  }

  await loadCjkLabelFonts(r)

  r.fontsLoaded = true
  syncFontGeneration(r)
  r.invalidateAllPictures()
}

/** 重建 CJK 标签字体（工作区字体晚到/刷新时用）。幂等，无 CJK 字体时静默保持 Inter。 */
export async function refreshCjkLabelFonts(r: SkiaRenderer): Promise<void> {
  if (r.isDestroyed() || !r.fontProvider) return
  await loadCjkLabelFonts(r)
  syncFontGeneration(r)
  r.invalidateAllPictures()
}

/**
 * 为画布 UI 标签创建 CJK 兜底字体：从 fontManager 已注册（含工作区 fonts/）的字体里
 * 找一个覆盖中文的 typeface，创建与西文标签字体同尺寸的 CJK 变体。找不到时静默跳过，
 * 标签绘制用缺字形检测在 Inter 与 CJK 变体间切换（见 canvas/labels/text.ts）。
 */
async function loadCjkLabelFonts(r: SkiaRenderer): Promise<void> {
  const typeface = await resolveCjkLabelTypeface(r)
  if (r.isDestroyed() || !typeface) return
  r.cjkTextFont?.delete()
  r.cjkLabelFont?.delete()
  r.cjkSizeFont?.delete()
  r.cjkSectionTitleFont?.delete()
  r.cjkComponentLabelFont?.delete()
  r.cjkTextFont = new r.ck.Font(typeface, DEFAULT_FONT_SIZE)
  r.cjkLabelFont = new r.ck.Font(typeface, LABEL_FONT_SIZE)
  r.cjkSizeFont = new r.ck.Font(typeface, SIZE_FONT_SIZE)
  r.cjkSectionTitleFont = new r.ck.Font(typeface, SECTION_TITLE_FONT_SIZE)
  r.cjkComponentLabelFont = new r.ck.Font(typeface, COMPONENT_LABEL_FONT_SIZE)
}

/** 取第一个能覆盖中文字形的已注册 typeface；无则 null（保持现状 Inter 单字体）。 */
async function resolveCjkLabelTypeface(r: SkiaRenderer) {
  const families = new Set<string>([
    ...fontManager.getCJKFallbackFamilies(),
    ...fontManager.loadedFamilyNames()
  ])
  // 工作区 fonts/ 是首选中文来源（用户已放思源黑体/得意黑），中文字形检测兜底其他族。
  // 只用「已加载」的字体数据，避免 loadFont 触发在线字体拉取拖慢首帧。
  for (const family of families) {
    const data = fontManager.loadedData(family, 'Regular')
    if (r.isDestroyed() || !data) continue
    const typeface = r.ck.Typeface.MakeFreeTypeFaceFromData(data)
    if (!typeface) continue
    const probe = new r.ck.Font(typeface, LABEL_FONT_SIZE)
    const glyphIds = probe.getGlyphIDs(CJK_PROBE_TEXT)
    probe.delete()
    const missing = glyphIds.some((id) => id === 0)
    if (!missing) return typeface
    typeface.delete()
  }
  return null
}

/** 用于检测 typeface 是否覆盖中文的最小探测串（页面/登录/中文）。 */
const CJK_PROBE_TEXT = '页面中文'

/**
 * 把已加载（含工作区 fonts/）且覆盖中文字形的字体族注册为 TEXT 段落 CJK 兜底（P0-4）。
 * 与 resolveCjkLabelTypeface 同一探测手法；幂等（已注册的族跳过）。返回是否新增了兜底族。
 * 调用方应在新增后 invalidateAllPictures + syncFontGeneration 让已打开 TEXT 重绘。
 */
export function registerTextCjkFallbackFamilies(r: SkiaRenderer): boolean {
  if (r.isDestroyed() || !r.fontProvider) return false
  let added = false
  for (const family of fontManager.loadedFamilyNames()) {
    if (fontManager.getCJKFallbackFamilies().includes(family)) continue
    const data = fontManager.loadedDataForFamily(family)
    if (!data) continue
    const typeface = r.ck.Typeface.MakeFreeTypeFaceFromData(data)
    if (!typeface) continue
    const probe = new r.ck.Font(typeface, LABEL_FONT_SIZE)
    const glyphIds = probe.getGlyphIDs(CJK_PROBE_TEXT)
    probe.delete()
    typeface.delete()
    const missing = glyphIds.some((id) => id === 0)
    if (!missing) {
      fontManager.setCJKFallbackFamily(family)
      added = true
    }
  }
  return added
}

export async function prepareForExport(
  r: SkiaRenderer,
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[]
): Promise<() => void> {
  const { getTextMeasurer, setTextMeasurer, computeAllLayouts } = await import('#core/layout')

  const previousTextMeasurer = getTextMeasurer()
  setTextMeasurer((node, maxWidth) => r.measureTextNode(node, maxWidth))

  const fontKeys = fontManager.collectFontKeys(graph, nodeIds)
  const requirements = collectGraphFontRequirements(graph, nodeIds)
  await Promise.all(
    fontKeys.map(([family, style]) => fontManager.loadFont(family, style, requirements.characters))
  )
  await fontManager.ensureFallbackPack(
    missingGraphFontScripts(requirements),
    requirements.characters
  )
  syncFontGeneration(r)
  computeAllLayouts(graph, pageId)

  return () => setTextMeasurer(previousTextMeasurer)
}
