import { computed, ref, type Ref } from 'vue'

import { BRIDGE_STORAGE_PROVIDER, activeStorageProviderID } from '@/app/integrations/storage'
import type { StorageDocument } from '@/app/integrations/storage'
import { bridgeClient } from '@/app/bridge/client'
import { useWorkspaceFileOps, type WorkspaceTarget } from '@/app/bridge/workspace-ops'
import type { ContextMenuPosition } from '@/components/workspace/context-menu'

interface MenuState {
  position: ContextMenuPosition
  target: WorkspaceTarget
}

interface DialogState<T> {
  open: boolean
  target: T | null
}

type RenameDialogState = DialogState<WorkspaceTarget>
type MoveDialogState = DialogState<WorkspaceTarget>

/**
 * 首页/文件夹页共享的工作区网格状态：文件夹/文件分组 + 右键菜单 + 重命名/移动/新建项目弹窗。
 * documents/refresh 由各视图的 useDocumentWorkspace 提供。
 */
export function useWorkspaceGrid(options: {
  documents: Ref<StorageDocument[]>
  refresh: () => void
  currentFolder?: Ref<string>
}) {
  const dirs = ref<string[]>([])
  const ctxMenu = ref<MenuState | null>(null)
  const renameState = ref<RenameDialogState>({ open: false, target: null })
  const moveState = ref<MoveDialogState>({ open: false, target: null })
  const newProjectOpen = ref(false)

  const ops = useWorkspaceFileOps({
    refresh: () => {
      options.refresh()
      void loadDirs()
    }
  })

  /** 顶层文件夹 = 文件首段目录（仅深层文件）∪ 空目录（GET /dirs 顶层）。根文件首段即文件名，不算文件夹。 */
  const folders = computed(() => {
    const names = new Set<string>()
    for (const document of options.documents.value) {
      if (!document.id.includes('/')) continue
      const first = document.id.split('/')[0]
      if (first) names.add(first)
    }
    for (const dir of dirs.value) {
      if (!dir.includes('/')) names.add(dir)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  })

  /** 根目录散文件（无 `/`）。 */
  const rootFiles = computed(() =>
    options.documents.value.filter((document) => !document.id.includes('/'))
  )

  /** 当前文件夹内文件（相对路径首段 == 当前文件夹，最多两层模型下的二级文件）。 */
  const folderFiles = computed(() => {
    const folder = options.currentFolder?.value
    if (!folder) return []
    return options.documents.value
      .filter((document) => document.id.split('/')[0] === folder)
      .sort((a, b) => a.id.localeCompare(b.id))
  })

  function fileCountInFolder(folder: string): number {
    return options.documents.value.filter((document) =>
      document.id.startsWith(`${folder}/`)
    ).length
  }

  async function loadDirs(): Promise<void> {
    if (activeStorageProviderID.value !== BRIDGE_STORAGE_PROVIDER.id) return
    try {
      dirs.value = await bridgeClient.listDirs()
    } catch (error) {
      console.warn('[workspace-grid] list dirs failed', error)
    }
  }

  function onCardContextMenu(event: MouseEvent, target: WorkspaceTarget) {
    event.preventDefault()
    ctxMenu.value = { position: { x: event.clientX, y: event.clientY }, target }
  }

  function closeMenu() {
    ctxMenu.value = null
  }

  function onRename() {
    const menu = ctxMenu.value
    if (!menu) return
    ctxMenu.value = null
    renameState.value = { open: true, target: menu.target }
  }

  function onMove() {
    const menu = ctxMenu.value
    if (!menu) return
    ctxMenu.value = null
    moveState.value = { open: true, target: menu.target }
  }

  async function onTrash() {
    const menu = ctxMenu.value
    if (!menu) return
    ctxMenu.value = null
    await ops.trashTarget(menu.target)
  }

  async function onRenameConfirm(name: string) {
    const target = renameState.value.target
    if (target) await ops.renameTarget(target, name)
  }

  async function onMoveConfirm(to: string) {
    const target = moveState.value.target
    if (target) await ops.moveTarget(target, to)
  }

  async function onNewProjectConfirm(name: string) {
    await ops.createProject(name)
  }

  return {
    dirs,
    folders,
    rootFiles,
    folderFiles,
    fileCountInFolder,
    loadDirs,
    ctxMenu,
    renameState,
    moveState,
    newProjectOpen,
    onCardContextMenu,
    closeMenu,
    onRename,
    onMove,
    onTrash,
    onRenameConfirm,
    onMoveConfirm,
    onNewProjectConfirm
  }
}
