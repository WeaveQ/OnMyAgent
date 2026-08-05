import { isAutomationRailView } from "../sidebar/main-rail";

/** Secondary rail pages that host their own full surface (not chat placeholders). */
const HOSTED_SECONDARY = new Set([
  "files",
  "store",
  "company",
  "projects",
  "localAgent",
  "agentManagement",
  "skills",
  "connectors",
]);

export function isHostedSecondaryRailView(view: string): boolean {
  return HOSTED_SECONDARY.has(view) || isAutomationRailView(view);
}

export function isPrimaryOrHostedRailView(view: string): boolean {
  return view === "chat" || view === "assistant" || isHostedSecondaryRailView(view);
}
