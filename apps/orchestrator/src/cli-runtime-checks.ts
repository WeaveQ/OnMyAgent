/**
 * Runtime version verification and start --check suites.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  assertVersionMatch,
  captureCommandOutput,
  readCliVersion,
} from "./runtime-spawn.js";
import { fetchJson, normalizeEvent, unwrap } from "./cli-http-output.js";
import { normalizeWorkspacePath } from "./cli-router-state.js";
import type {
  ResolvedBinary,
  RuntimeServiceName,
  RuntimeServiceSnapshot,
} from "./cli-types.js";

type WorkspaceListResponse = {
  items?: Array<{
    id?: string;
    path?: string;
    opencode?: {
      baseUrl?: string;
      directory?: string;
      username?: string;
      password?: string;
    };
  }>;
};

export async function verifyOpenCodeRouterVersion(
  binary: ResolvedBinary,
): Promise<string | undefined> {
  if (binary.source !== "external") {
    return binary.expectedVersion;
  }
  const actual = await readCliVersion(binary.bin);
  assertVersionMatch(
    "opencode-router",
    binary.expectedVersion,
    actual,
    binary.bin,
  );
  return actual;
}

export async function verifyOpencodeVersion(
  binary: ResolvedBinary,
): Promise<string | undefined> {
  const actual = await readCliVersion(binary.bin);
  // When the binary was explicitly provided via --opencode-bin (source "external"),
  // a strict version check would break desktop app users whenever a new opencode
  // release ships on GitHub before OnMyAgent updates its bundled binary. Log a
  // warning instead of throwing so the caller can still proceed.
  if (
    binary.source === "external" &&
    binary.expectedVersion &&
    actual &&
    binary.expectedVersion !== actual
  ) {
    process.stderr.write(
      `[onmyagent-orchestrator] Warning: opencode version mismatch (expected ${binary.expectedVersion}, got ${actual}). Proceeding with ${binary.bin}.\n`,
    );
    return actual;
  }
  assertVersionMatch("opencode", binary.expectedVersion, actual, binary.bin);
  return actual;
}

export async function verifyOnMyAgentServer(input: {
  baseUrl: string;
  token: string;
  hostToken: string;
  expectedVersion?: string;
  expectedWorkspace: string;
  expectedOpencodeBaseUrl?: string;
  expectedOpencodeDirectory?: string;
  expectedOpencodeUsername?: string;
  expectedOpencodePassword?: string;
}): Promise<string | undefined> {
  const health = await fetchJson<{ version?: string }>(`${input.baseUrl}/health`);
  const actualVersion =
    typeof health?.version === "string" ? health.version : undefined;
  assertVersionMatch(
    "onmyagent-server",
    input.expectedVersion,
    actualVersion,
    `${input.baseUrl}/health`,
  );

  const headers = { Authorization: `Bearer ${input.token}` };
  const workspaces = await fetchJson<WorkspaceListResponse>(`${input.baseUrl}/workspaces`, {
    headers,
  });
  const items = Array.isArray(workspaces?.items)
    ? workspaces.items
    : [];
  if (!items.length) {
    throw new Error("OnMyAgent server returned no workspaces");
  }

  const expectedPath = normalizeWorkspacePath(input.expectedWorkspace);
  const matched = items.find((item) => {
    const candidate = item as { path?: string };
    const path = typeof candidate.path === "string" ? candidate.path : "";
    return path && normalizeWorkspacePath(path) === expectedPath;
  }) as
    | {
        id?: string;
        path?: string;
        opencode?: {
          baseUrl?: string;
          directory?: string;
          username?: string;
          password?: string;
        };
      }
    | undefined;

  if (!matched) {
    throw new Error(
      `OnMyAgent server workspace mismatch. Expected ${expectedPath}.`,
    );
  }

  const opencode = matched.opencode;
  if (
    input.expectedOpencodeBaseUrl &&
    opencode?.baseUrl !== input.expectedOpencodeBaseUrl
  ) {
    throw new Error(
      `OnMyAgent server OpenCode base URL mismatch: expected ${input.expectedOpencodeBaseUrl}, got ${opencode?.baseUrl ?? "<missing>"}.`,
    );
  }
  if (
    input.expectedOpencodeDirectory &&
    opencode?.directory !== input.expectedOpencodeDirectory
  ) {
    throw new Error(
      `OnMyAgent server OpenCode directory mismatch: expected ${input.expectedOpencodeDirectory}, got ${opencode?.directory ?? "<missing>"}.`,
    );
  }
  if (
    input.expectedOpencodeUsername &&
    opencode?.username !== input.expectedOpencodeUsername
  ) {
    throw new Error("OnMyAgent server OpenCode username mismatch.");
  }
  if (
    input.expectedOpencodePassword &&
    opencode?.password !== input.expectedOpencodePassword
  ) {
    throw new Error("OnMyAgent server OpenCode password mismatch.");
  }

  const hostHeaders = { "X-OnMyAgent-Host-Token": input.hostToken };
  await fetchJson(`${input.baseUrl}/approvals`, { headers: hostHeaders });

  return actualVersion;
}

export async function installGlobalPackages(packages: string[]): Promise<void> {
  if (!packages.length) return;
  await captureCommandOutput("npm", ["install", "-g", ...packages], {
    timeoutMs: 5 * 60_000,
  });
}

export function buildRuntimeServiceSnapshot(input: {
  name: RuntimeServiceName;
  enabled: boolean;
  running: boolean;
  binary?: ResolvedBinary | null;
  actualVersion?: string;
}): RuntimeServiceSnapshot {
  const targetVersion = input.binary?.expectedVersion;
  const actualVersion = input.actualVersion;
  return {
    name: input.name,
    enabled: input.enabled,
    running: input.enabled ? input.running : false,
    source: input.binary?.source,
    path: input.binary?.bin,
    targetVersion,
    actualVersion,
    upgradeAvailable: Boolean(
      input.enabled &&
      targetVersion &&
      actualVersion &&
      targetVersion !== actualVersion,
    ),
  };
}

export async function runChecks(input: {
  opencodeClient: ReturnType<typeof createOpencodeClient>;
  onmyagentUrl: string;
  onmyagentToken: string;
  hostToken: string;
  checkEvents: boolean;
}) {
  const baseUrl = input.onmyagentUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${input.onmyagentToken}` };
  const hostHeaders = { "X-OnMyAgent-Host-Token": input.hostToken };
  const workspaces = await fetchJson<WorkspaceListResponse>(`${baseUrl}/workspaces`, { headers });
  if (!workspaces?.items?.length) {
    throw new Error("OnMyAgent server returned no workspaces");
  }

  const workspaceId = workspaces.items[0].id as string;
  await fetchJson(`${baseUrl}/workspace/${workspaceId}/config`, { headers });

  // Smoke test: mounted opencodeRouter proxy and auth behavior.
  // - /w/:id/opencode-router/health is client-readable
  // - other /w/:id/opencode-router/* requires host/owner auth
  const owMountBase = `${baseUrl}/w/${encodeURIComponent(workspaceId)}/opencode-router`;
  const owHealthRes = await fetch(`${owMountBase}/health`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (owHealthRes.status >= 500) {
    throw new Error(
      `opencodeRouter mount proxy returned ${owHealthRes.status}`,
    );
  }
  const owConfigured = owHealthRes.status !== 404;
  if (owConfigured) {
    const clientRes = await fetch(`${owMountBase}/config/groups`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (clientRes.status === 200) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups should require host auth",
      );
    }
    if (clientRes.status !== 401 && clientRes.status !== 403) {
      throw new Error(
        `opencodeRouter mount proxy /config/groups unexpected status: ${clientRes.status}`,
      );
    }

    const hostRes = await fetch(`${owMountBase}/config/groups`, {
      headers: hostHeaders,
      signal: AbortSignal.timeout(3000),
    });
    if (hostRes.status >= 500) {
      throw new Error(
        `opencodeRouter mount proxy (host auth) returned ${hostRes.status}`,
      );
    }
    if (hostRes.status === 401 || hostRes.status === 403) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups rejected host auth",
      );
    }
  }

  const created = await input.opencodeClient.session.create({
    title: "OnMyAgent headless check",
  });
  const createdSession = unwrap(created);
  unwrap(
    await input.opencodeClient.session.messages({
      sessionID: createdSession.id,
      limit: 10,
    }),
  );

  if (input.checkEvents) {
    const events: { type: string }[] = [];
    const controller = new AbortController();
    const subscription = await input.opencodeClient.event.subscribe(undefined, {
      signal: controller.signal,
    });
    const reader = (async () => {
      try {
        for await (const raw of subscription.stream) {
          const normalized = normalizeEvent(raw);
          if (!normalized) continue;
          events.push(normalized);
          if (events.length >= 10) break;
        }
      } catch {
        // ignore
      }
    })();

    unwrap(
      await input.opencodeClient.session.create({
        title: "OnMyAgent headless check events",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    controller.abort();
    await Promise.race([
      reader,
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);

    if (!events.length) {
      throw new Error("No SSE events observed during check");
    }
  }
}

/**
 * Lighter check suite for sandbox mode.  Uses only raw HTTP against the
 * onmyagent-server endpoints — no OpenCode SDK calls that rely on Bearer
 * auth through the proxy (since the released server binary may predate our
 * token/proxy changes).
 */
export async function runSandboxChecks(input: {
  onmyagentUrl: string;
  onmyagentToken: string;
  hostToken: string;
}) {
  const baseUrl = input.onmyagentUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${input.onmyagentToken}` };
  const hostHeaders = { "X-OnMyAgent-Host-Token": input.hostToken };

  // 1. Server health
  const health = await fetchJson(`${baseUrl}/health`);
  if (!health || typeof health !== "object") {
    throw new Error("onmyagent-server /health returned invalid payload");
  }

  // 2. Workspaces list
  const workspaces = await fetchJson<WorkspaceListResponse>(`${baseUrl}/workspaces`, { headers });
  if (!workspaces?.items?.length) {
    throw new Error("onmyagent-server returned no workspaces");
  }
  const workspaceId = workspaces.items[0].id as string;

  // 3. Workspace config
  await fetchJson(`${baseUrl}/workspace/${workspaceId}/config`, { headers });

  // 4. Approvals endpoint (host auth)
  await fetchJson(`${baseUrl}/approvals`, { headers: hostHeaders });

  // 5. Proxy is reachable (even if auth is rejected — non-5xx proves the
  //    server is proxying to a running opencode)
  const proxyRes = await fetch(
    `${baseUrl}/workspace/${encodeURIComponent(workspaceId)}/opencode/health`,
    {
      headers,
      signal: AbortSignal.timeout(3000),
    },
  );
  if (proxyRes.status === 404 || proxyRes.status >= 500) {
    throw new Error(`opencode proxy returned ${proxyRes.status}`);
  }

  // 6. opencodeRouter proxy is reachable (if configured)
  const owRes = await fetch(`${baseUrl}/opencode-router/health`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (owRes.status >= 500) {
    throw new Error(`opencodeRouter proxy returned ${owRes.status}`);
  }

  // 7. Mounted opencodeRouter proxy + auth behavior (if configured)
  if (owRes.status !== 404) {
    const owMountBase = `${baseUrl}/w/${encodeURIComponent(workspaceId)}/opencode-router`;
    const mountHealth = await fetch(`${owMountBase}/health`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (mountHealth.status >= 500) {
      throw new Error(
        `opencodeRouter mount proxy returned ${mountHealth.status}`,
      );
    }
    const mountClient = await fetch(`${owMountBase}/config/groups`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (mountClient.status === 200) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups should require host auth",
      );
    }
    if (mountClient.status !== 401 && mountClient.status !== 403) {
      throw new Error(
        `opencodeRouter mount proxy /config/groups unexpected status: ${mountClient.status}`,
      );
    }
    const mountHost = await fetch(`${owMountBase}/config/groups`, {
      headers: hostHeaders,
      signal: AbortSignal.timeout(3000),
    });
    if (mountHost.status >= 500) {
      throw new Error(
        `opencodeRouter mount proxy (host auth) returned ${mountHost.status}`,
      );
    }
    if (mountHost.status === 401 || mountHost.status === 403) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups rejected host auth",
      );
    }
  }
}
