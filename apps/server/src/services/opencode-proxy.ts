import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Actor, ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";

export function parseWorkspaceMount(
  pathname: string,
): { workspaceId: string; restPath: string } | null {
  if (!pathname.startsWith("/w/")) return null;
  const remainder = pathname.slice(3);
  if (!remainder) return null;
  const slash = remainder.indexOf("/");
  if (slash === -1) {
    return { workspaceId: decodeURIComponent(remainder), restPath: "/" };
  }
  const workspaceId = remainder.slice(0, slash);
  const restPath = remainder.slice(slash) || "/";
  if (!workspaceId.trim()) return null;
  return { workspaceId: decodeURIComponent(workspaceId), restPath };
}

export function parseWorkspaceOpencodeMount(
  pathname: string,
): { workspaceId: string; restPath: string } | null {
  if (!pathname.startsWith("/workspace/")) return null;
  const remainder = pathname.slice("/workspace/".length);
  if (!remainder) return null;
  const slash = remainder.indexOf("/");
  if (slash === -1) return null;
  const workspaceId = remainder.slice(0, slash);
  const restPath = remainder.slice(slash) || "/";
  if (!workspaceId.trim()) return null;
  if (restPath !== "/opencode" && !restPath.startsWith("/opencode/"))
    return null;
  return { workspaceId: decodeURIComponent(workspaceId), restPath };
}

export function normalizeOpencodeProxyPath(proxyPath: string): string {
  const raw = (proxyPath ?? "").trim() || "/";
  const withoutPrefix = raw.startsWith("/opencode")
    ? raw.slice("/opencode".length)
    : raw;
  const normalized = (withoutPrefix || "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function assertOpencodeProxyAllowed(
  actor: Actor,
  method: string,
  proxyPath: string,
) {
  const m = method.toUpperCase();
  const scope = actor.scope ?? "viewer";

  if (scope === "viewer" && m !== "GET" && m !== "HEAD") {
    throw new ApiError(403, "forbidden", "Viewer tokens are read-only");
  }

  // Prevent collaborators/viewers from self-approving OpenCode permission requests via the proxy.
  // OpenCode uses /permission/:requestId/reply (and historically also a session-scoped variant).
  if (scope !== "owner" && m !== "GET" && m !== "HEAD") {
    const normalized = normalizeOpencodeProxyPath(proxyPath);
    if (/\/permission\/[^/]+\/reply$/.test(normalized)) {
      throw new ApiError(
        403,
        "forbidden",
        "Only owner tokens can reply to permission requests",
      );
    }
  }
}

export function isSessionCommandProxyRequest(method: string, proxyPath: string) {
  return (
    method === "POST" &&
    /^\/session\/[^/]+\/command$/.test(normalizeOpencodeProxyPath(proxyPath))
  );
}

export function buildOpencodeProxyUrl(baseUrl: string, path: string, search: string) {
  const target = new URL(baseUrl);
  const trimmedPath = path.replace(/^\/opencode/, "");
  target.pathname = trimmedPath.startsWith("/")
    ? trimmedPath
    : `/${trimmedPath}`;
  target.search = search;
  return target.toString();
}

export function buildOpencodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory)
    ? encodeURIComponent(directory)
    : directory;
}

export function createOpencodeDirectoryFetch(directory: string): typeof fetch {
  return Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const headers = new Headers(init?.headers ?? request.headers);
      headers.set(
        "x-opencode-directory",
        buildOpencodeDirectoryHeader(directory),
      );
      return fetch(new Request(request, { headers }));
    },
    { preconnect: fetch.preconnect },
  );
}

export type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };

export function resolveOpencodeDirectory(workspace: WorkspaceInfo): string | null {
  const explicit = workspace.directory?.trim() ?? "";
  if (explicit) return normalizeOpencodeDirectory(explicit);
  if (workspace.workspaceType === "local")
    return normalizeOpencodeDirectory(workspace.path);
  return null;
}

export function normalizeOpencodeDirectory(directory: string): string {
  // OpenCode stores/list-filters Windows sessions by regular drive paths
  // (`C:\Users\...`). Electron can persist local workspaces as extended-length
  // paths (`\\?\C:\Users\...`); passing those through as the directory query
  // makes OpenCode return an empty session list even though the sessions exist.
  if (process.platform === "win32") {
    return directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "");
  }
  return directory;
}

/**
 * Build a fresh OpenCode SDK client (no pooling). Prefer
 * `getWorkspaceOpencodeClient` on hot paths.
 */
export function createWorkspaceOpencodeClient(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  directoryOverride?: string,
) {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const directory = directoryOverride?.trim() || resolveOpencodeDirectory(workspace);
  const directoryFetch = directory
    ? createOpencodeDirectoryFetch(directory)
    : undefined;

  return createOpencodeClient({
    baseUrl: connection.baseUrl?.trim(),
    ...(directory ? { directory } : {}),
    ...(directoryFetch ? { fetch: directoryFetch } : {}),
    ...(connection.authHeader
      ? { headers: { Authorization: connection.authHeader } }
      : {}),
  });
}


export function unwrapOpencodeResult<T, E>(
  result: OpencodeClientResult<T, E>,
  path: string,
): NonNullable<T> {
  if (result.data != null) {
    return result.data;
  }
  if (result.error === undefined) {
    throw new ApiError(
      502,
      "opencode_empty_response",
      "OpenCode returned an empty response",
      { path },
    );
  }
  throw new ApiError(
    502,
    "opencode_request_failed",
    describeOpencodeClientError(result.error),
    {
      status: result.response.status,
      body: result.error,
      path,
    },
  );
}

export function ensureOpencodeRequestSucceeded<T, E>(
  result: OpencodeClientResult<T, E>,
  path: string,
): void {
  if (result.error === undefined) return;
  throw new ApiError(
    502,
    "opencode_request_failed",
    describeOpencodeClientError(result.error),
    {
      status: result.response.status,
      body: result.error,
      path,
    },
  );
}

export async function logoutMcpAuth(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  name: string,
): Promise<void> {
  // Lazy import avoids ESM cycle: pool factory imports createWorkspaceOpencodeClient from this module.
  const {
    getWorkspaceOpencodeClient,
    clearWorkspaceOpencodeClients,
  } = await import("./opencode-client-pool.js");

  try {
    try {
      const opencode = getWorkspaceOpencodeClient(config, workspace);
      unwrapOpencodeResult(
        await opencode.mcp.disconnect({ name }),
        `/mcp/${encodeURIComponent(name)}/disconnect`,
      );
    } catch {
      // ignore disconnect failures; still attempt auth remove
    }

    try {
      const opencode = getWorkspaceOpencodeClient(config, workspace);
      unwrapOpencodeResult(
        await opencode.mcp.auth.remove({ name }),
        `/mcp/${encodeURIComponent(name)}/auth`,
      );
    } catch (error) {
      if (isMissingMcpAuthError(error)) return;
      throw error;
    }
  } finally {
    // Drop pooled clients so a later acquire cannot reuse post-logout state.
    clearWorkspaceOpencodeClients(workspace);
  }
}

export function isMissingMcpAuthError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code !== "opencode_request_failed") return false;
  const details = error.details;
  if (!details || typeof details !== "object" || !("status" in details)) {
    return false;
  }
  return details.status === 404;
}

export function assertOpencodeSuccess<T, E>(
  result: OpencodeClientResult<T, E>,
  path: string,
): void {
  if (result.error === undefined) return;
  throw new ApiError(
    502,
    "opencode_request_failed",
    describeOpencodeClientError(result.error),
    {
      status: result.response.status,
      body: result.error,
      path,
    },
  );
}

export function describeOpencodeClientError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return `OpenCode request failed: ${error.message.trim()}`;
  }
  return "OpenCode request failed";
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Strip hop-by-hop and transport-level headers that Bun's native fetch keeps
 * in the upstream response even after it has already decoded the body for us.
 * Without this the browser sees `content-encoding: gzip` on a plain-text
 * payload and bails out with ERR_CONTENT_DECODING_FAILED, breaking any UI
 * code that reaches through /opencode/* (including session.create).
 */
export function sanitizeProxyResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function proxyOpencodeRequest(input: {
  config: ServerConfig;
  request: Request;
  url: URL;
  workspace?: WorkspaceInfo;
  proxyPath?: string;
}) {
  const workspace = input.workspace;
  const baseUrl = workspace
    ? (resolveWorkspaceOpencodeConnection(
        input.config,
        workspace,
      ).baseUrl?.trim() ?? "")
    : "";
  if (!baseUrl) {
    throw new ApiError(
      400,
      "opencode_unconfigured",
      "OpenCode base URL is missing for this workspace",
    );
  }

  const proxyPath = input.proxyPath ?? input.url.pathname;
  const targetUrl = buildOpencodeProxyUrl(baseUrl, proxyPath, input.url.search);
  const headers = new Headers(input.request.headers);
  headers.delete("authorization");
  headers.delete("x-onmyagent-host-token");
  headers.delete("x-onmyagent-client-id");
  headers.delete("host");
  headers.delete("origin");

  const directory = workspace ? resolveOpencodeDirectory(workspace) : null;
  if (directory && !headers.has("x-opencode-directory")) {
    headers.set(
      "x-opencode-directory",
      buildOpencodeDirectoryHeader(directory),
    );
  }

  const auth = workspace
    ? (resolveWorkspaceOpencodeConnection(input.config, workspace).authHeader ??
      null)
    : null;
  if (auth) {
    headers.set("Authorization", auth);
  }

  const method = input.request.method.toUpperCase();
  // Buffer the request body so it can be forwarded reliably across Node.js
  // stream boundaries (Readable.toWeb streams from the HTTP adapter aren't
  // always accepted directly by Node's global fetch as a body).
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await input.request
          .arrayBuffer()
          .then((buf) => (buf.byteLength > 0 ? buf : undefined));
  if (isSessionCommandProxyRequest(method, proxyPath)) {
    void fetch(targetUrl, {
      method,
      headers,
      body,
    }).catch(() => {
      // Command failures are surfaced through the OpenCode event stream.
    });
    return jsonResponse({ ok: true, accepted: true });
  }
  const response = await fetch(targetUrl, {
    method,
    headers,
    body,
  });

  return sanitizeProxyResponse(response);
}
