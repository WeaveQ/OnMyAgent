import { onmyagentServerRestart } from "../../app/lib/desktop";
import { isLoopbackOpenworkServerUrl, readOpenworkServerSettings } from "../../app/lib/onmyagent-server";
import { isDesktopRuntime } from "../../app/utils";

export function resolveOpenworkServerStartupPreference() {
  if (!isDesktopRuntime()) return "server";
  const stored = readOpenworkServerSettings();
  const storedUrl = stored.urlOverride?.trim() ?? "";
  return storedUrl && !isLoopbackOpenworkServerUrl(storedUrl) ? "server" : "local";
}

export async function restartLocalOpenworkServer() {
  if (!isDesktopRuntime()) return false;
  await onmyagentServerRestart({
    remoteAccessEnabled: readOpenworkServerSettings().remoteAccessEnabled === true,
  });
  return true;
}

export async function reconnectOpenworkServerAndRefresh(input: {
  reconnectOpenworkServer: () => Promise<boolean>;
  refreshRouteState: () => Promise<unknown>;
}) {
  const ok = await input.reconnectOpenworkServer();
  if (ok) {
    await input.refreshRouteState();
  }
  return ok;
}

export async function restartOpenworkServerAndRefresh(input: {
  reconnectOpenworkServer: () => Promise<boolean>;
  refreshRouteState: () => Promise<unknown>;
}) {
  if (!isDesktopRuntime()) return false;
  try {
    await restartLocalOpenworkServer();
    await input.reconnectOpenworkServer();
    await input.refreshRouteState();
    return true;
  } catch {
    return false;
  }
}
