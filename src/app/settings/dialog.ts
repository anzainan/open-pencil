import { ref } from 'vue'

export type SettingsSection = 'ai' | 'media' | 'storage'

// 本部署隐藏了「AI 和代理」设置面板（AI 设计唯一入口 = openclaw/MCP），
// 默认落在 Media 面板。类型仍保留 'ai' 以兼容官方 AI chat（移动端抽屉仍可触达）
// 的 openSettingsDialog('ai') 调用，函数内归一化到 media 而非渲染空白面板。
export const settingsDialogOpen = ref(false)
export const settingsDialogSection = ref<SettingsSection>('media')

export function openSettingsDialog(section: SettingsSection = 'media'): void {
  settingsDialogSection.value = section === 'ai' ? 'media' : section
  settingsDialogOpen.value = true
}
