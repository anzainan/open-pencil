<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

import { colorToCSS } from '@open-pencil/core/color'
import { useMobileHudContext } from '@/components/MobileHud/context'
import AvatarImage from '@/components/ui/AvatarImage.vue'
import { initials } from '@/app/shell/ui'
import collaborationTheme from '@/theme/collaboration'

const hud = useMobileHudContext()
const collaboration = tv(collaborationTheme)
const styles = collaboration({ size: 'md' })

/** 在线头像样式：与 collaboration theme size=md + following(ring) 对齐。 */
function avatarImageClass(following: boolean): string {
  const base = 'size-7 rounded-full'
  return following ? `${base} ring-2 ring-white/40` : base
}
</script>

<template>
  <PopoverRoot v-if="hud.collabState.connected">
    <PopoverTrigger as-child>
      <button :class="styles.presenceTrigger()">
        <span :class="styles.presenceDot()" />
        <span class="text-xs text-surface">Online: {{ hud.onlineCount }}</span>
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :modal="false"
        :side-offset="8"
        side="bottom"
        align="center"
        :class="styles.presenceContent()"
      >
        <div class="mb-2 text-[11px] tracking-wider text-muted uppercase">
          {{ hud.dialogs.inThisRoom }}
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <AvatarImage
              :image="hud.localAvatar?.image"
              :alt="hud.collabState.localName || 'You'"
              :bg="colorToCSS(hud.collabState.localColor)"
              :char="hud.localAvatar?.char ?? initials(hud.collabState.localName || 'You')"
              :img-class="avatarImageClass(false)"
              :char-class="avatarImageClass(false)"
            />
            <span class="min-w-0 flex-1 truncate text-xs text-surface">
              {{ hud.collabState.localName || 'You' }}
            </span>
            <span class="text-[10px] text-muted">{{ hud.dialogs.youSuffix }}</span>
          </div>

          <div
            v-for="peer in hud.collabPeers"
            :key="peer.clientId"
            :data-following="hud.followingPeer === peer.clientId || undefined"
            :class="styles.peerRow()"
            @click="hud.toggleFollowPeer(peer.clientId)"
          >
            <AvatarImage
              :image="peer.avatar?.image"
              :alt="peer.name"
              :bg="peer.avatar?.bg ?? colorToCSS(peer.color)"
              :char="peer.avatar?.char ?? initials(peer.name)"
              :img-class="avatarImageClass(hud.followingPeer === peer.clientId)"
              :char-class="avatarImageClass(hud.followingPeer === peer.clientId)"
            />
            <span class="min-w-0 flex-1 truncate text-xs text-surface">{{ peer.name }}</span>
            <span v-if="hud.followingPeer === peer.clientId" class="text-[10px] text-accent">
              following
            </span>
          </div>
        </div>

        <button :class="styles.disconnect()" @click="hud.disconnect">
          {{ hud.dialogs.disconnect }}
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
