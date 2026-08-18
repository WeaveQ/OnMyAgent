import type { AgentRuntimeCapability } from "@onmyagent/types/agent-runtime";

export type RuntimeFeatureState =
  | "supported"
  | "unsupported"
  | "unknown"
  | "policy_blocked"
  | "degraded";

export type RuntimeFeatureSource =
  | "initialize"
  | "lazy_call"
  | "pinned_contract"
  | "host_policy";

export type RuntimeFeatureFact = {
  feature: AgentRuntimeCapability;
  state: RuntimeFeatureState;
  source: RuntimeFeatureSource;
};

export function featureNames(facts: readonly RuntimeFeatureFact[]): AgentRuntimeCapability[] {
  return facts
    .filter((fact) => fact.state === "supported" || fact.state === "degraded")
    .map((fact) => fact.feature);
}

export function rememberFact(
  facts: readonly RuntimeFeatureFact[],
  next: RuntimeFeatureFact,
): RuntimeFeatureFact[] {
  const remaining = facts.filter((fact) => fact.feature !== next.feature);
  return [...remaining, next];
}

const OPTIONAL_INITIALIZE_FEATURES: readonly AgentRuntimeCapability[] = [
  "session.delete",
  "session.rename",
  "session.fork",
  "command.list",
  "command.execute",
];

/** Facts for advertised initialize features plus explicit optional gaps. */
export function factsFromAdvertisedFeatures(
  features: readonly AgentRuntimeCapability[],
): RuntimeFeatureFact[] {
  let facts: RuntimeFeatureFact[] = features.map((feature) => ({
    feature,
    state: "supported",
    source: "initialize",
  }));
  for (const feature of OPTIONAL_INITIALIZE_FEATURES) {
    if (features.includes(feature)) continue;
    facts = rememberFact(facts, {
      feature,
      state: feature === "command.list" || feature === "command.execute"
        ? "degraded"
        : "unsupported",
      source: feature === "command.list" || feature === "command.execute"
        ? "lazy_call"
        : "initialize",
    });
  }
  return facts;
}

export function featureStateOf(
  facts: readonly RuntimeFeatureFact[] | undefined,
  feature: AgentRuntimeCapability,
): RuntimeFeatureState {
  return facts?.find((fact) => fact.feature === feature)?.state ?? "unknown";
}

export function featureUsable(
  facts: readonly RuntimeFeatureFact[] | undefined,
  feature: AgentRuntimeCapability,
): boolean {
  const state = featureStateOf(facts, feature);
  return state === "supported" || state === "degraded" || state === "unknown";
}
