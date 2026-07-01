/**
 * Messaging Channels Module - Unified Entry Point
 * 
 * Exports all channel infrastructure components:
 * - BaseChannelPlugin: Abstract base class for all platform channels
 * - ChannelEventBus: Central event routing system
 * - ChannelPairingService: Secure pairing and user authorization
 * - ChannelSessionStore: Independent session persistence
 * - ChannelMessageAdapter: Unified message handling
 * 
 * Design follows AionUi channel architecture patterns.
 */

export { BaseChannelPlugin, CHANNEL_STATES } from "./BaseChannelPlugin.mjs";
export { default as ChannelEventBus, channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";
export { ChannelPairingService, PAIRING_CODE_LENGTH, PAIRING_EXPIRY_MS } from "./ChannelPairingService.mjs";
export { ChannelSessionStore } from "./ChannelSessionStore.mjs";
export { ChannelMessageAdapter, channelMessageAdapter } from "./ChannelMessageAdapter.mjs";
