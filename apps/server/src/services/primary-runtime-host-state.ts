import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { Database, type SqliteDatabase } from "../core/sqlite.js";
import { resolveRuntimeDataRoot } from "./runtime-data-root.js";

const HOST_STATE_VERSION = 1;

export type PrimaryOpencodeHostIdentity = {
  profileId: string;
  runtimeHome: string;
  sandboxProfile?: string;
};

type HostStateFile = {
  version: typeof HOST_STATE_VERSION;
  activeOpencodeProfileId: string;
  opencodeProfiles: Record<string, Omit<PrimaryOpencodeHostIdentity, "profileId">>;
};

export type PrimaryRuntimeRootOwnership = {
  dataRoot: string;
  release: () => Promise<void>;
};

export function resolvePrimaryRuntimeHostStatePath(dataRoot?: string): string {
  return join(
    resolveRuntimeDataRoot(dataRoot),
    "runtime-state",
    "primary-runtime",
    "primary-runtime-host.json",
  );
}

export function resolvePrimaryRuntimeOwnerLockPath(dataRoot?: string): string {
  return join(
    resolveRuntimeDataRoot(dataRoot),
    "runtime-state",
    "primary-runtime",
    "server-owner.sqlite",
  );
}

export async function parsePrimaryOpencodeHostIdentity(
  value: unknown,
): Promise<PrimaryOpencodeHostIdentity> {
  if (!isRecord(value)) throw invalidHostIdentityError();
  const keys = Object.keys(value);
  if (keys.some((key) => !["profileId", "runtimeHome", "sandboxProfile"].includes(key))) {
    throw invalidHostIdentityError();
  }
  const profileId = nonEmptyString(value.profileId);
  const runtimeHome = nonEmptyString(value.runtimeHome);
  const sandboxProfile = value.sandboxProfile === undefined
    ? undefined
    : nonEmptyString(value.sandboxProfile);
  if (
    !profileId ||
    !isSafeProfileId(profileId) ||
    !runtimeHome ||
    !isAbsolute(runtimeHome) ||
    (value.sandboxProfile !== undefined && !sandboxProfile)
  ) {
    throw invalidHostIdentityError();
  }
  return {
    profileId,
    runtimeHome: await canonicalizeDirectory(runtimeHome),
    ...(sandboxProfile ? { sandboxProfile } : {}),
  };
}

export async function readPrimaryOpencodeHostIdentity(input: {
  dataRoot?: string;
} = {}): Promise<PrimaryOpencodeHostIdentity | null> {
  const path = resolvePrimaryRuntimeHostStatePath(input.dataRoot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw hostStateUnavailableError();
  }
  const state = await parseHostState(parsed);
  const active = state.opencodeProfiles[state.activeOpencodeProfileId];
  if (!active) throw hostStateUnavailableError();
  return { profileId: state.activeOpencodeProfileId, ...active };
}

export async function ensurePrimaryOpencodeHostIdentity(input: {
  dataRoot?: string;
  identity: PrimaryOpencodeHostIdentity;
}): Promise<PrimaryOpencodeHostIdentity> {
  const identity = await parsePrimaryOpencodeHostIdentity(input.identity);
  const path = resolvePrimaryRuntimeHostStatePath(input.dataRoot);
  const current = await readHostState(path);
  const existing = current?.opencodeProfiles[identity.profileId];
  if (existing && !sameProfile(existing, identity)) {
    throw new ApiError(
      409,
      "primary_runtime_host_identity_conflict",
      "Primary OpenCode profile conflicts with persisted runtime state",
    );
  }
  if (
    existing &&
    current?.activeOpencodeProfileId === identity.profileId
  ) return identity;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp.${randomUUID()}`;
  const file: HostStateFile = {
    version: HOST_STATE_VERSION,
    activeOpencodeProfileId: identity.profileId,
    opencodeProfiles: {
      ...(current?.opencodeProfiles ?? {}),
      [identity.profileId]: {
        runtimeHome: identity.runtimeHome,
        ...(identity.sandboxProfile
          ? { sandboxProfile: identity.sandboxProfile }
          : {}),
      },
    },
  };
  try {
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return identity;
}

export async function acquirePrimaryRuntimeRootOwnership(input: {
  dataRoot?: string;
  workspaces: readonly Pick<WorkspaceInfo, "path">[];
}): Promise<PrimaryRuntimeRootOwnership> {
  const dataRoot = await canonicalizeDirectory(resolveRuntimeDataRoot(input.dataRoot));
  await assertRootOutsideWorkspaces(dataRoot, input.workspaces);
  const path = resolvePrimaryRuntimeOwnerLockPath(dataRoot);
  await mkdir(dirname(path), { recursive: true });
  let database: SqliteDatabase | null = null;
  try {
    database = new Database(path);
    if (process.platform !== "win32") await chmod(path, 0o600);
    database.exec("PRAGMA busy_timeout = 0");
    database.exec("CREATE TABLE IF NOT EXISTS ownership (singleton INTEGER PRIMARY KEY CHECK (singleton = 1))");
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database?.close();
    if (isSqliteBusyError(error)) throw rootAlreadyOwnedError();
    throw rootOwnershipUnavailableError();
  }
  let released = false;
  return {
    dataRoot,
    async release() {
      if (released) return;
      released = true;
      try {
        database.exec("ROLLBACK");
      } finally {
        database.close();
      }
    },
  };
}

async function assertRootOutsideWorkspaces(
  dataRoot: string,
  workspaces: readonly Pick<WorkspaceInfo, "path">[],
): Promise<void> {
  for (const workspace of workspaces) {
    const workspaceRoot = workspace.path.trim();
    if (!workspaceRoot) continue;
    const canonicalWorkspace = await canonicalizeDirectory(workspaceRoot);
    if (isPathInside(canonicalWorkspace, dataRoot)) {
      throw new ApiError(
        400,
        "primary_runtime_data_root_inside_workspace",
        "Primary runtime state must be stored outside configured workspaces",
      );
    }
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function invalidHostIdentityError(): ApiError {
  return new ApiError(
    500,
    "primary_runtime_host_policy_invalid",
    "Primary OpenCode host policy is incomplete or invalid",
  );
}

function hostStateUnavailableError(): ApiError {
  return new ApiError(
    409,
    "primary_runtime_host_state_unavailable",
    "Primary runtime host state is corrupt or uses an unsupported version",
  );
}

function rootAlreadyOwnedError(): ApiError {
  return new ApiError(
    409,
    "primary_runtime_data_root_already_owned",
    "Primary runtime state is already owned by another server process",
  );
}

function rootOwnershipUnavailableError(): ApiError {
  return new ApiError(
    409,
    "primary_runtime_data_root_ownership_unavailable",
    "Primary runtime state ownership cannot be safely established",
  );
}

async function readHostState(path: string): Promise<HostStateFile | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw hostStateUnavailableError();
  }
  return parseHostState(parsed);
}

async function parseHostState(value: unknown): Promise<HostStateFile> {
  if (!isRecord(value)) throw hostStateUnavailableError();
  if (value.version !== HOST_STATE_VERSION) throw hostStateUnavailableError();
  if (Object.keys(value).some((key) =>
    !["version", "activeOpencodeProfileId", "opencodeProfiles"].includes(key)
  )) throw hostStateUnavailableError();
  const activeOpencodeProfileId = nonEmptyString(value.activeOpencodeProfileId);
  if (!activeOpencodeProfileId || !isRecord(value.opencodeProfiles)) {
    throw hostStateUnavailableError();
  }
  const opencodeProfiles = Object.create(null) as HostStateFile["opencodeProfiles"];
  for (const [profileId, profile] of Object.entries(value.opencodeProfiles)) {
    try {
      const identity = await parsePrimaryOpencodeHostIdentity({
        profileId,
        ...(isRecord(profile) ? profile : {}),
      });
      opencodeProfiles[identity.profileId] = {
        runtimeHome: identity.runtimeHome,
        ...(identity.sandboxProfile
          ? { sandboxProfile: identity.sandboxProfile }
          : {}),
      };
    } catch {
      throw hostStateUnavailableError();
    }
  }
  if (!opencodeProfiles[activeOpencodeProfileId]) {
    throw hostStateUnavailableError();
  }
  return { version: HOST_STATE_VERSION, activeOpencodeProfileId, opencodeProfiles };
}

async function canonicalizeDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  const canonical = await realpath(absolute).catch((error) => {
    if (isMissingFileError(error)) return null;
    throw invalidHostIdentityError();
  });
  if (canonical === null) {
    const parent = dirname(absolute);
    if (parent === absolute) return normalizeCanonicalPath(absolute);
    return normalizeCanonicalPath(join(
      await canonicalizeDirectory(parent),
      basename(absolute),
    ));
  }
  return normalizeCanonicalPath(canonical);
}

function normalizeCanonicalPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameProfile(
  left: Omit<PrimaryOpencodeHostIdentity, "profileId">,
  right: PrimaryOpencodeHostIdentity,
): boolean {
  return left.runtimeHome === right.runtimeHome
    && left.sandboxProfile === right.sandboxProfile;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function isSafeProfileId(value: string): boolean {
  return value !== "__proto__" && value !== "prototype" && value !== "constructor";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingFileError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isSqliteBusyError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  return error instanceof Error && /database is locked|database is busy/i.test(error.message);
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
