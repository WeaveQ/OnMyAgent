/**
 * Cross-cutting infra only. Product domains export from their own packages:
 * agents | connections | plugins | workspace | shell-feedback | messaging
 */
export {
  buildOnMyAgentEnvSystemContext,
  clearOnMyAgentEnvSystemContextCache,
} from "./env-context";
export {
  ONMYAGENT_EXTENSION_STATE_CHANGED,
  getExtensionId,
  isOnMyAgentExtensionEnabled,
  isOnMyAgentExtensionHidden,
  setOnMyAgentExtensionEnabled,
  setOnMyAgentExtensionHidden,
} from "./extension-state";
export {
  createOnMyAgentServerStore,
  useOnMyAgentServerStoreSnapshot,
} from "./onmyagent-server-store";
export type {
  OnMyAgentServerStore,
  OnMyAgentServerStoreSnapshot,
} from "./onmyagent-server-store";
export { OnMyAgentDenHelpLink } from "./onmyagent-den-help-link";
export * from "./desktop-config-context";
