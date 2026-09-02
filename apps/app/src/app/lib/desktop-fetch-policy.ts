/**
 * Renderer network destination policy for desktopFetch*.
 *
 * Loopback http(s) may hit the page origin directly. All other http(s)
 * destinations must go through the Electron main-process proxy so the
 * renderer never opens raw sockets to the public internet. Non-http(s)
 * schemes (and unparseable absolute URLs) are rejected.
 */

export type DesktopFetchRoute = "direct" | "via-main" | "reject";

export type DesktopFetchDecision = {
  route: DesktopFetchRoute;
  reason: string;
  url: string | null;
  hostname: string | null;
  protocol: string | null;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Hostnames the main process is always allowed to proxy (open by default). */
export const DEFAULT_MAIN_PROXY_HOST_ALLOWLIST: readonly string[] = [
  // Empty = allow any http(s) host through main. Override via options for
  // stricter product surfaces. Kept as an explicit list so tests and future
  // CSP work can tighten without rewriting callers.
];

export function extractRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String((input as { url?: string }).url ?? input);
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = String(hostname ?? "").trim().toLowerCase();
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  // IPv6 loopback without brackets occasionally appears.
  if (host === "::1") return true;
  return false;
}

export function isHttpProtocol(protocol: string): boolean {
  const p = String(protocol ?? "").toLowerCase();
  return p === "http:" || p === "https:";
}

/**
 * Pure policy: classify a renderer-originated request destination.
 *
 * @param input - fetch input or absolute URL string
 * @param options.hostAllowlist - when non-empty, non-loopback hosts must match
 *   (case-insensitive exact or `*.suffix`) to be proxied; otherwise reject.
 */
export function classifyDesktopFetchDestination(
  input: RequestInfo | URL | string,
  options: { hostAllowlist?: readonly string[] } = {},
): DesktopFetchDecision {
  const raw = (
    typeof input === "string" || input instanceof URL || typeof Request !== "undefined"
      ? extractRequestUrl(input as RequestInfo | URL)
      : String(input)
  ).trim();

  let url: URL;
  try {
    // Protocol-relative URLs (`//evil.com/x`) have an absolute authority but no
    // scheme. They must NOT be treated as same-origin relative paths — that
    // would let the renderer open raw sockets via globalThis.fetch. Parse with
    // a dummy https base so hostname classification still runs, then force
    // non-loopback hosts through the main-process proxy.
    if (raw.startsWith("//")) {
      url = new URL(raw, "https://invalid.invalid");
    } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
      // Path-only / query-only relative URLs stay same-origin.
      return {
        route: "direct",
        reason: "relative-or-same-origin",
        url: raw,
        hostname: null,
        protocol: null,
      };
    } else {
      url = new URL(raw);
    }
  } catch {
    return {
      route: "reject",
      reason: "unparseable-url",
      url: raw,
      hostname: null,
      protocol: null,
    };
  }

  if (!isHttpProtocol(url.protocol)) {
    return {
      route: "reject",
      reason: `blocked-scheme:${url.protocol.replace(/:$/, "") || "unknown"}`,
      url: url.toString(),
      hostname: url.hostname || null,
      protocol: url.protocol,
    };
  }

  if (isLoopbackHostname(url.hostname)) {
    return {
      route: "direct",
      reason: "loopback",
      url: url.toString(),
      hostname: url.hostname,
      protocol: url.protocol,
    };
  }

  const allowlist = options.hostAllowlist ?? DEFAULT_MAIN_PROXY_HOST_ALLOWLIST;
  if (allowlist.length > 0 && !hostMatchesAllowlist(url.hostname, allowlist)) {
    return {
      route: "reject",
      reason: "host-not-allowlisted",
      url: url.toString(),
      hostname: url.hostname,
      protocol: url.protocol,
    };
  }

  return {
    route: "via-main",
    reason: raw.startsWith("//")
      ? "protocol-relative-via-main-proxy"
      : "non-loopback-http-via-main-proxy",
    url: url.toString(),
    hostname: url.hostname,
    protocol: url.protocol,
  };
}

export function hostMatchesAllowlist(
  hostname: string,
  allowlist: readonly string[],
): boolean {
  const host = String(hostname ?? "").trim().toLowerCase();
  if (!host) return false;
  for (const entry of allowlist) {
    const rule = String(entry ?? "").trim().toLowerCase();
    if (!rule) continue;
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1); // ".example.com"
      if (host.endsWith(suffix) || host === rule.slice(2)) return true;
      continue;
    }
    if (host === rule) return true;
  }
  return false;
}

export class DesktopFetchPolicyError extends Error {
  readonly code = "desktop_fetch_policy_rejected";
  readonly decision: DesktopFetchDecision;

  constructor(decision: DesktopFetchDecision) {
    super(
      `desktopFetch blocked request (${decision.reason})${decision.url ? `: ${decision.url}` : ""}`,
    );
    this.name = "DesktopFetchPolicyError";
    this.decision = decision;
  }
}

export function fetchDirectWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number | undefined,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || (timeoutMs ?? 0) <= 0) {
    return globalThis.fetch(input, init);
  }
  const userSignal =
    init?.signal ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.signal
      : undefined);
  if (userSignal?.aborted) {
    const reason =
      userSignal.reason instanceof Error
        ? userSignal.reason
        : new DOMException("Request cancelled.", "AbortError");
    return Promise.reject(reason);
  }
  const controller = new AbortController();
  const combinedSignal =
    userSignal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([controller.signal, userSignal])
      : controller.signal;
  const nextInit: RequestInit = { ...(init ?? {}), signal: combinedSignal };
  let request: RequestInfo | URL = input;
  try {
    if (typeof Request !== "undefined" && input instanceof Request) {
      request = new Request(input, nextInit);
    }
  } catch (error) {
    return Promise.reject(error);
  }
  const onUserAbort =
    userSignal && combinedSignal === controller.signal
      ? () => controller.abort(userSignal.reason)
      : undefined;
  if (userSignal && onUserAbort) {
    userSignal.addEventListener("abort", onUserAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Request timed out."));
  }, timeoutMs);
  return globalThis
    .fetch(request, input instanceof Request ? undefined : nextInit)
    .catch((error) => {
      // Native fetch rejects AbortError ("The user aborted a request."), not
      // the abort reason. Remap our timer so callers see a timeout, not cancel.
      if (timedOut) {
        throw new Error("Request timed out.");
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      if (userSignal && onUserAbort) {
        userSignal.removeEventListener("abort", onUserAbort);
      }
    });
}
