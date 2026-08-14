import { ref } from 'vue'

export type SettingsSection = 'ai' | 'profile' | 'team' | 'media' | 'storage'

// 设置面板四 tab（设计稿 0:4 板块二骨架）：个人空间 / 团队空间 / 媒体 / 云存储。
// 本部署隐藏了「AI 和代理」设置面板（AI 设计唯一入口 = openclaw/MCP），
// 类型仍保留 'ai' 以兼容官方 AI chat（移动端抽屉仍可触达）的
// openSettingsDialog('ai') 调用，函数内归一化到 media 而非渲染空白面板。
export const settingsDialogOpen = ref(false)
export const settingsDialogSection = ref<SettingsSection>('profile')

export function openSettingsDialog(section: SettingsSection = 'profile'): void {
  settingsDialogSection.value = section === 'ai' ? 'media' : section
  settingsDialogOpen.value = true
}

/**
 * 设置面板「未保存更改」标记（设计稿 0:1663 UnsavedDialog 触发条件）。
 * 团队空间 tab 的暂存密码/角色编辑置 dirty；保存/放弃后复位。
 * 关闭面板时 dirty → 弹未保存提示；保存成功 → toast。
 */
export const settingsDirty = ref(false)

export function setSettingsDirty(dirty: boolean): void {
  settingsDirty.value = dirty
}
