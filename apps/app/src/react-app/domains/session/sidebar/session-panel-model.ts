import { ONMYAGENT_EXTENSION_CATALOG } from "../../../../app/constants";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import {
  getExtensionId,
  isOnMyAgentExtensionEnabled,
} from "../../shared";

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

export function isVoiceExtensionEnabled(): boolean {
  const voiceExtension =
    ONMYAGENT_EXTENSION_CATALOG.find(
      (entry) => getExtensionId(entry) === "onmyagent-voice",
    ) ?? null;
  return voiceExtension ? isOnMyAgentExtensionEnabled(voiceExtension) : false;
}

export const DEFAULT_AGENT_TEMPLATE_ID = "daily-assistant";
