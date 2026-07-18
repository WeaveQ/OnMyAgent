export {
  AgentsPage,
  CreateAgentWizard,
  type AgentsPageProps,
  type AgentCardItem,
} from "./agents-page";

/** Deferred loader so session host can code-split the heavy agents registry UI. */
export const loadAgentsPage = () => import("./agents-page");
export { useEnsureAgentRegistry } from "./use-agent-registry";
export {
  buildPendingAgentFromRecord,
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
  readSessionAgentSnapshot,
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "./agent-registry-store";
export * from "./agent-session-state";

export * from "./pending-agent-store";
export { AgentPromptSuggestions } from "./agent-prompt-suggestions";
export * from "./agent-registry-types";
export * from "./agent-registry-helpers";
export { createDefaultAgentRegistry } from "./agent-default-registry";
