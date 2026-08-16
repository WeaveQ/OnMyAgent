/**
 * Worker activity heartbeat helpers.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "./cli-logging.js";
import type { WorkerActivityHeartbeatConfig } from "./cli-types.js";
import { unwrap } from "./cli-http-output.js";

export const DEFAULT_ACTIVITY_WINDOW_MS = 5 * 60_000;
export const DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export function parsePositiveNumberEnv(
  value: string | undefined,
  fallback: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseSessionActivityAt(session: unknown): number | null {
  if (!session || typeof session !== "object") return null;
  const record = session as {
    time?: { updated?: number; created?: number };
  };
  const updated = record.time?.updated;
  if (typeof updated === "number" && Number.isFinite(updated) && updated > 0) {
    return updated;
  }
  const created = record.time?.created;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    return created;
  }
  return null;
}

export function resolveWorkerActivityHeartbeatConfig(): WorkerActivityHeartbeatConfig {
  const enabled = (process.env.DEN_ACTIVITY_HEARTBEAT_ENABLED ?? "")
    .trim()
    .toLowerCase();
  const provider = (process.env.DEN_RUNTIME_PROVIDER ?? "").trim().toLowerCase();
  const workerId = (process.env.DEN_WORKER_ID ?? "").trim();
  const url = (process.env.DEN_ACTIVITY_HEARTBEAT_URL ?? "").trim();
  const token = (process.env.DEN_ACTIVITY_HEARTBEAT_TOKEN ?? "").trim();

  const featureEnabled =
    enabled === "1" || enabled === "true" || enabled === "yes";

  if (!featureEnabled || provider !== "daytona" || !workerId || !url || !token) {
    return {
      enabled: false,
      workerId: "",
      url: "",
      token: "",
      intervalMs: DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS,
      activeWindowMs: DEFAULT_ACTIVITY_WINDOW_MS,
    };
  }

  const intervalSeconds = parsePositiveNumberEnv(
    process.env.DEN_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS / 1000,
  );
  const activeWindowSeconds = parsePositiveNumberEnv(
    process.env.DEN_ACTIVITY_WINDOW_SECONDS,
    DEFAULT_ACTIVITY_WINDOW_MS / 1000,
  );

  return {
    enabled: true,
    workerId,
    url,
    token,
    intervalMs: Math.round(intervalSeconds * 1000),
    activeWindowMs: Math.round(activeWindowSeconds * 1000),
  };
}

export async function postWorkerActivityHeartbeat(input: {
  config: WorkerActivityHeartbeatConfig;
  opencodeClient: ReturnType<typeof createOpencodeClient>;
  logger: Logger;
}) {
  if (!input.config.enabled) return;

  const sessions = unwrap(await input.opencodeClient.session.list({ limit: 200 }));
  let latestActivityAt = 0;
  for (const session of sessions) {
    const ts = parseSessionActivityAt(session);
    if (ts && ts > latestActivityAt) {
      latestActivityAt = ts;
    }
  }

  const now = Date.now();
  const isActiveRecently =
    latestActivityAt > 0 && now - latestActivityAt <= input.config.activeWindowMs;

  const payload = {
    sentAt: new Date(now).toISOString(),
    isActiveRecently,
    lastActivityAt:
      latestActivityAt > 0 ? new Date(latestActivityAt).toISOString() : null,
    openSessionCount: sessions.length,
  };

  const response = await fetch(input.config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`heartbeat_failed:${response.status}`);
  }

  input.logger.debug(
    "Worker activity heartbeat sent",
    {
      workerId: input.config.workerId,
      isActiveRecently,
      lastActivityAt: payload.lastActivityAt,
      openSessionCount: payload.openSessionCount,
    },
    "onmyagent-orchestrator",
  );
}
