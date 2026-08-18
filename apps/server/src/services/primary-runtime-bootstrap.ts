import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import {
  backfillWorkspaceOpencodeSessionBindings,
  type OpencodeSessionBindingBackfillResult,
} from "./opencode-session-binding-backfill.js";
import {
  acquirePrimaryRuntimeRootOwnership,
  ensurePrimaryOpencodeHostIdentity,
  parsePrimaryOpencodeHostIdentity,
  type PrimaryOpencodeHostIdentity,
  type PrimaryRuntimeRootOwnership,
} from "./primary-runtime-host-state.js";

export const PRIMARY_OPENCODE_PROFILE_ID_ENV =
  "ONMYAGENT_PRIMARY_OPENCODE_PROFILE_ID";
export const PRIMARY_OPENCODE_RUNTIME_HOME_ENV =
  "ONMYAGENT_PRIMARY_OPENCODE_RUNTIME_HOME";
export const PRIMARY_OPENCODE_SANDBOX_PROFILE_ENV =
  "ONMYAGENT_PRIMARY_OPENCODE_SANDBOX_PROFILE";
export const PRIMARY_RUNTIME_DATA_ROOT_ENV =
  "ONMYAGENT_PRIMARY_RUNTIME_DATA_ROOT";

type HostEnvironment = Readonly<Record<string, string | undefined>>;

export type PrimaryRuntimeBackfillReport = {
  level: "info" | "warn";
  code:
    | "primary_runtime_binding_backfill_completed"
    | "primary_runtime_binding_backfill_incomplete"
    | "primary_runtime_binding_backfill_skipped"
    | "primary_runtime_binding_backfill_aborted";
  counts: {
    workspacesTotal: number;
    workspacesProcessed: number;
    workspacesIncomplete: number;
    bindingsAdded: number;
    failures: number;
  };
  reasonCounts: Readonly<Record<string, number>>;
};

export type PrimaryRuntimeBootstrapHandle = {
  start: () => void;
  cancelBackfill: () => Promise<void>;
  release: () => Promise<void>;
};

export async function stopPrimaryRuntimeHostLifecycle(input: {
  bootstrap: PrimaryRuntimeBootstrapHandle;
  stopServerOwners: () => Promise<void>;
  stopManagedRuntime: () => void | Promise<void>;
}): Promise<void> {
  let shutdownError: unknown;
  for (const stop of [
    () => input.bootstrap.cancelBackfill(),
    input.stopServerOwners,
    input.stopManagedRuntime,
  ]) {
    try {
      await stop();
    } catch (error) {
      shutdownError ??= error;
    }
  }
  // Keep the exclusive writer lock fail-closed if any owner did not confirm
  // shutdown. Process exit will release the SQLite transaction automatically.
  if (shutdownError !== undefined) throw shutdownError;
  await input.bootstrap.release();
}

type BackfillWorkspace = (input: {
  config: ServerConfig;
  workspace: WorkspaceInfo;
  dataRoot?: string;
  identity?: PrimaryOpencodeHostIdentity;
  signal: AbortSignal;
}) => Promise<OpencodeSessionBindingBackfillResult>;

/** Parse the private process boundary without exposing it through ServerConfig. */
export async function readPrimaryOpencodeRuntimeIdentity(
  env: HostEnvironment = process.env,
): Promise<PrimaryOpencodeHostIdentity | null> {
  const profileIdRaw = env[PRIMARY_OPENCODE_PROFILE_ID_ENV];
  const runtimeHomeRaw = env[PRIMARY_OPENCODE_RUNTIME_HOME_ENV];
  const sandboxProfileRaw = env[PRIMARY_OPENCODE_SANDBOX_PROFILE_ENV];
  if (
    profileIdRaw === undefined &&
    runtimeHomeRaw === undefined &&
    sandboxProfileRaw === undefined
  ) {
    return null;
  }
  const profileId = profileIdRaw?.trim();
  const runtimeHome = runtimeHomeRaw?.trim();
  const sandboxProfile = sandboxProfileRaw?.trim();
  if (
    !profileId ||
    !runtimeHome ||
    (sandboxProfileRaw !== undefined && !sandboxProfile)
  ) {
    throw invalidHostPolicyError();
  }
  return parsePrimaryOpencodeHostIdentity({
    profileId,
    runtimeHome,
    ...(sandboxProfile ? { sandboxProfile } : {}),
  });
}

export function readPrimaryRuntimeDataRoot(
  env: HostEnvironment = process.env,
): string | undefined {
  const raw = env[PRIMARY_RUNTIME_DATA_ROOT_ENV];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!value) throw invalidHostPolicyError();
  return value;
}

/**
 * Persist host identity during boot, then expose a background migration that
 * callers start only after the HTTP server is listening.
 */
export async function preparePrimaryRuntimeBootstrap(input: {
  config: ServerConfig;
  dataRoot?: string;
  opencodeRuntimeIdentity?: PrimaryOpencodeHostIdentity;
  env?: HostEnvironment;
  delayMs?: number;
  onReport: (report: PrimaryRuntimeBackfillReport) => void;
  persistIdentity?: (identity: PrimaryOpencodeHostIdentity) => Promise<unknown>;
  acquireOwnership?: (input: {
    dataRoot?: string;
    workspaces: readonly Pick<WorkspaceInfo, "path">[];
  }) => Promise<PrimaryRuntimeRootOwnership>;
  backfillWorkspace?: BackfillWorkspace;
}): Promise<PrimaryRuntimeBootstrapHandle> {
  let dataRoot = input.dataRoot?.trim() || readPrimaryRuntimeDataRoot(input.env);
  const identity = input.opencodeRuntimeIdentity === undefined
    ? await readPrimaryOpencodeRuntimeIdentity(input.env)
    : await parseExplicitIdentity(input.opencodeRuntimeIdentity);
  let ownership: PrimaryRuntimeRootOwnership | null = null;
  try {
    if (!input.config.readOnly) {
      const acquire = input.acquireOwnership ?? acquirePrimaryRuntimeRootOwnership;
      ownership = await acquire({ dataRoot, workspaces: input.config.workspaces });
      dataRoot = ownership.dataRoot;
    }
    if (identity && !input.config.readOnly) {
      const persist = input.persistIdentity ?? ((value) =>
        ensurePrimaryOpencodeHostIdentity({ dataRoot, identity: value }));
      await persist(identity);
    }
  } catch (error) {
    await ownership?.release().catch(() => undefined);
    throw error;
  }

  const controller = new AbortController();
  const backfill = input.backfillWorkspace
    ?? backfillWorkspaceOpencodeSessionBindings;
  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  return {
    start() {
      if (started || stopped) return;
      started = true;
      timer = setTimeout(() => {
        timer = null;
        if (stopped) return;
        const task = runBackfill({
          config: input.config,
          dataRoot,
          identity,
          signal: controller.signal,
          backfill,
          onReport: input.onReport,
        });
        running = task;
        void task.finally(() => {
          if (running === task) running = null;
        });
      }, input.delayMs ?? 0);
    },
    async cancelBackfill() {
      if (stopped) return;
      stopped = true;
      controller.abort();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await running;
    },
    async release() {
      if (!stopped) {
        throw new ApiError(
          409,
          "primary_runtime_bootstrap_still_active",
          "Primary runtime backfill must stop before ownership is released",
        );
      }
      await ownership?.release();
    },
  };
}

async function runBackfill(input: {
  config: ServerConfig;
  dataRoot?: string;
  identity: PrimaryOpencodeHostIdentity | null;
  signal: AbortSignal;
  backfill: BackfillWorkspace;
  onReport: (report: PrimaryRuntimeBackfillReport) => void;
}): Promise<void> {
  const counts = {
    workspacesTotal: input.config.workspaces.length,
    workspacesProcessed: 0,
    workspacesIncomplete: 0,
    bindingsAdded: 0,
    failures: 0,
  };
  const reasonCounts: Record<string, number> = {};
  if (!input.identity) {
    counts.workspacesIncomplete = counts.workspacesTotal;
    increment(reasonCounts, "runtime_identity_unavailable");
    report(input.onReport, {
      level: "warn",
      code: "primary_runtime_binding_backfill_skipped",
      counts,
      reasonCounts,
    });
    return;
  }
  if (input.config.readOnly) {
    counts.workspacesIncomplete = counts.workspacesTotal;
    increment(reasonCounts, "server_read_only");
    report(input.onReport, {
      level: "warn",
      code: "primary_runtime_binding_backfill_skipped",
      counts,
      reasonCounts,
    });
    return;
  }

  for (const workspace of input.config.workspaces) {
    if (input.signal.aborted) {
      reportAborted(input.onReport, counts, reasonCounts);
      return;
    }
    try {
      const result = await input.backfill({
        config: input.config,
        workspace,
        dataRoot: input.dataRoot,
        identity: input.identity,
        signal: input.signal,
      });
      counts.workspacesProcessed += 1;
      counts.bindingsAdded += result.added;
      counts.failures += result.failures.length;
      if (!result.complete) counts.workspacesIncomplete += 1;
      if (result.skipped) increment(reasonCounts, result.skipped);
      for (const failure of result.failures) {
        increment(reasonCounts, failure.code);
      }
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) {
        reportAborted(input.onReport, counts, reasonCounts);
        return;
      }
      counts.workspacesProcessed += 1;
      counts.workspacesIncomplete += 1;
      counts.failures += 1;
      increment(reasonCounts, "workspace_backfill_failed");
    }
  }

  report(input.onReport, {
    level: counts.workspacesIncomplete > 0 ? "warn" : "info",
    code: counts.workspacesIncomplete > 0
      ? "primary_runtime_binding_backfill_incomplete"
      : "primary_runtime_binding_backfill_completed",
    counts,
    reasonCounts,
  });
}

function reportAborted(
  onReport: (report: PrimaryRuntimeBackfillReport) => void,
  counts: PrimaryRuntimeBackfillReport["counts"],
  reasonCounts: Record<string, number>,
): void {
  increment(reasonCounts, "shutdown_abort");
  report(onReport, {
    level: "info",
    code: "primary_runtime_binding_backfill_aborted",
    counts,
    reasonCounts,
  });
}

function report(
  onReport: (report: PrimaryRuntimeBackfillReport) => void,
  value: PrimaryRuntimeBackfillReport,
): void {
  try {
    onReport(value);
  } catch {
    // Logging/reporting must never prevent a clean shutdown.
  }
}

function increment(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function invalidHostPolicyError(): ApiError {
  return new ApiError(
    500,
    "primary_runtime_host_policy_invalid",
    "Primary OpenCode host policy is incomplete or invalid",
  );
}

async function parseExplicitIdentity(value: PrimaryOpencodeHostIdentity) {
  return parsePrimaryOpencodeHostIdentity(value);
}
