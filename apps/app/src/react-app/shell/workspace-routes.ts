import type { SettingsTab } from "../../app/types";

export function workspaceSessionRoute(workspaceId: string, sessionId?: string | null) {
  const workspace = encodeURIComponent(workspaceId.trim());
  const session = sessionId?.trim();
  return session
    ? `/workspace/${workspace}/session/${encodeURIComponent(session)}`
    : `/workspace/${workspace}/session`;
}

export function workspaceAssistantRoute(workspaceId: string, sessionId?: string | null) {
  const workspace = encodeURIComponent(workspaceId.trim());
  const session = sessionId?.trim();
  return session
    ? `/workspace/${workspace}/assistant/${encodeURIComponent(session)}`
    : `/workspace/${workspace}/assistant`;
}

export function legacyAssistantRoute(sessionId?: string | null) {
  const session = sessionId?.trim();
  return session ? `/assistant/${encodeURIComponent(session)}` : "/assistant";
}

export function workspaceSettingsRoute(
  workspaceId: string,
  tab: SettingsTab | "extensions/mcp" | "extensions/plugins" | string = "general",
) {
  return `/workspace/${encodeURIComponent(workspaceId.trim())}/settings/${tab}`;
}

export function globalSettingsRoute(tab: SettingsTab) {
  return `/settings/${tab}`;
}

export function legacySessionRoute(sessionId?: string | null) {
  const session = sessionId?.trim();
  return session ? `/session/${encodeURIComponent(session)}` : "/session";
}
