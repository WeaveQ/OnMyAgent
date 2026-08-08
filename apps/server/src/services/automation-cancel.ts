/**
 * Cancel an in-progress automation run lease without disabling the schedule.
 *
 * Generation contract:
 * 1. Optional leaseId must match the active holder (else 409).
 * 2. Abort OpenCode session first when a session is bound.
 * 3. Only then clear the lease via recordAutomationRun(leaseId).
 * 4. If abort fails (non-benign), keep the lease so the user can retry stop.
 */
import type {
  AutomationRunLease,
  AutomationTaskItem,
  ServerConfig,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { ApiError, isApiError } from "../core/errors.js";
import { listAutomations, recordAutomationRun } from "./automations.js";
import { defaultOpencodeClientPool } from "./opencode-client-pool.js";
import { ensureOpencodeRequestSucceeded } from "./opencode-proxy.js";

export type CancelAutomationRunOptions = {
  now?: number;
  /** When set, must match the active lease or cancel is rejected. */
  leaseId?: string;
  /**
   * Abort the bound OpenCode session. Injected in tests; production uses
   * {@link abortAutomationOpencodeSession} when config+workspace are set.
   */
  abortSession?: (running: AutomationRunLease) => Promise<void>;
  config?: ServerConfig;
  workspace?: WorkspaceInfo;
};

export async function cancelAutomationRun(
  workspaceRoot: string,
  id: string,
  options: CancelAutomationRunOptions = {},
): Promise<AutomationTaskItem> {
  const now = options.now ?? Date.now();
  const items = await listAutomations(workspaceRoot);
  const current = items.find((item) => item.id === id);
  if (!current) {
    throw new ApiError(404, "automation_not_found", "Automation task not found");
  }
  if (!current.running) {
    throw new ApiError(409, "automation_not_running", "Automation task is not running");
  }
  const running = current.running;
  const expectedLease = options.leaseId?.trim();
  if (expectedLease && running.leaseId !== expectedLease) {
    throw new ApiError(
      409,
      "automation_lease_mismatch",
      "Automation run lease does not match the active generation",
    );
  }

  if (running.sessionId?.trim()) {
    const abort = resolveAbortSession(options);
    try {
      await abort(running);
    } catch (error) {
      if (!isBenignAutomationAbortError(error)) {
        throw new ApiError(
          502,
          "automation_stop_failed",
          error instanceof Error
            ? error.message
            : "Failed to stop the automation session; retry stop",
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }
    }
  }

  const item = await recordAutomationRun(
    workspaceRoot,
    id,
    {
      status: "skipped",
      source: "manual",
      ranAt: now,
      error: "Cancelled by user",
      sessionId: running.sessionId,
      groupName: running.groupName,
      outputDirectory: running.outputDirectory,
    },
    running.leaseId,
  );
  if (!item || item.running) {
    // Lease changed under us (new generation claimed) or late write ignored.
    throw new ApiError(
      409,
      "automation_not_running",
      "Automation task is not running",
    );
  }
  return item;
}

function resolveAbortSession(
  options: CancelAutomationRunOptions,
): (running: AutomationRunLease) => Promise<void> {
  if (options.abortSession) return options.abortSession;
  const { config, workspace } = options;
  if (config && workspace) {
    return (lease) => abortAutomationOpencodeSession(config, workspace, lease);
  }
  throw new ApiError(
    500,
    "automation_cancel_misconfigured",
    "Cancel requires OpenCode abort wiring (config + workspace) when a session is bound",
  );
}

/** Abort the OpenCode turn for an automation lease (best-effort). */
export async function abortAutomationOpencodeSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  running: Pick<AutomationRunLease, "sessionId" | "outputDirectory">,
): Promise<void> {
  const sessionId = running.sessionId?.trim();
  if (!sessionId) return;
  const directory =
    running.outputDirectory?.trim() ||
    workspace.directory?.trim() ||
    workspace.path;
  const opencode = defaultOpencodeClientPool.get(config, workspace, directory);
  ensureOpencodeRequestSucceeded(
    await opencode.session.abort({ sessionID: sessionId }),
    `/session/${encodeURIComponent(sessionId)}/abort`,
  );
}

/**
 * Abort failures that mean "already stopped / gone" — safe to clear the lease.
 * Kept narrow so real transport failures still surface as stop_failed.
 */
export function isBenignAutomationAbortError(error: unknown): boolean {
  if (isApiError(error)) {
    const status =
      error.details &&
      typeof error.details === "object" &&
      "status" in error.details
        ? Number((error.details as { status?: unknown }).status)
        : undefined;
    if (status === 404 || status === 410) return true;
    if (/not_found|session_not_found/i.test(error.code)) return true;
    if (isBenignAbortMessage(error.message)) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return isBenignAbortMessage(message);
}

function isBenignAbortMessage(message: string): boolean {
  return (
    /not found|404|410|session_not_found/i.test(message) ||
    /already\s+(stopped|idle|aborted|completed)/i.test(message) ||
    /missing session/i.test(message)
  );
}
