/**
 * Open the primary-rail Automation surface from expert (or any non-assistant host).
 * AutomationPage is mounted only on the assistant host — navigate with ?view=automation.
 * Do not use onNavigateToMode: it resets the target rail bookmark to primary.
 */
import { buildPathWithRailView } from "../navigation/app-location";
import { writeRailView } from "../sidebar/rail-navigation-memory";
import { workspaceAssistantRoute } from "../../../shell/workspace-routes";

export function openAutomationRailPath(workspaceId: string): string | null {
  const id = workspaceId.trim();
  if (!id) return null;
  writeRailView("assistant", id, "automation");
  return buildPathWithRailView({
    mode: "assistant",
    pathname: workspaceAssistantRoute(id),
    search: "",
    view: "automation",
  });
}
