type FieldsResult<T> = {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
};

export type OpenCodeRouterHealthSnapshot = {
  ok: boolean;
  opencode: {
    url: string;
    healthy: boolean;
    version?: string;
  };
  channels: {
    telegram: boolean;
    whatsapp: boolean;
    slack: boolean;
  };
  config: {
    groupsEnabled: boolean;
  };
};

type OpencodeHealthClient = {
  global: {
    health: () => Promise<FieldsResult<{ healthy?: boolean } & Record<string, unknown>>>;
  };
  path: {
    get: () => Promise<FieldsResult<Record<string, unknown>>>;
  };
};

function unwrap<T>(result: FieldsResult<T>): T {
  if (result.data !== undefined) {
    return result.data;
  }
  if (result.error) {
    throw result.error;
  }
  throw new Error("SDK call returned no data");
}

async function readJsonResponse<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }
  return (await response.json()) as T;
}

export async function waitForHealthy(
  url: string,
  timeoutMs = 10_000,
  pollMs = 250,
): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for health check");
}

export async function fetchOpenCodeRouterHealth(
  baseUrl: string,
): Promise<OpenCodeRouterHealthSnapshot> {
  return await readJsonResponse<OpenCodeRouterHealthSnapshot>(
    `${baseUrl.replace(/\/$/, "")}/health`,
  );
}

export async function fetchOpenCodeRouterHealthViaOpenwork(
  onmyagentUrl: string,
  token: string,
): Promise<OpenCodeRouterHealthSnapshot> {
  const url = `${onmyagentUrl.replace(/\/$/, "")}/opencode-router/health`;
  return await readJsonResponse<OpenCodeRouterHealthSnapshot>(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function waitForOpenCodeRouterHealthy(
  baseUrl: string,
  timeoutMs = 10_000,
  pollMs = 500,
) {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
      if (response.ok) {
        return (await response.json()) as OpenCodeRouterHealthSnapshot;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for opencodeRouter health");
}

export async function waitForOpenCodeRouterHealthyViaOpenwork(
  onmyagentUrl: string,
  token: string,
  timeoutMs = 10_000,
  pollMs = 500,
): Promise<OpenCodeRouterHealthSnapshot> {
  const url = `${onmyagentUrl.replace(/\/$/, "")}/opencode-router/health`;
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        return (await response.json()) as OpenCodeRouterHealthSnapshot;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    lastError ??
      "Timed out waiting for opencodeRouter health via onmyagent-server",
  );
}

export async function waitForOpencodeHealthy(
  client: OpencodeHealthClient,
  timeoutMs = 10_000,
  pollMs = 250,
) {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const health = unwrap(await client.global.health());
      if (health?.healthy) return health;
      lastError = "Server reported unhealthy";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    try {
      unwrap(await client.path.get());
      return { healthy: true, degraded: true, reason: lastError ?? undefined };
    } catch (error) {
      if (!lastError) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for OpenCode health");
}

export async function waitForHealthyViaProxy(
  proxyBaseUrl: string,
  token: string,
  timeoutMs = 10_000,
  pollMs = 250,
): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${proxyBaseUrl}/health`, {
        headers,
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
      if (res.status < 500) return;
      lastError = `Proxy returned ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    lastError ?? "Timed out waiting for OpenCode health via proxy",
  );
}

export async function waitForRouterHealthy(
  baseUrl: string,
  timeoutMs = 10_000,
  pollMs = 250,
): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  const url = baseUrl.replace(/\/$/, "");
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for daemon health");
}
