<script setup lang="ts">
import type { Ref } from 'vue'

import MobileActionToast from '@/components/MobileHud/MobileActionToast.vue'
import MobileActiveToolBadge from '@/components/MobileHud/MobileActiveToolBadge.vue'
import MobileFileMenu from '@/components/MobileHud/MobileFileMenu.vue'
import MobilePresencePopover from '@/components/MobileHud/MobilePresencePopover.vue'
import MobileShareButton from '@/components/MobileHud/MobileShareButton.vue'
import MobileUndoRedo from '@/components/MobileHud/MobileUndoRedo.vue'
import { provideMobileHud } from '@/components/MobileHud/context'

import type { BridgePresenceUser } from '@/app/bridge/client'

// 在线感知快照（EditorView 的 useDocumentPresence）：presence 已携带真实头像，
// 移动端在线头像栈接图用（未提供时保持纯 initials 兜底）。
const { onlineUsers } = defineProps<{ onlineUsers?: Ref<BridgePresenceUser[]> }>()

provideMobileHud(onlineUsers)
</script>

<template>
  <div
    class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start px-3 pt-3"
    @touchstart.stop
  >
    <div class="pointer-events-auto flex flex-col items-start gap-1.5">
      <MobileUndoRedo />
      <MobileActiveToolBadge />
    </div>

    <div class="pointer-events-auto relative mx-auto flex flex-col items-center gap-1.5">
      <MobilePresencePopover />
      <MobileActionToast />
    </div>

    <div class="pointer-events-auto flex items-center gap-1.5">
      <MobileShareButton />
      <MobileFileMenu />
    </div>
  </div>
</template>
