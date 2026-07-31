/**
 * Open an automation run session without leaving the automation primary rail.
 *
 * Root cause of the home jump: sidebar.onOpenSession → navigateToWorkspaceSession
 * builds a clean assistant URL with no `?view=`, so resolveActiveRailView falls
 * back to primary home and clears the embedded session.
 */
import { workspaceAssistantRoute } from "../../../shell";
import { buildPathWithRailView } from "../navigation/app-location";

export function buildAutomationEmbeddedSessionPath(input: {
  workspaceId: string;
  sessionId: string;
}): string | null {
  const workspaceId = input.workspaceId.trim();
  const sessionId = input.sessionId.trim();
  if (!workspaceId || !sessionId) return null;
  return buildPathWithRailView({
    mode: "assistant",
    pathname: workspaceAssistantRoute(workspaceId, sessionId),
    search: "",
    view: "automation",
  });
}
