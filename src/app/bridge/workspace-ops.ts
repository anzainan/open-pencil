import { useI18n } from '@open-pencil/vue'

import { bridgeClient } from './client'
import {
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  trashWorkspaceEntry
} from './workspace-rename'
import { toast } from '@/app/shell/ui'

export interface WorkspaceTarget {
  kind: 'file' | 'folder'
  path: string
  name: string
}

export interface WorkspaceOpsOptions {
  refresh: () => void
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 首页/文件夹页共享的文件操作（新建项目/重命名/移动/移至回收站/恢复/彻底删除）。
 * 每个操作成功后触发传入的 refresh（SSE 事件兜底刷新由视图层订阅）。
 */
export function useWorkspaceFileOps(options: WorkspaceOpsOptions) {
  const { dialogs } = useI18n()

  async function createProject(name: string): Promise<boolean> {
    if (!name.trim()) return false
    try {
      await bridgeClient.createDir(name.trim())
      toast.info(dialogs.value.projectCreated({ name: name.trim() }))
      options.refresh()
      return true
    } catch (error) {
      toast.error(`${dialogs.value.createProjectFailed}: ${errMessage(error)}`)
      return false
    }
  }

  async function renameTarget(target: WorkspaceTarget, newName: string): Promise<boolean> {
    if (!newName.trim() || newName.trim() === target.name) return false
    try {
      await renameWorkspaceEntry(target.path, newName.trim())
      toast.info(dialogs.value.renamed)
      options.refresh()
      return true
    } catch (error) {
      toast.error(`${dialogs.value.renameFailed}: ${errMessage(error)}`)
      return false
    }
  }

  async function moveTarget(target: WorkspaceTarget, to: string): Promise<boolean> {
    if (to === folderOf(target.path)) return false
    try {
      await moveWorkspaceEntry(target.path, to)
      toast.info(dialogs.value.moved)
      options.refresh()
      return true
    } catch (error) {
      toast.error(`${dialogs.value.moveFailed}: ${errMessage(error)}`)
      return false
    }
  }

  async function trashTarget(target: WorkspaceTarget): Promise<boolean> {
    try {
      await trashWorkspaceEntry(target.path)
      toast.info(dialogs.value.movedToTrash)
      options.refresh()
      return true
    } catch (error) {
      toast.error(`${dialogs.value.trashFailed}: ${errMessage(error)}`)
      return false
    }
  }

  async function restoreEntry(path: string): Promise<boolean> {
    try {
      await bridgeClient.restoreTrashFile(path)
      toast.info(dialogs.value.restored)
      options.refresh()
      return true
    } catch (error) {
      toast.error(`${dialogs.value.restoreFailed}: ${errMessage(error)}`)
      return false
    }
  }

  async function deleteEntry(path: string): Promise<boolean> {
    try {
      await bridgeClient.deleteTrashFile(path)
      toast.info(dialogs.value.deleted)
      options.refresh()
      return true
    } catch (error) {
      toast.error(`${dialogs.value.deleteFailed}: ${errMessage(error)}`)
      return false
    }
  }

  return { createProject, renameTarget, moveTarget, trashTarget, restoreEntry, deleteEntry }
}

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}
