import { t } from "../../../../i18n";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import type {
  WorkspaceSessionGroup,
} from "../../../../app/types";
import type { OnMyAgentServerStatus } from "../../../../app/lib/onmyagent-server";

export const STARTUP_SKELETON_ROWS = [
  { id: "intro", titleWidth: "42%", bodyWidth: "88%" },
  { id: "middle", titleWidth: "56%", bodyWidth: "88%" },
  { id: "final", titleWidth: "36%", bodyWidth: "74%" },
];

/**
 * Full-page card skeleton is only for true cold boot (no workspace identity yet).
 * After settings "Back to app" the route already has a workspace id while the
 * engine reconnects — do not mask the draft home with a multi-second skeleton.
 */
export function shouldShowSessionStartupSkeleton(input: {
  selectedSessionId: string | null | undefined;
  selectedWorkspaceId: string | null | undefined;
  clientConnected: boolean;
  startupPhase: string | null | undefined;
}): boolean {
  if (input.selectedSessionId?.trim()) return false;
  if (input.selectedWorkspaceId?.trim()) return false;
  if (input.clientConnected) return false;
  const phase = input.startupPhase ?? "";
  if (
    phase === "sessionIndexReady" ||
    phase === "firstSessionReady" ||
    phase === "ready"
  ) {
    return false;
  }
  return true;
}

export const GLOBAL_VOICE_SIDE_PANEL_KEY = "__onmyagent_voice__";
export const AGENT_PANEL_MIN_WIDTH = 240;
export const AGENT_PANEL_MAX_WIDTH = 360;
export const AGENT_PANEL_DEFAULT_WIDTH = 300;

export type TaskStatusIndicator = {
  label: string;
  variant: "available" | "loading" | "limited" | "offline";
};

export function workspaceTaskStatus(
  clientConnected: boolean,
  onmyagentServerStatus: OnMyAgentServerStatus,
  loading: boolean,
): TaskStatusIndicator {
  if (loading) return { label: t("session.preparing_workspace"), variant: "loading" };
  if (clientConnected) return { label: t("status.ready_for_tasks"), variant: "available" };
  if (onmyagentServerStatus === "limited") {
    return { label: t("status.limited_mode"), variant: "limited" };
  }
  return { label: t("status.unavailable_for_tasks"), variant: "offline" };
}

export function getSidebarInitialLoading(input: {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  sidebarHydratedFromCache?: boolean;
  startupPhase: BootPhase;
}) {
  if (input.workspaceSessionGroups.some((group) => group.sessions.length > 0)) {
    return false;
  }
  if (input.sidebarHydratedFromCache) return false;
  if (
    input.startupPhase !== "sessionIndexReady" &&
    input.startupPhase !== "firstSessionReady" &&
    input.startupPhase !== "ready"
  ) {
    return true;
  }
  return input.workspaceSessionGroups.some(
    (group) => group.status === "loading" || group.status === "idle",
  );
}

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
