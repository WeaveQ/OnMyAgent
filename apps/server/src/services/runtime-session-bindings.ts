import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  runtimeSessionBindingSchema,
  type RuntimeSessionBinding,
} from "@onmyagent/types/agent-runtime";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { shortId } from "../core/utils.js";
import { resolveRuntimeDataRoot } from "./runtime-data-root.js";
import {
  hasDuplicateRuntimeSessionIdentity,
  planVerifiedOpenCodeInventoryBackfill,
  runtimeSessionNativeIdentity,
  sameRuntimeSessionBinding,
  type RuntimeSessionBindingBackfillResult,
  type VerifiedOpenCodeSessionInventoryItem,
} from "./runtime-session-binding-records.js";

export type {
  RuntimeSessionBindingBackfillFailure,
  RuntimeSessionBindingBackfillResult,
  VerifiedOpenCodeSessionInventoryItem,
} from "./runtime-session-binding-records.js";

const RUNTIME_SESSION_BINDING_STORE_VERSION = 1;

export type RuntimeSessionBindingReadState =
  | "ok"
  | "missing"
  | "corrupt"
  | "unknown_version";

export type RuntimeSessionBindingListResult = {
  version: typeof RUNTIME_SESSION_BINDING_STORE_VERSION;
  revision: number;
  bindings: RuntimeSessionBinding[];
  complete: boolean;
  state: RuntimeSessionBindingReadState;
  sourceVersion?: number;
};

type RuntimeSessionBindingStoreFile = {
  version: typeof RUNTIME_SESSION_BINDING_STORE_VERSION;
  revision: number;
  bindings: RuntimeSessionBinding[];
};

type RuntimeSessionBindingReadResult = RuntimeSessionBindingStoreFile & {
  state: RuntimeSessionBindingReadState;
  complete: boolean;
  sourceVersion?: number;
};

const pathLocks = new Map<string, Promise<void>>();

export function resolveRuntimeSessionBindingStorePath(input: {
  workspace: Pick<WorkspaceInfo, "id" | "path">;
  dataRoot?: string;
}): string {
  const dataRoot = resolveRuntimeDataRoot(input.dataRoot);
  const workspaceKey = createHash("sha256")
    .update(input.workspace.id)
    .digest("hex")
    .slice(0, 24);
  const path = join(
    dataRoot,
    "runtime-state",
    "primary-runtime",
    "workspaces",
    workspaceKey,
    "session-bindings.json",
  );
  assertStoreOutsideWorkspace(path, input.workspace.path);
  return path;
}

export class RuntimeSessionBindingStore {
  readonly #path: string;
  readonly #workspaceId: string;

  constructor(input: {
    workspace: Pick<WorkspaceInfo, "id" | "path">;
    dataRoot?: string;
  }) {
    this.#workspaceId = input.workspace.id;
    this.#path = resolveRuntimeSessionBindingStorePath(input);
  }

  async list(): Promise<RuntimeSessionBindingListResult> {
    return withPathLock(this.#path, async () => publicReadResult(await this.#read()));
  }

  async get(productSessionId: string): Promise<RuntimeSessionBinding | null> {
    const sessionId = requireSessionId(productSessionId);
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      if (file.state === "missing") return null;
      assertReadable(file);
      return file.bindings.find((binding) => binding.productSessionId === sessionId) ?? null;
    });
  }

  async upsert(
    binding: RuntimeSessionBinding,
    options: { expectedRevision?: number } = {},
  ): Promise<RuntimeSessionBinding> {
    const parsed = runtimeSessionBindingSchema.parse(binding);
    assertWorkspaceBinding(parsed, this.#workspaceId);
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      assertWritable(file);
      assertExpectedRevision(file.revision, options.expectedRevision);
      const existing = file.bindings.find(
        (entry) => entry.productSessionId === parsed.productSessionId,
      );
      if (existing) {
        if (sameRuntimeSessionBinding(existing, parsed)) return existing;
        throw new ApiError(
          409,
          "runtime_session_binding_immutable",
          "Runtime session binding cannot be changed after creation",
        );
      }
      assertNativeSessionIdentityAvailable(file.bindings, parsed);
      await this.#write({
        version: RUNTIME_SESSION_BINDING_STORE_VERSION,
        revision: nextRevision(file.revision),
        bindings: [...file.bindings, parsed],
      });
      return parsed;
    });
  }

  async delete(
    productSessionId: string,
    options: { expectedRevision?: number } = {},
  ): Promise<boolean> {
    const sessionId = requireSessionId(productSessionId);
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      assertWritable(file);
      assertExpectedRevision(file.revision, options.expectedRevision);
      const bindings = file.bindings.filter(
        (binding) => binding.productSessionId !== sessionId,
      );
      if (bindings.length === file.bindings.length) return false;
      await this.#write({
        version: RUNTIME_SESSION_BINDING_STORE_VERSION,
        revision: nextRevision(file.revision),
        bindings,
      });
      return true;
    });
  }

  async updateModelRef(
    productSessionId: string,
    modelRef: RuntimeSessionBinding["modelRef"],
    options: { expectedRevision?: number } = {},
  ): Promise<RuntimeSessionBinding> {
    const sessionId = requireSessionId(productSessionId);
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      assertWritable(file);
      assertExpectedRevision(file.revision, options.expectedRevision);
      const index = file.bindings.findIndex(
        (binding) => binding.productSessionId === sessionId,
      );
      if (index < 0) {
        throw new ApiError(404, "runtime_session_binding_not_found", "Runtime session binding not found");
      }
      const current = file.bindings[index]!;
      const next = runtimeSessionBindingSchema.parse({
        ...current,
        ...(modelRef ? { modelRef } : {}),
      });
      if (!modelRef) delete next.modelRef;
      if (sameRuntimeSessionBinding(current, next)) return current;
      const bindings = [...file.bindings];
      bindings[index] = next;
      await this.#write({
        version: RUNTIME_SESSION_BINDING_STORE_VERSION,
        revision: nextRevision(file.revision),
        bindings,
      });
      return next;
    });
  }

  async updateMode(
    productSessionId: string,
    mode: string | undefined,
    options: { expectedRevision?: number } = {},
  ): Promise<RuntimeSessionBinding> {
    const sessionId = requireSessionId(productSessionId);
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      assertWritable(file);
      assertExpectedRevision(file.revision, options.expectedRevision);
      const index = file.bindings.findIndex(
        (binding) => binding.productSessionId === sessionId,
      );
      if (index < 0) {
        throw new ApiError(404, "runtime_session_binding_not_found", "Runtime session binding not found");
      }
      const current = file.bindings[index]!;
      const next = runtimeSessionBindingSchema.parse({
        ...current,
        ...(mode?.trim() ? { mode: mode.trim() } : {}),
      });
      if (!mode?.trim()) delete next.mode;
      if (sameRuntimeSessionBinding(current, next)) return current;
      const bindings = [...file.bindings];
      bindings[index] = next;
      await this.#write({
        version: RUNTIME_SESSION_BINDING_STORE_VERSION,
        revision: nextRevision(file.revision),
        bindings,
      });
      return next;
    });
  }

  async backfillVerifiedOpenCodeInventory(
    inventory: readonly VerifiedOpenCodeSessionInventoryItem[],
    options: { expectedRevision?: number } = {},
  ): Promise<RuntimeSessionBindingBackfillResult> {
    return withPathLock(this.#path, async () => {
      const file = await this.#read();
      assertWritable(file);
      assertExpectedRevision(file.revision, options.expectedRevision);
      const result = planVerifiedOpenCodeInventoryBackfill({
        existing: file.bindings,
        inventory,
        workspaceId: this.#workspaceId,
      });

      if (result.bindings.length > 0) {
        await this.#write({
          version: RUNTIME_SESSION_BINDING_STORE_VERSION,
          revision: nextRevision(file.revision),
          bindings: [...file.bindings, ...result.bindings],
        });
      }
      return result;
    });
  }

  async #read(): Promise<RuntimeSessionBindingReadResult> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      return parseStoreFile(parsed, this.#workspaceId);
    } catch (error) {
      if (isMissingFileError(error)) return emptyReadResult("missing");
      return emptyReadResult("corrupt");
    }
  }

  async #write(file: RuntimeSessionBindingStoreFile): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp.${shortId()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.#path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function publicReadResult(file: RuntimeSessionBindingReadResult): RuntimeSessionBindingListResult {
  return {
    version: RUNTIME_SESSION_BINDING_STORE_VERSION,
    revision: file.revision,
    bindings: file.complete ? file.bindings : [],
    complete: file.complete,
    state: file.state,
    ...(file.sourceVersion !== undefined ? { sourceVersion: file.sourceVersion } : {}),
  };
}

function parseStoreFile(
  value: unknown,
  workspaceId: string,
): RuntimeSessionBindingReadResult {
  if (!isRecord(value)) return emptyReadResult("corrupt");
  const version = value.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version)) {
    return emptyReadResult("corrupt");
  }
  if (version !== RUNTIME_SESSION_BINDING_STORE_VERSION) {
    return {
      ...emptyReadResult("unknown_version"),
      sourceVersion: version,
    };
  }
  if (
    Object.keys(value).some((key) => !["version", "revision", "bindings"].includes(key)) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.bindings)
  ) return emptyReadResult("corrupt");

  const bindings: RuntimeSessionBinding[] = [];
  for (const candidate of value.bindings) {
    const parsed = runtimeSessionBindingSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.workspaceId !== workspaceId) {
      return emptyReadResult("corrupt");
    }
    bindings.push(parsed.data);
  }
  if (hasDuplicateRuntimeSessionIdentity(bindings)) return emptyReadResult("corrupt");
  return {
    version: RUNTIME_SESSION_BINDING_STORE_VERSION,
    revision: value.revision,
    bindings,
    complete: true,
    state: "ok",
  };
}

function emptyReadResult(state: Exclude<RuntimeSessionBindingReadState, "ok">): RuntimeSessionBindingReadResult {
  return {
    version: RUNTIME_SESSION_BINDING_STORE_VERSION,
    revision: 0,
    bindings: [],
    complete: false,
    state,
  };
}

function assertWritable(file: RuntimeSessionBindingReadResult): void {
  if (file.state === "missing") return;
  if (!file.complete) {
    throw new ApiError(
      409,
      "runtime_session_bindings_unavailable",
      file.state === "unknown_version"
        ? "Runtime session bindings use an unsupported version"
        : "Runtime session bindings are corrupt and cannot be safely updated",
    );
  }
}

function assertReadable(file: RuntimeSessionBindingReadResult): void {
  if (!file.complete) {
    throw new ApiError(
      409,
      "runtime_session_bindings_unavailable",
      file.state === "unknown_version"
        ? "Runtime session bindings use an unsupported version"
        : "Runtime session bindings are corrupt and cannot be safely read",
    );
  }
}

function assertExpectedRevision(revision: number, expectedRevision: number | undefined): void {
  if (expectedRevision === undefined) return;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(
      400,
      "runtime_session_bindings_revision_invalid",
      "expectedRevision must be a non-negative integer",
    );
  }
  if (expectedRevision !== revision) {
    throw new ApiError(
      409,
      "runtime_session_bindings_revision_conflict",
      "Runtime session binding revision is stale",
    );
  }
}

function assertWorkspaceBinding(binding: RuntimeSessionBinding, workspaceId: string): void {
  if (binding.workspaceId !== workspaceId) {
    throw new ApiError(
      400,
      "runtime_session_binding_workspace_mismatch",
      "Runtime session binding belongs to a different workspace",
    );
  }
}

function assertNativeSessionIdentityAvailable(
  bindings: readonly RuntimeSessionBinding[],
  candidate: RuntimeSessionBinding,
): void {
  const candidateIdentity = runtimeSessionNativeIdentity(candidate);
  const conflict = bindings.find((binding) =>
    binding.productSessionId !== candidate.productSessionId &&
    runtimeSessionNativeIdentity(binding) === candidateIdentity
  );
  if (conflict) {
    throw new ApiError(
      409,
      "runtime_session_binding_native_id_conflict",
      "Runtime session identity is already bound",
    );
  }
}

function requireSessionId(value: string): string {
  const sessionId = value.trim();
  if (!sessionId) throw new ApiError(400, "invalid_payload", "productSessionId is required");
  return sessionId;
}

function nextRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new ApiError(
      409,
      "runtime_session_bindings_revision_invalid",
      "Runtime session binding revision cannot advance",
    );
  }
  return revision + 1;
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

function assertStoreOutsideWorkspace(path: string, workspacePath: string): void {
  const root = workspacePath.trim();
  if (!root) return;
  const normalizedPath = canonicalizePath(path);
  const normalizedRoot = canonicalizePath(root);
  const child = relative(normalizedRoot, normalizedPath);
  if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) {
    throw new ApiError(
      400,
      "runtime_session_binding_store_inside_workspace",
      "Runtime session binding state must be stored outside the workspace",
    );
  }
}

function canonicalizePath(path: string): string {
  const absolute = resolve(path);
  try {
    return normalizeCanonicalPath(realpathSync(absolute));
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw new ApiError(
        400,
        "runtime_session_binding_store_unavailable",
        "Runtime session binding path cannot be safely resolved",
      );
    }
    const parent = dirname(absolute);
    if (parent === absolute) return normalizeCanonicalPath(absolute);
    return normalizeCanonicalPath(join(canonicalizePath(parent), absolute.slice(parent.length + 1)));
  }
}

function normalizeCanonicalPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
