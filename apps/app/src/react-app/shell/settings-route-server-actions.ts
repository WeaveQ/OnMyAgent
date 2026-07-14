import { onmyagentServerRestart } from "../../app/lib/desktop";
import { isLoopbackOnMyAgentServerUrl, readOnMyAgentServerSettings } from "../../app/lib/onmyagent-server";
import { isDesktopRuntime } from "../../app/utils";

export function resolveOnMyAgentServerStartupPreference() {
  if (!isDesktopRuntime()) return "server";
  const stored = readOnMyAgentServerSettings();
  const storedUrl = stored.urlOverride?.trim() ?? "";
  return storedUrl && !isLoopbackOnMyAgentServerUrl(storedUrl) ? "server" : "local";
}

export async function restartLocalOnMyAgentServer() {
  if (!isDesktopRuntime()) return false;
  await onmyagentServerRestart({
    remoteAccessEnabled: readOnMyAgentServerSettings().remoteAccessEnabled === true,
  });
  return true;
}

export async function reconnectOnMyAgentServerAndRefresh(input: {
  reconnectOnMyAgentServer: () => Promise<boolean>;
  refreshRouteState: () => Promise<unknown>;
}) {
  const ok = await input.reconnectOnMyAgentServer();
  if (ok) {
    await input.refreshRouteState();
  }
  return ok;
}

export async function restartOnMyAgentServerAndRefresh(input: {
  reconnectOnMyAgentServer: () => Promise<boolean>;
  refreshRouteState: () => Promise<unknown>;
}) {
  if (!isDesktopRuntime()) return false;
  try {
    await restartLocalOnMyAgentServer();
    await input.reconnectOnMyAgentServer();
    await input.refreshRouteState();
    return true;
  } catch {
    return false;
  }
}
