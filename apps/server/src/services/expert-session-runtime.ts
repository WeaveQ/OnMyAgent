import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import {
  globalSkillsDir,
  legacyOnmyagentSkillsDir,
} from "../workspace/workspace-files.js";

const EXPERT_SESSION_MARKER_NAME = "onmyagent-session.json";
/** Lightweight default agent — never Sisyphus / oh-my-openagent orchestrator. */
export const EXPERT_SESSION_DEFAULT_AGENT = "onmyagent";
/**
 * v1: opencode.json + declared skills
 * v2: lean .opencode/agents/onmyagent.md so default_agent always resolves
 */
export const EXPERT_SESSION_ISOLATION_VERSION = 2;

/** Minimal primary agent — persona comes from expert system prompt at prompt time. */
export const EXPERT_SESSION_AGENT_MARKDOWN = `---
description: OnMyAgent expert session agent
mode: primary
temperature: 0.2
---

You are a helpful AI assistant. Your name, role, and persona are defined by the calling system for this expert session — always follow those instructions instead of inventing an identity.

Working style:
- Prefer skills available under this project when they match the task.
- Work safely with files in this session directory.
- Keep answers practical and concise.
- If required inputs are missing, ask one targeted question and continue.
`;

export type ExpertSessionRuntimeDirectory = {
  directory: string;
  sessionKey: string;
  agentSegment: string;
  /** Skill folders copied into the session-local skills root. */
  installedSkills: string[];
  isolationVersion: number;
  defaultAgent: string;
};

export type AuthorizedArtifactResolutionRoot = {
  root: string;
  canonicalRoot: string;
  source: "workspace" | "expert-runtime";
};

export function resolveExpertSessionRuntimeRoot(): string {
  return process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT?.trim()
    || join(homedir(), ".onmyagent", "runtime", "expert-sessions");
}

/**
 * Accept a client-provided expert session root only when it is one of this
 * server's managed runtime directories and its marker belongs to the routed
 * workspace. This keeps artifact existence checks scoped to the current
 * expert session without trusting an arbitrary client filesystem path.
 */
export async function resolveAuthorizedExpertSessionRuntimeDirectory(input: {
  workspaceId: string;
  sessionRoot: string | undefined;
  runtimeRoot?: string;
}): Promise<string | null> {
  const sessionRoot = input.sessionRoot?.trim();
  if (!sessionRoot) return null;

  const runtimeRoot = resolve(input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot());
  const directory = resolve(sessionRoot);
  if (!isPathInside(runtimeRoot, directory)) return null;

  try {
    const [resolvedRuntimeRoot, resolvedDirectory, runtimeRootInfo, info] = await Promise.all([
      realpath(runtimeRoot),
      realpath(directory),
      lstat(runtimeRoot),
      lstat(directory),
    ]);
    if (
      runtimeRootInfo.isSymbolicLink()
      || !info.isDirectory()
      || !isPathInside(resolvedRuntimeRoot, resolvedDirectory)
    ) {
      return null;
    }
    const marker = JSON.parse(
      await readFile(join(resolvedDirectory, EXPERT_SESSION_MARKER_NAME), "utf8"),
    ) as unknown;
    if (!isExpertSessionMarkerForWorkspace(marker, input.workspaceId)) return null;
    return directory;
  } catch {
    return null;
  }
}

/**
 * Resolve an explicitly supplied artifact root without granting arbitrary
 * filesystem access. A root may be a canonical child of the workspace (for
 * legacy/internal sessions) or a managed expert runtime directory.
 */
export async function resolveAuthorizedArtifactResolutionRoot(input: {
  workspace: WorkspaceInfo;
  sessionRoot: string | undefined;
  runtimeRoot?: string;
}): Promise<AuthorizedArtifactResolutionRoot | null> {
  const sessionRoot = input.sessionRoot?.trim();
  if (!sessionRoot) return null;

  const workspaceRoot = await resolveCanonicalDirectoryWithinRoot({
    root: input.workspace.path,
    candidate: sessionRoot,
  });
  if (workspaceRoot) return workspaceRoot;

  const expertRoot = await resolveAuthorizedExpertSessionRuntimeDirectory({
    workspaceId: input.workspace.id,
    sessionRoot,
    runtimeRoot: input.runtimeRoot,
  });
  if (!expertRoot) return null;
  const canonicalRoot = await realpath(expertRoot).catch(() => null);
  return canonicalRoot
    ? { root: expertRoot, canonicalRoot, source: "expert-runtime" }
    : null;
}

/**
 * Project-local OpenCode config for an expert session directory.
 * Keeps default_agent light and declares no home plugins; combined with
 * promptAsync agent forcing this prevents Sisyphus from owning the run.
 */
export function buildExpertSessionOpencodeConfig(input?: {
  defaultAgent?: string;
}): Record<string, unknown> {
  const defaultAgent =
    input?.defaultAgent?.trim() || EXPERT_SESSION_DEFAULT_AGENT;
  return {
    $schema: "https://opencode.ai/config.json",
    default_agent: defaultAgent,
    // Empty list: do not inherit oh-my-openagent / superpowers from project
    // merge when OpenCode prefers project plugin declaration.
    plugin: [],
    instructions: [],
  };
}

export function buildExpertSessionAgentMarkdown(): string {
  return EXPERT_SESSION_AGENT_MARKDOWN.endsWith("\n")
    ? EXPERT_SESSION_AGENT_MARKDOWN
    : `${EXPERT_SESSION_AGENT_MARKDOWN}\n`;
}

/** Ordered skill roots: override → OPENCODE_GLOBAL_SKILLS_DIR → profile → legacy. */
export function resolveExpertSkillSourceRoots(override?: string): string[] {
  if (override?.trim()) return [resolve(override.trim())];
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    process.env.OPENCODE_GLOBAL_SKILLS_DIR?.trim(),
    globalSkillsDir(),
    legacyOnmyagentSkillsDir(),
  ]) {
    if (!candidate) continue;
    const resolved = resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    roots.push(resolved);
  }
  return roots;
}

function findSkillSourceDir(
  skillName: string,
  sourceRoots: readonly string[],
): string | null {
  for (const root of sourceRoots) {
    const source = join(root, skillName);
    if (existsSync(join(source, "SKILL.md"))) return source;
  }
  return null;
}

/**
 * Copy only allowlisted skill folders into `targetDir/.opencode/skills/<name>`.
 * Searches profile / global / legacy skill roots. Unknown names are skipped.
 */
export async function materializeExpertSessionSkills(input: {
  skillNames: readonly string[] | undefined;
  targetDirectory: string;
  skillsSourceRoot?: string;
}): Promise<string[]> {
  const targetDirectory = resolve(input.targetDirectory);
  const sourceRoots = resolveExpertSkillSourceRoots(input.skillsSourceRoot);
  const names = normalizeSkillNameList(input.skillNames);
  if (names.length === 0) return [];

  const skillsDir = join(targetDirectory, ".opencode", "skills");
  await mkdir(skillsDir, { recursive: true });
  const installed: string[] = [];
  for (const skillName of names) {
    const source = findSkillSourceDir(skillName, sourceRoots);
    if (!source) continue;
    const destination = join(skillsDir, skillName);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
    installed.push(skillName);
  }
  return installed;
}

/**
 * Write opencode.json + lean agent file + optional skills into an expert
 * session directory (create or upgrade).
 */
export async function applyExpertSessionIsolation(input: {
  directory: string;
  workspaceId: string;
  agentSegment?: string;
  sessionKey?: string;
  skillNames?: readonly string[];
  skillsSourceRoot?: string;
  defaultAgent?: string;
  /** Preserve existing marker fields when upgrading. */
  existingMarker?: Record<string, unknown> | null;
}): Promise<{
  installedSkills: string[];
  isolationVersion: number;
  defaultAgent: string;
}> {
  const directory = resolve(input.directory);
  await mkdir(directory, { recursive: true });

  const defaultAgent =
    input.defaultAgent?.trim() || EXPERT_SESSION_DEFAULT_AGENT;
  const opencodeConfig = buildExpertSessionOpencodeConfig({ defaultAgent });
  await writeFile(
    join(directory, "opencode.json"),
    `${JSON.stringify(opencodeConfig, null, 2)}\n`,
    "utf8",
  );

  const agentsDir = join(directory, ".opencode", "agents");
  await mkdir(agentsDir, { recursive: true });
  await writeFile(
    join(agentsDir, `${defaultAgent}.md`),
    buildExpertSessionAgentMarkdown(),
    "utf8",
  );

  const installedSkills = await materializeExpertSessionSkills({
    skillNames: input.skillNames,
    targetDirectory: directory,
    skillsSourceRoot: input.skillsSourceRoot,
  });

  const prior = input.existingMarker && typeof input.existingMarker === "object"
    ? input.existingMarker
    : {};
  const priorSkills = Array.isArray(prior.installedSkills)
    ? prior.installedSkills.filter((item): item is string => typeof item === "string")
    : [];
  const mergedSkills = normalizeSkillNameList([...priorSkills, ...installedSkills]);

  await writeFile(
    join(directory, EXPERT_SESSION_MARKER_NAME),
    `${JSON.stringify({
      ...prior,
      kind: "expert-session",
      workspaceId: input.workspaceId,
      agent:
        input.agentSegment?.trim() ||
        (typeof prior.agent === "string" ? prior.agent : "expert"),
      sessionKey:
        input.sessionKey?.trim() ||
        (typeof prior.sessionKey === "string" ? prior.sessionKey : undefined),
      runtime: true,
      isolationVersion: EXPERT_SESSION_ISOLATION_VERSION,
      defaultAgent,
      installedSkills: mergedSkills.length > 0 ? mergedSkills : installedSkills,
    }, null, 2)}\n`,
    "utf8",
  );

  return {
    installedSkills: mergedSkills.length > 0 ? mergedSkills : installedSkills,
    isolationVersion: EXPERT_SESSION_ISOLATION_VERSION,
    defaultAgent,
  };
}

/**
 * Upgrade an existing expert session dir when isolation is missing or stale.
 * Safe no-op when already at current isolationVersion and agent file exists
 * (still refreshes declared skills if skillNames provided).
 */
export async function ensureExpertSessionRuntimeIsolation(input: {
  workspace: WorkspaceInfo;
  directory: string;
  skillNames?: readonly string[];
  skillsSourceRoot?: string;
  runtimeRoot?: string;
}): Promise<{
  directory: string;
  upgraded: boolean;
  installedSkills: string[];
  isolationVersion: number;
  defaultAgent: string;
} | null> {
  const authorized = await resolveAuthorizedExpertSessionRuntimeDirectory({
    workspaceId: input.workspace.id,
    sessionRoot: input.directory,
    runtimeRoot: input.runtimeRoot,
  });
  if (!authorized) return null;

  let existingMarker: Record<string, unknown> | null = null;
  let currentVersion = 0;
  try {
    existingMarker = JSON.parse(
      await readFile(join(authorized, EXPERT_SESSION_MARKER_NAME), "utf8"),
    ) as Record<string, unknown>;
    if (typeof existingMarker.isolationVersion === "number") {
      currentVersion = existingMarker.isolationVersion;
    }
  } catch {
    existingMarker = null;
  }

  const agentPath = join(
    authorized,
    ".opencode",
    "agents",
    `${EXPERT_SESSION_DEFAULT_AGENT}.md`,
  );
  const needsUpgrade =
    currentVersion < EXPERT_SESSION_ISOLATION_VERSION || !existsSync(agentPath);
  const hasSkillRequest = normalizeSkillNameList(input.skillNames).length > 0;
  if (!needsUpgrade && !hasSkillRequest) {
    return {
      directory: authorized,
      upgraded: false,
      installedSkills: Array.isArray(existingMarker?.installedSkills)
        ? (existingMarker!.installedSkills as string[])
        : [],
      isolationVersion: currentVersion || EXPERT_SESSION_ISOLATION_VERSION,
      defaultAgent: EXPERT_SESSION_DEFAULT_AGENT,
    };
  }

  const applied = await applyExpertSessionIsolation({
    directory: authorized,
    workspaceId: input.workspace.id,
    skillNames: input.skillNames,
    skillsSourceRoot: input.skillsSourceRoot,
    existingMarker,
  });
  return {
    directory: authorized,
    upgraded: true,
    ...applied,
  };
}

export function normalizeSkillNameList(
  skillNames: readonly string[] | undefined,
): string[] {
  if (!skillNames?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skillNames) {
    const name = String(raw ?? "").trim();
    if (!isSafeSkillFolderName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function isSafeSkillFolderName(value: string): boolean {
  return (
    Boolean(value) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export async function createExpertSessionRuntimeDirectory(input: {
  workspace: WorkspaceInfo;
  agentName: string;
  agentId?: string;
  sessionKey?: string;
  runtimeRoot?: string;
  /** Declared expert skills (frontmatter / package). Only these are linked. */
  skillNames?: readonly string[];
  /** Override skills source root (tests). Defaults to OPENCODE_GLOBAL_SKILLS_DIR / profile. */
  skillsSourceRoot?: string;
  defaultAgent?: string;
}): Promise<ExpertSessionRuntimeDirectory> {
  const runtimeRoot = resolve(input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot());
  const workspaceRoot = resolve(input.workspace.path);
  if (isPathInside(workspaceRoot, runtimeRoot)) {
    throw new Error("Expert session runtime root must be outside the workspace");
  }
  const sessionKey = normalizeSessionKey(input.sessionKey);
  // Prefer stable package/agent id only (not displayName-id doubles like
  // "项目复盘专家-kol-…kol-…"). Fall back to sanitized display name.
  const agentSegment = resolveExpertAgentSegment(input.agentName, input.agentId);
  const workspaceSegment = createHash("sha256")
    .update(`${input.workspace.id}\0${workspaceRoot}`)
    .digest("hex")
    .slice(0, 16);
  const directory = join(runtimeRoot, workspaceSegment, agentSegment, sessionKey);
  if (!isPathInside(runtimeRoot, directory)) {
    throw new Error("Unsafe expert session runtime directory");
  }
  await mkdir(directory, { recursive: true });

  const applied = await applyExpertSessionIsolation({
    directory,
    workspaceId: input.workspace.id,
    agentSegment,
    sessionKey,
    skillNames: input.skillNames,
    skillsSourceRoot: input.skillsSourceRoot,
    defaultAgent: input.defaultAgent,
  });

  return {
    directory,
    sessionKey,
    agentSegment,
    installedSkills: applied.installedSkills,
    isolationVersion: applied.isolationVersion,
    defaultAgent: applied.defaultAgent,
  };
}

function normalizeSessionKey(value?: string): string {
  const candidate = value?.trim() || Date.now().toString();
  return /^\d{10,16}$/.test(candidate) ? candidate : Date.now().toString();
}

/**
 * Build a stable path segment for an expert agent.
 * Marketplace ids look like `pkg:pkg`; using only the package token avoids
 * doubled segments when displayName already contains the package slug.
 */
export function resolveExpertAgentSegment(
  agentName: string,
  agentId?: string,
): string {
  const idRaw = agentId?.trim() ?? "";
  const packageToken = idRaw
    ? (idRaw.includes(":")
        ? idRaw.split(":").map((part) => part.trim()).filter(Boolean).pop()
        : idRaw)
    : "";
  const fromId = packageToken
    ? sanitizePathSegment(packageToken, "")
    : "";
  if (fromId) return fromId;
  return sanitizePathSegment(agentName, "expert");
}

function sanitizePathSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .trim();
  return cleaned || fallback;
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function isExpertSessionMarkerForWorkspace(
  marker: unknown,
  workspaceId: string,
): boolean {
  if (!marker || typeof marker !== "object") return false;
  const value = marker as Record<string, unknown>;
  return value.kind === "expert-session" && value.workspaceId === workspaceId;
}

async function resolveCanonicalDirectoryWithinRoot(input: {
  root: string;
  candidate: string;
}): Promise<AuthorizedArtifactResolutionRoot | null> {
  const root = resolve(input.root);
  const candidate = resolve(input.candidate);
  try {
    const [canonicalRoot, canonicalCandidate, info] = await Promise.all([
      realpath(root),
      realpath(candidate),
      stat(candidate),
    ]);
    if (!info.isDirectory() || !isPathInside(canonicalRoot, canonicalCandidate)) {
      return null;
    }
    return { root: candidate, canonicalRoot: canonicalCandidate, source: "workspace" };
  } catch {
    return null;
  }
}

export type ExpertSessionRuntimeFileEntry = {
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  agentSegment: string;
  sessionKey: string;
};

/**
 * List every managed expert session artifact under the current workspace's
 * runtime directory. Returns flat entries whose `path` is
 * `<agentSegment>/<sessionKey>/<fileName>` so the UI can build an
 * agent -> session -> file outline from the existing file-tree helpers.
 *
 * Marker files (`onmyagent-session.json`), dotfiles and OS junk are filtered
 * server-side; the UI also hides them via `shouldHideEntry`.
 */
export async function listExpertSessionRuntimeFiles(input: {
  workspace: WorkspaceInfo;
  runtimeRoot?: string;
}): Promise<ExpertSessionRuntimeFileEntry[]> {
  const runtimeRoot = resolve(
    input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot(),
  );
  const workspaceRoot = resolve(input.workspace.path);
  const workspaceSegment = createHash("sha256")
    .update(`${input.workspace.id}\0${workspaceRoot}`)
    .digest("hex")
    .slice(0, 16);
  const workspaceDir = join(runtimeRoot, workspaceSegment);

  const entries: ExpertSessionRuntimeFileEntry[] = [];
  let agentEntries: import("node:fs").Dirent[];
  try {
    agentEntries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const agentEntry of agentEntries) {
    if (!agentEntry.isDirectory()) continue;
    const agentSegment = agentEntry.name;
    const agentDir = join(workspaceDir, agentSegment);

    let sessionEntries: import("node:fs").Dirent[];
    try {
      sessionEntries = await readdir(agentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue;
      const sessionKey = sessionEntry.name;
      const sessionDir = join(agentDir, sessionKey);

      let fileEntries: import("node:fs").Dirent[];
      try {
        fileEntries = await readdir(sessionDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const fileEntry of fileEntries) {
        if (!fileEntry.isFile()) continue;
        const fileName = fileEntry.name;
        if (fileName === EXPERT_SESSION_MARKER_NAME) continue;
        if (fileName === ".DS_Store" || fileName.startsWith(".")) continue;
        const abs = join(sessionDir, fileName);
        let info;
        try {
          info = await stat(abs);
        } catch {
          continue;
        }
        entries.push({
          path: `${agentSegment}/${sessionKey}/${fileName}`,
          kind: "file",
          size: info.size,
          mtimeMs: info.mtimeMs,
          agentSegment,
          sessionKey,
        });
      }
    }
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}

/**
 * Resolve a single managed expert session artifact by its runtime-relative path
 * (`<agent>/<session>/<file>`). Returns the absolute path + stat when the file
 * exists inside the workspace's runtime directory, else null.
 *
 * Used by the runtime file read/download/resolve routes so the Files > Expert
 * tab can preview artifacts that live outside the workspace.
 */
export async function resolveExpertSessionRuntimeFile(input: {
  workspace: WorkspaceInfo;
  relPath: string;
  runtimeRoot?: string;
}): Promise<{ absPath: string; size: number; mtimeMs: number } | null> {
  const runtimeRoot = resolve(
    input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot(),
  );
  const workspaceRoot = resolve(input.workspace.path);
  const workspaceSegment = createHash("sha256")
    .update(`${input.workspace.id}\0${workspaceRoot}`)
    .digest("hex")
    .slice(0, 16);
  const workspaceDir = join(runtimeRoot, workspaceSegment);

  const cleaned = String(input.relPath ?? "").trim().replace(/\\/g, "/");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (part === "." || part === "..") return null;
  }
  const absPath = resolve(join(workspaceDir, ...parts));
  if (!isPathInside(workspaceDir, absPath)) return null;
  try {
    const info = await stat(absPath);
    if (!info.isFile()) return null;
    return { absPath, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}
