import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { WorkspaceSessionGroup } from "../../../../app/types";

export const STARTUP_SKELETON_ROWS = [
  { id: "intro", titleWidth: "42%", bodyWidth: "88%" },
  { id: "middle", titleWidth: "56%", bodyWidth: "88%" },
  { id: "final", titleWidth: "36%", bodyWidth: "74%" },
];

/**
 * Full-page card skeleton for cold first paint.
 *
 * - App cold start (`coldBootShell`): show even when workspace id is already
 *   hydrated from cache/desktop list so the home column is not blank under or
 *   right after the boot overlay.
 * - Settings "Back to app" remount: `coldBootShell` is false; if a workspace id
 *   is already known, skip the multi-second skeleton and keep draft home.
 */
export function shouldShowSessionStartupSkeleton(input: {
  selectedSessionId: string | null | undefined;
  selectedWorkspaceId: string | null | undefined;
  clientConnected: boolean;
  startupPhase: string | null | undefined;
  /** True when this session-route mount began during app cold boot. */
  coldBootShell?: boolean;
}): boolean {
  if (input.selectedSessionId?.trim()) return false;
  if (input.clientConnected) return false;
  const phase = input.startupPhase ?? "";
  if (
    phase === "sessionIndexReady" ||
    phase === "firstSessionReady" ||
    phase === "ready"
  ) {
    return false;
  }
  if (input.coldBootShell) return true;
  if (input.selectedWorkspaceId?.trim()) return false;
  return true;
}


export const AGENT_PANEL_MIN_WIDTH = 180;
export const AGENT_PANEL_MAX_WIDTH = 300;
export const AGENT_PANEL_DEFAULT_WIDTH = 264;

export function sessionTitleForId(
  groups: WorkspaceSessionGroup[],
  id: string | null | undefined,
) {
  if (!id) return "";
  const sessionsById = new Map(
    groups.flatMap((group) =>
      group.sessions.map((session) => [session.id, session] as const),
    ),
  );
  const match = sessionsById.get(id);
  return match ? getDisplaySessionTitle(match.title) : "";
}


export const DEFAULT_AGENT_TEMPLATE_ID = "daily-assistant";
