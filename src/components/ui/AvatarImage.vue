<script setup lang="ts">
import { computed } from 'vue'

import { useAvatarURL } from '@/app/settings/useAvatarURL'

const { image, alt = '', bg = '#3B82F6', char = '?', imgClass = '', charClass = '' } =
  defineProps<{
    image?: string | null
    alt?: string
    bg?: string
    char?: string
    imgClass?: string
    charClass?: string
  }>()

const url = useAvatarURL(computed(() => image || null))
</script>

<template>
  <img v-if="url" :src="url" :alt="alt" :class="['shrink-0 object-cover', imgClass]" />
  <span
    v-else
    :style="{ backgroundColor: bg }"
    :class="['flex shrink-0 items-center justify-center text-white select-none', charClass]"
  >
    {{ char }}
  </span>
</template>
