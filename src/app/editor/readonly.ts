import { ref } from 'vue'

/**
 * 只读模式的权限申请弹窗开关（模块级 ref，同 settings/dialog.ts 模式）。
 * Toolbar/EditorView 在只读用户尝试编辑动作时打开；PermissionRequestDialog 消费。
 */
export const permissionRequestOpen = ref(false)

export function openPermissionRequest(): void {
  permissionRequestOpen.value = true
}

export function closePermissionRequest(): void {
  permissionRequestOpen.value = false
}
