import { createDefaultEditorState, type EditorState } from '@open-pencil/core/editor'

import type { NodeEditState } from '@/app/editor/vector-edit/types'

export function createInitialAppEditorState(pageId: string): AppEditorState {
  return {
    ...createDefaultEditorState(pageId),
    showUI: true,
    showRulers: true,
    showRemoteCursors: true,
    activeRibbonTab: 'panels',
    panelMode: 'design',
    actionToast: null,
    mobileDrawerSnap: 'closed',
    clipboardHTML: '',
    autosaveEnabled: false,
    readOnly: false,
    cursorCanvasX: null,
    cursorCanvasY: null,
    nodeEditState: null,
    renameSelectionOpen: false,
    renameNodeId: null,
    numberFieldFocused: false
  }
}

export type AppEditorState = EditorState & {
  showUI: boolean
  showRulers: boolean
  showRemoteCursors: boolean
  activeRibbonTab: 'panels' | 'code' | 'ai'
  panelMode: 'layers' | 'design'
  actionToast: string | null
  mobileDrawerSnap: 'closed' | 'half' | 'full'
  clipboardHTML: string
  autosaveEnabled: boolean
  /** 只读模式（无编辑权限）：禁编辑工具/动作、关 autosave、禁保存导出，仅可查看。 */
  readOnly: boolean
  cursorCanvasX: number | null
  cursorCanvasY: number | null
  nodeEditState: NodeEditState | null
  renameSelectionOpen: boolean
  renameNodeId: string | null
  numberFieldFocused: boolean
}
