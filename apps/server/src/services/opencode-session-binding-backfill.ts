import { resolve } from "node:path";
import type {
  ServerConfig,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import {
  readPrimaryOpencodeHostIdentity,
  type PrimaryOpencodeHostIdentity,
} from "./primary-runtime-host-state.js";
import {
  RuntimeSessionBindingStore,
  type RuntimeSessionBindingBackfillFailure,
} from "./runtime-session-bindings.js";
import type { SessionInfoReadModel } from "./session-read-model.js";
import { listWorkspaceSessions } from "./workspace-sessions.js";

export const OPENCODE_SESSION_BACKFILL_MAX = 400;

export type OpencodeSessionBindingBackfillResult = {
  complete: boolean;
  added: number;
  failures: RuntimeSessionBindingBackfillFailure[];
  skipped:
    | null
    | "runtime_identity_unavailable"
    | "session_inventory_incomplete";
};

/**
 * Backfill legacy OpenCode sessions only when both the host-provided runtime
 * identity and the full native workspace inventory are authoritative.
 */
export async function backfillWorkspaceOpencodeSessionBindings(input: {
  config: ServerConfig;
  workspace: WorkspaceInfo;
  signal?: AbortSignal;
  dataRoot?: string;
  identity?: PrimaryOpencodeHostIdentity;
  readInventory?: () => Promise<unknown[]>;
}): Promise<OpencodeSessionBindingBackfillResult> {
  const identity = input.identity
    ?? await readPrimaryOpencodeHostIdentity({ dataRoot: input.dataRoot });
  if (!identity) {
    return incompleteBackfill("runtime_identity_unavailable");
  }
  const inventory = input.readInventory
    ? await input.readInventory()
    : await listWorkspaceSessions(input.config, input.workspace, {
        scope: "directory",
        directory: input.workspace.directory?.trim() || input.workspace.path,
        roots: false,
        start: 0,
        limit: OPENCODE_SESSION_BACKFILL_MAX + 1,
        signal: input.signal,
      });
  if (!Array.isArray(inventory) || inventory.length > OPENCODE_SESSION_BACKFILL_MAX) {
    return incompleteBackfill("session_inventory_incomplete");
  }
  const workspaceDirectory = input.workspace.directory?.trim() || input.workspace.path;
  const candidates = inventory.flatMap((value) =>
    verifiedInventoryItem(value, identity, workspaceDirectory)
  );
  if (candidates.length !== inventory.length) {
    return incompleteBackfill("session_inventory_incomplete");
  }
  const result = await new RuntimeSessionBindingStore({
    workspace: input.workspace,
    dataRoot: input.dataRoot,
  }).backfillVerifiedOpenCodeInventory(candidates);
  return {
    complete: result.complete,
    added: result.added,
    failures: result.failures,
    skipped: null,
  };
}

function verifiedInventoryItem(
  value: unknown,
  identity: PrimaryOpencodeHostIdentity,
  workspaceDirectory: string,
) {
  const session = value as Partial<SessionInfoReadModel>;
  const id = typeof session.id === "string" ? session.id.trim() : "";
  const cwd = typeof session.directory === "string"
    ? session.directory.trim()
    : "";
  const createdAt = session.time?.created;
  if (
    !id ||
    !cwd ||
    canonicalDirectory(cwd) !== canonicalDirectory(workspaceDirectory) ||
    typeof createdAt !== "number" ||
    !Number.isFinite(createdAt)
  ) {
    return [];
  }
  return [{
    productSessionId: id,
    runtimeSessionId: id,
    cwd,
    profileId: identity.profileId,
    runtimeHome: identity.runtimeHome,
    ...(identity.sandboxProfile
      ? { sandboxProfile: identity.sandboxProfile }
      : {}),
    createdAt,
  }];
}

function canonicalDirectory(value: string): string {
  const path = resolve(value.trim()).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function incompleteBackfill(
  skipped: Exclude<OpencodeSessionBindingBackfillResult["skipped"], null>,
): OpencodeSessionBindingBackfillResult {
  return { complete: false, added: 0, failures: [], skipped };
}
