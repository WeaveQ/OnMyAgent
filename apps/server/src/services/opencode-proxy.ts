import type { Actor, ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { resolve } from "node:path";
import { ApiError } from "../core/errors.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import {
  buildOpencodeDirectoryHeader,
  resolveOpencodeDirectory,
} from "./opencode-workspace-client.js";
import {
  ensureAndAssertExpertRuntimeContract,
  EXPERT_PROMPT_BODY_MAX_BYTES,
  ExpertRuntimeContractError,
  resolveExpertRuntimeDirectoryCandidate,
  type ExpertRuntimeContractEvent,
} from "./expert-runtime-contract.js";
import { recordExpertLifecycleEvent } from "./expert-lifecycle-events.js";

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

/** Canonical and legacy mounts both normalize to this OpenCode route. */
export function isExpertPromptProxyRequest(method: string, proxyPath: string) {
  return (
    method.toUpperCase() === "POST" &&
    /^\/session\/[^/]+\/prompt_async$/.test(normalizeOpencodeProxyPath(proxyPath))
  );
}

export function parseExpertPromptProxyPath(proxyPath: string): string | null {
  const match = normalizeOpencodeProxyPath(proxyPath).match(
    /^\/session\/([^/]+)\/prompt_async$/,
  );
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
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

export type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };

// Client construction lives in a leaf module so the pool can import it
// without cycling through this proxy module (which lazy-imports the pool).
export {
  buildOpencodeDirectoryHeader,
  createOpencodeDirectoryFetch,
  createWorkspaceOpencodeClient,
  normalizeOpencodeDirectory,
  resolveOpencodeDirectory,
} from "./opencode-workspace-client.js";

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
  if (isAbortError(result.error)) {
    throw result.error;
  }
  const status =
    result.response && typeof result.response === "object" && "status" in result.response
      ? Number((result.response as { status?: unknown }).status)
      : undefined;
  throw new ApiError(
    502,
    "opencode_request_failed",
    describeOpencodeClientError(result.error),
    {
      ...(Number.isFinite(status) ? { status } : {}),
      body: result.error,
      path,
    },
  );
}

function isAbortError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
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
  onExpertContractViolation?: (event: ExpertRuntimeContractEvent) => void;
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
  const expertPrompt = isExpertPromptProxyRequest(method, proxyPath);
  if (expertPrompt && workspace) {
    const sessionId = parseExpertPromptProxyPath(proxyPath);
    const preview = await readBoundedJsonClone(input.request);
    const queryDirectory = decodeOpencodeDirectoryHeader(
      input.url.searchParams.get("directory"),
    );
    const headerDirectory = decodeOpencodeDirectoryHeader(
      input.request.headers.get("x-opencode-directory"),
    );
    const bodyDirectory = typeof preview.body?.directory === "string"
      ? decodeOpencodeDirectoryHeader(preview.body.directory)
      : null;
    // OpenCode SDK v2 sends the per-call `directory` as a query parameter on
    // POST while retaining its client-default directory header. The explicit
    // query therefore owns routing; header/body are compatibility fallbacks.
    const directorySources = [queryDirectory, headerDirectory, bodyDirectory]
      .filter((value): value is string => Boolean(value));
    const requestedDirectory = directorySources[0] ?? null;
    // An ordinary workspace prompt has no managed Expert marker. Keep it on
    // the existing forwarding path even when its JSON is malformed/large.
    const expertCandidates = await Promise.all(
      directorySources.map((source) => resolveExpertRuntimeDirectoryCandidate({
          workspaceId: workspace.id,
          sessionRoot: source,
          // A direct `/opencode/*` proxy has no routed workspace segment. A
          // managed marker from another workspace must still be detected so
          // the strict assertion fails closed instead of forwarding into it.
          allowWorkspaceMismatch: true,
        })),
    );
    const authorizedExpertDirectory = expertCandidates[0] ?? null;
    const candidatePaths = new Set(
      expertCandidates.filter((value): value is string => Boolean(value)).map((value) => resolve(value)),
    );
    if (candidatePaths.size > 0 && (!authorizedExpertDirectory || candidatePaths.size > 1)) {
      const error = new ExpertRuntimeContractError(
        "authorized_directory",
        { workspace, sessionId: sessionId ?? "", directory: requestedDirectory ?? "" },
        "Expert prompt directory sources conflict",
      );
      emitExpertContractViolation(input.onExpertContractViolation, error.toEvent());
      throw error;
    }
    if (authorizedExpertDirectory) {
      const expertDirectory = requestedDirectory as string;
      if (!sessionId) {
        const error = new ExpertRuntimeContractError(
          "session_identity",
          { workspace, sessionId: "", directory: expertDirectory },
          "Expert prompt route has an invalid session id",
        );
        emitExpertContractViolation(input.onExpertContractViolation, error.toEvent());
        throw error;
      }
      if (preview.tooLarge) {
        const error = new ExpertRuntimeContractError(
          "prompt_body_too_large",
          { workspace, sessionId, directory: expertDirectory },
          "Expert prompt body exceeds the bounded proxy inspection limit",
          { bodyLimitBytes: EXPERT_PROMPT_BODY_MAX_BYTES },
        );
        emitExpertContractViolation(input.onExpertContractViolation, error.toEvent());
        throw error;
      }
      if (preview.body === null) {
        const error = new ExpertRuntimeContractError(
          "prompt_body_invalid",
          { workspace, sessionId, directory: expertDirectory },
          "Expert prompt body must be a JSON object",
        );
        emitExpertContractViolation(input.onExpertContractViolation, error.toEvent());
        throw error;
      }
      await ensureAndAssertExpertRuntimeContract(
        {
          workspace,
          sessionId,
          directory: expertDirectory,
          agent: typeof preview.body.agent === "string" ? preview.body.agent : undefined,
          promptBody: preview.body,
        },
        { onViolation: input.onExpertContractViolation },
      );
    }
  }
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
    signal: input.request.signal,
  });

  return sanitizeProxyResponse(response);
}

function emitExpertContractViolation(
  callback: ((event: ExpertRuntimeContractEvent) => void) | undefined,
  event: ExpertRuntimeContractEvent,
): void {
  recordExpertLifecycleEvent({
    kind: "contract_assertion",
    phase: "assert",
    outcome: "failed",
    assertion: assertionForViolationCode(event.violationCode),
    code: event.violationCode === "prompt_token_budget" ? "prompt_budget_exceeded" : event.violationCode,
    workspaceHash: event.workspaceHash,
    sessionHash: event.sessionHash,
  });
  callback?.(event);
}

function assertionForViolationCode(
  code: ExpertRuntimeContractEvent["violationCode"],
): "authorized_directory" | "marker" | "identity" | "agent" | "skills" | "plugin_isolation" | "prompt_budget" {
  switch (code) {
    case "authorized_directory": return "authorized_directory";
    case "marker_version": return "marker";
    case "workspace_identity":
    case "session_identity": return "identity";
    case "agent_identity":
    case "prompt_agent_not_allowed": return "agent";
    case "default_agent": return "agent";
    case "plugin_isolation": return "plugin_isolation";
    case "skills_mismatch": return "skills";
    case "prompt_body_invalid":
    case "prompt_body_too_large":
    case "prompt_token_budget": return "prompt_budget";
  }
}

type BoundedJsonClone = {
  body: Record<string, unknown> | null;
  tooLarge: boolean;
};

async function readBoundedJsonClone(request: Request): Promise<BoundedJsonClone> {
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > EXPERT_PROMPT_BODY_MAX_BYTES) {
    return { body: null, tooLarge: true };
  }
  const clone = request.clone();
  if (!clone.body) return { body: null, tooLarge: false };
  const reader = clone.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > EXPERT_PROMPT_BODY_MAX_BYTES) {
        await reader.cancel();
        return { body: null, tooLarge: true };
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return { body: null, tooLarge: false };
  try {
    const parsed = JSON.parse(text) as unknown;
    return {
      body: parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null,
      tooLarge: false,
    };
  } catch {
    return { body: null, tooLarge: false };
  }
}

function decodeOpencodeDirectoryHeader(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}
