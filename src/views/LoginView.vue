<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@open-pencil/vue'

import mobaiLogo from '@/assets/mobai-logo.svg'
import { login } from '@/app/auth/session'

defineOptions({ name: 'LoginView' })

const { dialogs } = useI18n()
const router = useRouter()

const username = ref('')
const password = ref('')
const remember = ref(true)
const submitting = ref(false)
const errorMessage = ref<string | null>(null)

const canSubmit = computed(() => username.value.trim() !== '' && password.value !== '' && !submitting.value)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  errorMessage.value = null
  try {
    await login(username.value.trim(), password.value, remember.value)
    await router.push('/')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    errorMessage.value = message || dialogs.value['login.error']
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main
    class="flex min-h-screen items-center justify-center bg-[#1E1E1E] px-4"
    data-test-id="login-page"
  >
    <div
      class="flex h-[530px] w-[400px] max-w-full flex-col items-center rounded-2xl border border-[#3A3A3A] bg-[#2A2A2A] px-10 py-9"
      data-test-id="login-card"
    >
      <!-- LogoSlot（90 高居中）：白色 M 形 logo，与设计稿 LoginCard 0:1614 一致 -->
      <div class="flex h-[90px] items-center justify-center" data-test-id="login-logo">
        <img :src="mobaiLogo" alt="MoBai" class="h-[60px] w-[129px]" />
      </div>

      <!-- BrandTexts：MoBai 大标题 + 云端协作白板 副标题 -->
      <div class="mt-1 flex flex-col items-center gap-1.5">
        <span class="text-2xl leading-none font-bold tracking-wide text-white">MoBai</span>
        <p class="text-[13px] text-muted" data-test-id="login-title">
          {{ dialogs['login.title'] }}
        </p>
      </div>

      <div class="mt-6 flex w-full flex-col gap-3">
        <input
          v-model="username"
          type="text"
          class="h-10 w-full rounded-md border border-[#3A3A3A] bg-[#383838] px-3 text-[13px] text-surface placeholder:text-muted/70 focus:border-[#3B82F6] focus:outline-none"
          :placeholder="dialogs['login.username']"
          :aria-label="dialogs['login.username']"
          autocomplete="username"
          data-test-id="login-username"
          @keydown.enter="submit"
        />
        <input
          v-model="password"
          type="password"
          class="h-10 w-full rounded-md border border-[#3A3A3A] bg-[#383838] px-3 text-[13px] text-surface placeholder:text-muted/70 focus:border-[#3B82F6] focus:outline-none"
          :placeholder="dialogs['login.password']"
          :aria-label="dialogs['login.password']"
          autocomplete="current-password"
          data-test-id="login-password"
          @keydown.enter="submit"
        />
      </div>

      <label class="mt-3 flex w-full cursor-pointer items-center gap-2" data-test-id="login-remember">
        <span
          class="flex size-4 items-center justify-center rounded-[4px] border border-[#3A3A3A] bg-[#1E1E1E] transition-colors"
          :class="{ 'border-[#3B82F6] bg-[#3B82F6]': remember }"
        >
          <icon-lucide-check v-if="remember" class="size-3 text-white" />
        </span>
        <input v-model="remember" type="checkbox" class="sr-only" />
        <span class="text-[11px] text-muted">{{ dialogs['login.remember'] }}</span>
      </label>

      <p v-if="errorMessage" class="mt-3 w-full text-left text-[11px] text-[#F87171]" role="alert" data-test-id="login-error">
        {{ errorMessage }}
      </p>

      <button
        type="button"
        class="mt-4 h-10 w-full rounded-md bg-[#3B82F6] text-sm font-medium text-white transition-colors hover:bg-[#3B82F6]/90 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canSubmit"
        data-test-id="login-submit"
        @click="submit"
      >
        {{ submitting ? '…' : dialogs['login.submit'] }}
      </button>

      <div class="mt-auto flex flex-col items-center gap-1 pt-6">
        <p class="text-[10px] text-muted/80" data-test-id="login-footer-2">
          {{ dialogs['login.footer2'] }}
        </p>
      </div>
    </div>
  </main>
</template>
