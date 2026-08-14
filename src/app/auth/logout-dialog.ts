import { ref } from 'vue'

/** 退出登录二次确认弹窗（设计稿 0:1627 LogoutDialog）的全局开关。 */
export const logoutDialogOpen = ref(false)

export function openLogoutDialog(): void {
  logoutDialogOpen.value = true
}

export function closeLogoutDialog(): void {
  logoutDialogOpen.value = false
}
