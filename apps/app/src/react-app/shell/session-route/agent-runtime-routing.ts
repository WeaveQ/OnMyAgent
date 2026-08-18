import type {
  AgentRuntimeKind,
  AgentRuntimePromptPartInput,
  AgentRuntimeSelectionResponse,
} from "@onmyagent/types/agent-runtime";

export {
  firstNonEmptyGrokCatalog,
  grokCommandCatalogUsable,
  grokNativeDeleteUsable,
  mergeGrokComposerCommands,
  resolveComposerCommandSource,
  resolveGrokSessionDeleteDecision,
  selectGrokFeatureStates,
} from "../../capabilities/agent-runtime/grok-feature-states";

export const GROK_PRIMARY_MODEL = {
  modelId: "grok-4.5",
  variant: "low",
} as const;

export function resolveConfiguredRuntimeKind(
  selection: AgentRuntimeSelectionResponse,
  workspaceId: string,
): AgentRuntimeKind {
  return selection.config?.workspaceOverrides[workspaceId]
    ?? selection.config?.defaultRuntimeKind
    ?? "opencode";
}

export function supportsCanonicalGrokDraft(input: {
  mode: "prompt" | "shell";
  hasCommand: boolean;
  hasNonTextParts: boolean;
  hasFileAttachments?: boolean;
  hasCustomWorkspace: boolean;
  hasAgentOverride: boolean;
  hasToolOverrides: boolean;
}): boolean {
  return input.mode === "prompt"
    && !input.hasNonTextParts
    && !input.hasCustomWorkspace
    && !input.hasAgentOverride
    && !input.hasToolOverrides;
}

export function composeCanonicalGrokPromptInput(input: {
  text: string;
  messageId?: string;
  parts?: AgentRuntimePromptPartInput[];
}): {
  text: string;
  messageId?: string;
  parts?: AgentRuntimePromptPartInput[];
} {
  const parts = (input.parts ?? []).filter((part) => part.type !== "agent");
  return {
    text: input.text,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(parts.length > 0 ? { parts } : {}),
  };
}
