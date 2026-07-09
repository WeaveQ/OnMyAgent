/**
 * Messaging Channels Module — Unified Entry Point
 *
 * Exports channel infrastructure:
 * - BaseChannelPlugin: abstract base for future native plugins
 * - ChannelEventBus: central event routing
 * - ChannelPairingService: local-only pairing + authorization
 * - ChannelSessionStore: per-user/agent session persistence
 * - ChannelMessageAdapter: unified message rendering
 * - ChannelPluginRegistry: runtime registry for platform plugins
 */

export { BaseChannelPlugin, CHANNEL_STATES } from "./BaseChannelPlugin.mjs";
export { default as ChannelEventBus, channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";
export { ChannelPairingService, PAIRING_CODE_LENGTH, PAIRING_EXPIRY_MS } from "./ChannelPairingService.mjs";
export { ChannelSessionStore } from "./ChannelSessionStore.mjs";
export { ChannelMessageAdapter, channelMessageAdapter } from "./ChannelMessageAdapter.mjs";
export { ChannelStreamRelay } from "./ChannelStreamRelay.mjs";
export {
  ChannelPluginRegistry,
  createLegacyServicePlugin,
  createStubPlugin,
  isRunningStatus,
  PLUGIN_TRANSPORT_STATE,
} from "./PluginRegistry.mjs";
export { ChannelAssistantBindingStore } from "./AssistantBindingStore.mjs";
export { formatAgentReply } from "./AgentReplyHeader.mjs";
