<script setup lang="ts">
import { computed } from 'vue'

import DesktopToolbar from '@/components/Toolbar/DesktopToolbar.vue'
import MobileToolbar from '@/components/Toolbar/MobileToolbar.vue'
import { useToolbarActions } from '@/components/Toolbar/actions'
import { useActionToast } from '@/app/shell/toast/action'
import { useEditorStore } from '@/app/editor/active-store'
import { toolIcons } from '@/app/editor/icons'
import { useMenuUI } from '@/components/ui/menu'
import { EDITOR_TOOLS } from '@open-pencil/core/editor'
import {
  ToolbarRoot,
  useEditorCommands,
  useI18n,
  useToolbarState,
  useViewportKind
} from '@open-pencil/vue'

import type { EditorToolDef, Tool } from '@open-pencil/core/editor'
import type { ToolbarActionItem } from '@/components/Toolbar/types'

const store = useEditorStore()
const { isMobile } = useViewportKind()
const { getCommand } = useEditorCommands()
const { showActionToast } = useActionToast()
const { menu, tools: toolTexts } = useI18n()

// 只读模式（无编辑权限）：工具栏只留 hand/select，其余编辑工具隐藏；
// 编辑/排列动作组（delete/duplicate/arrange/layer）一并清空禁用。
const readOnly = computed(() => store.state.readOnly)
const readonlyTools = computed<EditorToolDef[]>(() =>
  EDITOR_TOOLS.filter((tool) => tool.key === 'SELECT' || tool.key === 'HAND')
)

const toolLabels = computed<Record<Tool, string>>(() => ({
  SELECT: toolTexts.value.move,
  FRAME: toolTexts.value.frame,
  SECTION: toolTexts.value.section,
  RECTANGLE: toolTexts.value.rectangle,
  ELLIPSE: toolTexts.value.ellipse,
  LINE: toolTexts.value.line,
  POLYGON: toolTexts.value.polygon,
  STAR: toolTexts.value.star,
  PEN: toolTexts.value.pen,
  TEXT: toolTexts.value.text,
  HAND: toolTexts.value.hand
}))

const toolShortcuts: Record<Tool, string> = {
  SELECT: 'V',
  FRAME: 'F',
  SECTION: 'S',
  RECTANGLE: 'R',
  ELLIPSE: 'O',
  LINE: 'L',
  POLYGON: '',
  STAR: '',
  PEN: 'P',
  TEXT: 'T',
  HAND: 'H'
}

const flyoutMenuCls = useMenuUI({ content: 'min-w-32' })
const toolbarUI = { flyoutContent: flyoutMenuCls.content }
const { editActions, arrangeActions } = useToolbarActions({ store, getCommand, menu })

const visibleEditActions = computed<ToolbarActionItem[]>(() =>
  readOnly.value ? [] : editActions.value
)
const visibleArrangeActions = computed<ToolbarActionItem[]>(() =>
  readOnly.value ? [] : arrangeActions.value
)

const { mobileCategory, slideDirection, hasPrev, hasNext, goPrev, goNext } = useToolbarState()

function onActionTap(item: ToolbarActionItem) {
  item.action()
  showActionToast(item.label)
}
</script>

<template>
  <ToolbarRoot
    v-slot="{ tools, activeTool, flyoutSelections, actions }"
    :tools="readOnly ? readonlyTools : undefined"
  >
    <DesktopToolbar
      v-if="!isMobile"
      :tools="tools"
      :active-tool="activeTool"
      :flyout-selections="flyoutSelections"
      :tool-icons="toolIcons"
      :tool-labels="toolLabels"
      :tool-shortcuts="toolShortcuts"
      :ui="toolbarUI"
      @set-tool="actions.setTool"
    />

    <MobileToolbar
      v-else
      :tools="tools"
      :active-tool="activeTool"
      :flyout-selections="flyoutSelections"
      :tool-icons="toolIcons"
      :tool-labels="toolLabels"
      :tool-shortcuts="toolShortcuts"
      :ui="toolbarUI"
      :mobile-category="mobileCategory"
      :slide-direction="slideDirection"
      :has-prev="hasPrev"
      :has-next="hasNext"
      :edit-actions="visibleEditActions"
      :arrange-actions="visibleArrangeActions"
      @set-tool="actions.setTool"
      @prev="goPrev"
      @next="goNext"
      @action="onActionTap"
    />
  </ToolbarRoot>
</template>
