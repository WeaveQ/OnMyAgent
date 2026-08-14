import { createHash } from "node:crypto";

/**
 * Must match `workspaceIdForPath` in apps/server/src/workspace/workspaces.ts.
 * Sandbox OpenCode is proxied at `/workspace/<this-id>/opencode`.
 */
export function onmyagentServerWorkspaceIdForPath(path: string): string {
  const hash = createHash("sha256").update(path).digest("hex");
  return `ws_${hash.slice(0, 12)}`;
}

export function onmyagentOpencodeProxyBaseUrl(
  onmyagentBaseUrl: string,
  workspacePath: string,
): string {
  const workspaceId = onmyagentServerWorkspaceIdForPath(workspacePath);
  return `${onmyagentBaseUrl.replace(/\/$/, "")}/workspace/${encodeURIComponent(workspaceId)}/opencode`;
}

/** After the server is up, prefer the live workspace id over hashing a path. */
export async function resolveOnmyagentOpencodeProxyBaseUrl(input: {
  onmyagentBaseUrl: string;
  onmyagentToken: string;
  fallbackWorkspacePath: string;
}): Promise<string> {
  const baseUrl = input.onmyagentBaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/workspaces`, {
      headers: { Authorization: `Bearer ${input.onmyagentToken}` },
    });
    if (response.ok) {
      const workspaces = (await response.json()) as {
        items?: Array<{ id?: string }>;
      };
      const workspaceId = String(workspaces?.items?.[0]?.id ?? "").trim();
      if (workspaceId) {
        return `${baseUrl}/workspace/${encodeURIComponent(workspaceId)}/opencode`;
      }
    }
  } catch {
    // Fall back to the path the sandbox server actually registered.
  }
  return onmyagentOpencodeProxyBaseUrl(baseUrl, input.fallbackWorkspacePath);
}
