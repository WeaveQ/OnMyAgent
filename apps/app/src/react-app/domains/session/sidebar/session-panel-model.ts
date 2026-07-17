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
