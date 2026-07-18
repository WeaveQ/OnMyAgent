import type { SidebarSessionItem } from "../../../app/types";

/**
 * When auto-new-session-on-idle is enabled and the selected session has been
 * inactive for at least `idleHours`, the next send should open a new session.
 */
export function shouldForceNewSessionOnIdle(input: {
  enabled: boolean;
  idleHours: number;
  selectedSessionId: string | null;
  sessions: SidebarSessionItem[];
  nowMs?: number;
}): boolean {
  if (!input.enabled || !input.selectedSessionId) return false;
  const hours = Number.isFinite(input.idleHours)
    ? Math.min(168, Math.max(1, Math.round(input.idleHours)))
    : 6;
  const session = input.sessions.find((item) => item.id === input.selectedSessionId);
  if (!session) return false;
  const lastActive =
    session.time?.updated ?? session.time?.created ?? 0;
  if (!lastActive || lastActive <= 0) return false;
  const now = input.nowMs ?? Date.now();
  const idleMs = hours * 60 * 60 * 1000;
  return now - lastActive >= idleMs;
}
