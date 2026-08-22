import { dirname, join } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  agentRuntimeKindSchema,
  agentRuntimeSelectionConfigSchema,
  grokBuildRuntimeSelectionSchema,
  type AgentRuntimeKind,
  type AgentRuntimeSelectionConfig,
  type GrokBuildRuntimeSelection,
} from "@onmyagent/types/agent-runtime";
import { ApiError } from "../core/errors.js";
import { shortId } from "../core/utils.js";
import { resolveRuntimeDataRoot } from "./runtime-data-root.js";

const AGENT_RUNTIME_SELECTION_VERSION = 1;

export type AgentRuntimeSelectionReadState =
  | "ok"
  | "missing"
  | "corrupt"
  | "unknown_version";

export type AgentRuntimeSelectionReadResult = {
  state: AgentRuntimeSelectionReadState;
  complete: boolean;
  config: AgentRuntimeSelectionConfig | null;
  sourceVersion?: number;
};

export type ResolvedAgentRuntimeSelection = {
  runtimeKind: AgentRuntimeKind;
  source: "global-default" | "workspace-override";
  revision: number;
};

type InternalReadResult = AgentRuntimeSelectionReadResult;

const pathLocks = new Map<string, Promise<void>>();

export function defaultAgentRuntimeSelectionConfig(): AgentRuntimeSelectionConfig {
  return {
    version: AGENT_RUNTIME_SELECTION_VERSION,
    revision: 0,
    defaultRuntimeKind: "opencode",
    workspaceOverrides: {},
  };
}

export function resolveAgentRuntimeSelectionPath(dataRoot?: string): string {
  const root = resolveRuntimeDataRoot(dataRoot);
  return join(
    root,
    "runtime-state",
    "primary-runtime",
    "runtime-selection.json",
  );
}

export class AgentRuntimeSelectionStore {
  readonly #path: string;

  constructor(input: { dataRoot?: string } = {}) {
    this.#path = resolveAgentRuntimeSelectionPath(input.dataRoot);
  }

  async read(): Promise<AgentRuntimeSelectionReadResult> {
    return withPathLock(this.#path, () => this.#read());
  }

  async resolve(workspaceId: string): Promise<ResolvedAgentRuntimeSelection> {
    const resolvedWorkspaceId = requireId(workspaceId, "workspaceId");
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      const config = assertReadable(file);
      const workspaceRuntime = config.workspaceOverrides[resolvedWorkspaceId];
      return workspaceRuntime
        ? {
            runtimeKind: workspaceRuntime,
            source: "workspace-override",
            revision: config.revision,
          }
        : {
            runtimeKind: config.defaultRuntimeKind,
            source: "global-default",
            revision: config.revision,
          };
    });
  }

  async setDefaultRuntimeKind(
    runtimeKind: AgentRuntimeKind,
    options: { expectedRevision?: number } = {},
  ): Promise<AgentRuntimeSelectionConfig> {
    const parsed = agentRuntimeKindSchema.parse(runtimeKind);
    return this.#mutate(options.expectedRevision, (config) => ({
      ...config,
      defaultRuntimeKind: parsed,
    }));
  }

  async setWorkspaceOverride(
    workspaceId: string,
    runtimeKind: AgentRuntimeKind | null,
    options: { expectedRevision?: number } = {},
  ): Promise<AgentRuntimeSelectionConfig> {
    const resolvedWorkspaceId = requireId(workspaceId, "workspaceId");
    const parsed = runtimeKind === null ? null : agentRuntimeKindSchema.parse(runtimeKind);
    return this.#mutate(options.expectedRevision, (config) => {
      const workspaceOverrides = { ...config.workspaceOverrides };
      if (parsed === null) delete workspaceOverrides[resolvedWorkspaceId];
      else workspaceOverrides[resolvedWorkspaceId] = parsed;
      return { ...config, workspaceOverrides };
    });
  }

  async setGrokBuildSelection(
    selection: GrokBuildRuntimeSelection | null,
    options: { expectedRevision?: number } = {},
  ): Promise<AgentRuntimeSelectionConfig> {
    const parsed = selection === null
      ? null
      : grokBuildRuntimeSelectionSchema.parse(selection);
    return this.#mutate(options.expectedRevision, (config) => {
      if (parsed === null) {
        const { grokBuild: _removed, ...withoutGrokBuild } = config;
        return withoutGrokBuild;
      }
      return { ...config, grokBuild: parsed };
    });
  }

  async #mutate(
    expectedRevision: number | undefined,
    apply: (config: AgentRuntimeSelectionConfig) => AgentRuntimeSelectionConfig,
  ): Promise<AgentRuntimeSelectionConfig> {
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      const current = assertWritable(file);
      assertExpectedRevision(current.revision, expectedRevision);
      const candidate = agentRuntimeSelectionConfigSchema.parse(apply(current));
      if (sameConfig(candidate, current)) return current;
      const next = agentRuntimeSelectionConfigSchema.parse({
        ...candidate,
        revision: nextRevision(current.revision),
      });
      await this.#write(next);
      return next;
    });
  }

  async #read(): Promise<InternalReadResult> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (!isRecord(parsed)) return corruptReadResult();
      const version = parsed.version;
      if (typeof version !== "number" || !Number.isSafeInteger(version)) {
        return corruptReadResult();
      }
      if (version !== AGENT_RUNTIME_SELECTION_VERSION) {
        return {
          state: "unknown_version",
          complete: false,
          config: null,
          sourceVersion: version,
        };
      }
      const result = agentRuntimeSelectionConfigSchema.safeParse(parsed);
      return result.success
        ? { state: "ok", complete: true, config: result.data }
        : corruptReadResult();
    } catch (error) {
      if (isMissingFileError(error)) {
        return {
          state: "missing",
          complete: true,
          config: defaultAgentRuntimeSelectionConfig(),
        };
      }
      return corruptReadResult();
    }
  }

  async #write(config: AgentRuntimeSelectionConfig): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp.${shortId()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.#path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function assertReadable(file: InternalReadResult): AgentRuntimeSelectionConfig {
  if (file.complete && file.config) return file.config;
  throw unavailableError(file.state, "read");
}

function assertWritable(file: InternalReadResult): AgentRuntimeSelectionConfig {
  if (file.complete && file.config) return file.config;
  throw unavailableError(file.state, "update");
}

function unavailableError(
  state: AgentRuntimeSelectionReadState,
  operation: "read" | "update",
): ApiError {
  return new ApiError(
    409,
    "agent_runtime_selection_unavailable",
    state === "unknown_version"
      ? `Agent runtime selection uses an unsupported version and cannot be safely ${operation === "read" ? "read" : "updated"}`
      : `Agent runtime selection is corrupt and cannot be safely ${operation === "read" ? "read" : "updated"}`,
  );
}

function assertExpectedRevision(
  revision: number,
  expectedRevision: number | undefined,
): void {
  if (expectedRevision === undefined) return;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(
      400,
      "agent_runtime_selection_revision_invalid",
      "expectedRevision must be a non-negative integer",
    );
  }
  if (expectedRevision !== revision) {
    throw new ApiError(
      409,
      "agent_runtime_selection_revision_conflict",
      "Agent runtime selection revision is stale",
    );
  }
}

function nextRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new ApiError(
      409,
      "agent_runtime_selection_revision_invalid",
      "Agent runtime selection revision cannot advance",
    );
  }
  return revision + 1;
}

function requireId(value: string, label: string): string {
  const resolved = value.trim();
  if (!resolved) throw new ApiError(400, "invalid_payload", `${label} is required`);
  return resolved;
}

function sameConfig(
  left: AgentRuntimeSelectionConfig,
  right: AgentRuntimeSelectionConfig,
): boolean {
  return sameValue(left, right);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function corruptReadResult(): InternalReadResult {
  return { state: "corrupt", complete: false, config: null };
}

async function withPathLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = pathLocks.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const settled = run.then(() => undefined, () => undefined);
  pathLocks.set(path, settled);
  try {
    return await run;
  } finally {
    if (pathLocks.get(path) === settled) pathLocks.delete(path);
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "ENOENT",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
