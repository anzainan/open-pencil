import { computed } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { ExportRequest, IORegistry } from '@open-pencil/core/io'
import { dialogMessages } from '@open-pencil/vue'

import { createDocumentExportActions } from '@/app/document/export'
import type { ExportOptions } from '@/app/document/export/types'
import { createDocumentIOActions } from '@/app/document/io'
import type { ViewportSize } from '@/app/document/io/types'
import { createFlashActions } from '@/app/editor/flash'
import { createMobileClipboardActions } from '@/app/editor/mobile-clipboard'
import { createPenActions } from '@/app/editor/pen'
import { createProfilerActions } from '@/app/editor/profiler'
import type { AppEditorState } from '@/app/editor/session/types'
import { createVectorEditActions } from '@/app/editor/vector-edit'
import { toast } from '@/app/shell/ui'

export function defineEditorStoreAccessors(store: object, editor: Editor) {
  Object.defineProperties(store, {
    graph: {
      enumerable: true,
      get: () => editor.graph
    },
    renderer: {
      enumerable: true,
      get: () => editor.renderer
    },
    textEditor: {
      enumerable: true,
      get: () => editor.textEditor
    }
  })
}

export function createEditorComputedRefs(editor: Editor, state: AppEditorState) {
  const selectedNodes = computed(() => {
    void state.sceneVersion
    return editor.getSelectedNodes()
  })

  const selectedNode = computed(() =>
    selectedNodes.value.length === 1 ? selectedNodes.value[0] : undefined
  )

  const layerTree = computed(() => {
    void state.sceneVersion
    return editor.getLayerTree()
  })

  return { selectedNodes, selectedNode, layerTree }
}

export function createEditorStoreModules(
  editor: Editor,
  state: AppEditorState,
  io: IORegistry,
  viewportSize: ViewportSize
) {
  const flash = createFlashActions(editor)
  const pen = createPenActions(editor, state)
  const vectorEdit = createVectorEditActions(editor, state)
  const documentIO = createDocumentIOActions(editor, state, viewportSize)
  const documentExport = createDocumentExportActions(editor, state, io, documentIO.downloadBlob)
  const mobileClipboard = createMobileClipboardActions(editor, state)
  const profiler = createProfilerActions(editor)

  // 只读模式（无编辑权限）：保存入口一律拦截（toast 提示，不落盘）。
  // 导出（下载素材）对只读查看者开放：导出不写源文件、不破坏只读落盘保护，
  // 游客分享页的「可导出下载素材」依赖此路径。覆盖菜单/快捷键与面板按钮等全部触发路径。
  function readonlyBlocked(): boolean {
    if (!state.readOnly) return false
    toast.info(dialogMessages.get()['perm.readOnly'])
    return true
  }

  return {
    ...flash,
    ...pen,
    ...vectorEdit,
    openFigFile: documentIO.openFigFile,
    openDOMFile: documentIO.openDOMFile,
    importDOMText: documentIO.importDOMText,
    setViewportSize: documentIO.setViewportSize,
    fitCurrentPageToViewport: documentIO.fitCurrentPageToViewport,
    saveFigFile: async () => {
      if (readonlyBlocked()) return
      await documentIO.saveFigFile()
    },
    saveFigFileAs: async () => {
      if (readonlyBlocked()) return
      await documentIO.saveFigFileAs()
    },
    getDocumentFilePath: documentIO.getDocumentFilePath,
    getSourceIdentity: documentIO.getSourceIdentity,
    getStorageBinding: documentIO.getStorageBinding,
    getBindingDocumentId: documentIO.getBindingDocumentId,
    setDocumentSource: documentIO.setDocumentSource,
    setStorageDocumentSource: documentIO.setStorageDocumentSource,
    setPlannedFilePath: documentIO.setPlannedFilePath,
    startWatchingCurrentFile: documentIO.startWatchingCurrentFile,
    dispose: () => {
      editor.clearPageViewports()
      documentIO.disposeDocumentIO()
    },
    ...documentExport,
    exportTarget: async (
      target: ExportRequest['target'],
      formatId: string,
      options?: ExportOptions
    ) => {
      await documentExport.exportTarget(target, formatId, options)
    },
    exportTargets: async (requests: Parameters<typeof documentExport.exportTargets>[0]) => {
      await documentExport.exportTargets(requests)
    },
    exportSelection: async (
      scale: number,
      formatId: 'png' | 'jpg' | 'webp' | 'svg' | 'pdf' | 'pptx' | 'fig'
    ) => {
      await documentExport.exportSelection(scale, formatId)
    },
    ...mobileClipboard,
    ...profiler
  }
}
