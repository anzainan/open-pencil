<script setup lang="ts">
import { colorToCSS } from '@open-pencil/core/color'

import Tip from '@/components/ui/Tip.vue'
import AvatarImage from '@/components/ui/AvatarImage.vue'
import { initials } from '@/app/shell/ui'
import { useCollabPanelContext } from '@/components/CollabPanel/context'
import { useI18n } from '@open-pencil/vue'

const collab = useCollabPanelContext()
const { dialogs } = useI18n()

/** 在线头像栈样式：与 collaboration theme size=sm + bordered + following(ring) 对齐。 */
function avatarImageClass(following: boolean): string {
  const base = 'size-6 rounded-full border-2 border-panel'
  return following ? `${base} ring-2 ring-white/40` : base
}
</script>

<template>
  <div class="flex -space-x-1.5">
    <Tip :label="`${collab.state.localName || dialogs.you} (${dialogs.youSuffix})`">
      <AvatarImage
        data-test-id="collab-local-avatar"
        :image="collab.state.localAvatar?.image"
        :alt="collab.state.localName || dialogs.you"
        :bg="colorToCSS(collab.state.localColor)"
        :char="collab.state.localAvatar?.char ?? initials(collab.state.localName || dialogs.you)"
        :img-class="avatarImageClass(false)"
        :char-class="avatarImageClass(false)"
      />
    </Tip>

    <Tip
      v-for="peer in collab.peers"
      :key="peer.clientId"
      :label="
        collab.followingPeer === peer.clientId
          ? dialogs.followingPeerStop({ name: peer.name })
          : dialogs.clickToFollowPeer({ name: peer.name })
      "
    >
      <div
        data-test-id="collab-peer-avatar"
        :data-following="collab.followingPeer === peer.clientId || undefined"
        :class="{ 'cursor-pointer': true }"
        @click="collab.toggleFollowPeer(peer.clientId)"
      >
        <AvatarImage
          :image="peer.avatar?.image"
          :alt="peer.name"
          :bg="peer.avatar?.bg ?? colorToCSS(peer.color)"
          :char="peer.avatar?.char ?? initials(peer.name)"
          :img-class="avatarImageClass(collab.followingPeer === peer.clientId)"
          :char-class="avatarImageClass(collab.followingPeer === peer.clientId)"
        />
      </div>
    </Tip>
  </div>
</template>
