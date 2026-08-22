import type {
  AgentRuntimeFeatureFact,
  AgentRuntimeSelectionResponse,
} from "@onmyagent/types/agent-runtime";

export const commandCatalogKey = (workspaceId: string, sessionId: string) =>
  ["react-session-command-catalog", workspaceId, sessionId] as const;

export function selectGrokFeatureStates(
  selection: Pick<AgentRuntimeSelectionResponse, "health"> | null | undefined,
): AgentRuntimeFeatureFact[] {
  const grok = selection?.health.find((item) => item.health.runtimeKind === "grok-build");
  return grok?.capabilities?.featureStates
    ?? grok?.health.capabilities?.featureStates
    ?? [];
}

export function grokCommandCatalogUsable(
  facts: readonly AgentRuntimeFeatureFact[] | undefined,
): boolean {
  const state = facts?.find((fact) => fact.feature === "command.list")?.state;
  return state !== "unsupported" && state !== "policy_blocked";
}

export type GrokSessionDeleteDecision = {
  allowed: boolean;
  outcome: "allowed" | "unsupported" | "unknown";
  deleted: false | undefined;
};

/** Product delete UI/control decision. Grok delete is fail-closed. */
export function resolveGrokSessionDeleteDecision(input: {
  runtimeKind?: "opencode" | "grok-build" | null;
  featureStates?: readonly AgentRuntimeFeatureFact[];
}): GrokSessionDeleteDecision {
  if (input.runtimeKind !== "grok-build") {
    return { allowed: true, outcome: "allowed", deleted: undefined };
  }
  const state = input.featureStates?.find((fact) => fact.feature === "session.delete")?.state;
  if (state === "supported") {
    return { allowed: true, outcome: "allowed", deleted: undefined };
  }
  if (state === "unsupported" || state === "policy_blocked") {
    return { allowed: false, outcome: "unsupported", deleted: false };
  }
  return { allowed: false, outcome: "unknown", deleted: false };
}

export function grokNativeDeleteUsable(
  facts: readonly AgentRuntimeFeatureFact[] | undefined,
): boolean {
  return resolveGrokSessionDeleteDecision({
    runtimeKind: "grok-build",
    featureStates: facts,
  }).allowed;
}

export function resolveComposerCommandSource(input: {
  runtimeKind?: "opencode" | "grok-build" | null;
  declaredSource?: "command" | "skill" | string;
}): "command" | "skill" | undefined {
  if (input.runtimeKind === "grok-build") return "command";
  if (input.declaredSource === "skill" || input.declaredSource === "command") {
    return input.declaredSource;
  }
  return undefined;
}

export type GrokComposerCommand = {
  id: string;
  name: string;
  description?: string;
  source: "command" | "skill";
};

export function mergeGrokComposerCommands(input: {
  liveItems?: ReadonlyArray<{ name: string; description?: string }>;
  listedItems?: ReadonlyArray<{
    id: string;
    name: string;
    description?: string;
    source?: "command" | "skill" | "workflow";
  }>;
}): GrokComposerCommand[] {
  const byName = new Map<string, GrokComposerCommand>();
  const remember = (
    item: { id?: string; name: string; description?: string },
  ) => {
    if (!item.name || item.name === "always-approve" || item.name === "yolo") return;
    byName.set(item.name, {
      id: item.id || `grok:command:${item.name}`,
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
      source: "command" as const,
    });
  };
  for (const item of input.liveItems ?? []) remember(item);
  // Fresh listRuntimeSessionCommands wins over a stale SSE cache.
  for (const item of input.listedItems ?? []) remember(item);
  return [...byName.values()];
}

export function firstNonEmptyGrokCatalog(
  catalogs: ReadonlyArray<ReadonlyArray<{ name: string; description?: string }> | undefined>,
): Array<{ name: string; description?: string }> {
  for (const items of catalogs) {
    if (items && items.length > 0) return [...items];
  }
  return [];
}
