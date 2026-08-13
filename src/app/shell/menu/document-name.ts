import { computed } from 'vue'

import { useInlineRename } from '@open-pencil/vue'

import { renameWorkspaceDocument } from '@/app/bridge/workspace-rename'
import type { EditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

const DOCUMENT_NAME_ID = 'document-name'

export function useDocumentNameRename(store: EditorStore) {
  const rename = useInlineRename<'document-name'>((_id, name) => {
    store.state.documentName = name
    // 画布内改名写回存储：有 bridge storage binding 时调 rename 端点并同步 binding/URL。
    // 失败时由 renameWorkspaceDocument 回滚内存名。
    void renameWorkspaceDocument(store, name).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  })
  const editingName = computed(() => rename.editingId.value === DOCUMENT_NAME_ID)

  function startRename() {
    rename.start(DOCUMENT_NAME_ID, store.state.documentName)
  }

  function commitRename(e: Event) {
    rename.commit(DOCUMENT_NAME_ID, e)
  }

  return { rename, editingName, startRename, commitRename }
}
