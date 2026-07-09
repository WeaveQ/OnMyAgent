export {
  createConnectionsStore,
  useConnectionsStoreSnapshot,
  type ConnectionsStore,
  type ConnectionsStoreSnapshot,
} from "./store";
export {
  createProviderAuthStore,
  useProviderAuthStoreSnapshot,
  type ProviderAuthStore,
  type ProviderAuthStoreSnapshot,
} from "./provider-auth/store";
export { default as ConnectionsModals } from "./modals";
export type { ConnectionsModalsProps, ConnectionsModalsState } from "./modals";

/** @deprecated-path transitional: prefer connections; implementation still under shared. */
export { default as ProviderAuthModal } from "../shared/provider-auth-modal";
export type { ProviderAuthModalProps } from "../shared/provider-auth-modal";
