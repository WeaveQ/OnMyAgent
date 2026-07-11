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
  if (loading) return { label: "正在准备工作区", variant: "loading" };
  if (clientConnected) return { label: "可接受新任务", variant: "available" };
  if (onmyagentServerStatus === "limited") {
    return { label: "受限模式", variant: "limited" };
  }
  return { label: "暂不可接受任务", variant: "offline" };
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
