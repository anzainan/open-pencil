import { ref } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import {
  apiKeyStatus,
  browserCredentialsRemembered,
  credentialsReady,
  customAPIType,
  customBaseURL,
  customModelID,
  isACPProvider,
  isConfigured,
  maxOutputTokens,
  modelID,
  pexelsKeyStatus,
  providerDef,
  providerID,
  registerAIChatEffects,
  resolveAPIKey,
  serverPexelsConfigured,
  setAPIKey,
  setPexelsKey,
  setRememberCredentials,
  setUnsplashKey,
  unsplashKeyStatus
} from '@/app/ai/chat/storage'
import { createChatSessionManager } from '@/app/ai/chat/transports'
import { exposeChatTransportOverride } from '@/app/browser-bridge'
import { getActiveEditorStore } from '@/app/editor/active-store'

// The browser AI panel entry is intentionally hidden in this deployment (AI design
// happens through the external opencode/MCP channel). The official AI chat remains
// fully functional and reachable through the mobile drawer, so this tab state is
// narrowed to the two panels still exposed in the desktop properties panel.
const activeTab = ref<'design' | 'code'>('design')

const chatSession = createChatSessionManager({
  isConfigured,
  isACPProvider,
  providerID,
  credentialsReady,
  getActiveEditorStore
})

registerAIChatEffects(chatSession.markTransportDirty)

if (IS_BROWSER) {
  exposeChatTransportOverride((factory) => {
    chatSession.setOverrideTransport(factory)
  })
}

export function useAIChat() {
  return {
    providerID,
    providerDef,
    apiKeyStatus,
    browserCredentialsRemembered,
    setAPIKey,
    resolveAPIKey,
    modelID,
    customBaseURL,
    customModelID,
    customAPIType,
    maxOutputTokens,
    pexelsKeyStatus,
    serverPexelsConfigured,
    setPexelsKey,
    setRememberCredentials,
    unsplashKeyStatus,
    setUnsplashKey,
    activeTab,
    isConfigured,
    ensureChat: chatSession.ensureChat,
    resetChat: chatSession.resetChat
  }
}
