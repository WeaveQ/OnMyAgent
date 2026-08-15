import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
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
import { recordExpertLifecycleEvent } from "./expert-lifecycle-events.js";

const EXPERT_SESSION_MARKER_NAME = "onmyagent-session.json";
/** Lightweight default agent — never Sisyphus / oh-my-openagent orchestrator. */
export const EXPERT_SESSION_DEFAULT_AGENT = "onmyagent";
/**
 * v1: opencode.json + declared skills
 * v2: lean .opencode/agents/onmyagent.md so default_agent always resolves
 * v3: explicit agent/package/session identity + declared/installed/missing skills
 */
export const EXPERT_SESSION_ISOLATION_VERSION = 3;
/** A directory allocated before OpenCode returns a real session id stays v2. */
const EXPERT_SESSION_PENDING_ISOLATION_VERSION = 2;

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
  agentId?: string;
  packageName?: string;
  sessionId?: string;
  approvedAgentIds: string[];
  declaredSkills: string[];
  /** Skill folders copied into the session-local skills root. */
  installedSkills: string[];
  missingSkills: string[];
  isolationVersion: number;
  defaultAgent: string;
};

/** Validated marker view; legacy fields stay opaque so upgrades preserve them. */
export type ExpertSessionMarker = {
  kind: "expert-session";
  workspaceId: string;
  isolationVersion?: number;
  agentId?: string;
  packageName?: string;
  sessionId?: string;
  agent?: string;
  sessionKey?: string;
  runtime?: boolean;
  defaultAgent?: string;
  /** Package-declared prompt agents allowed inside this Expert runtime. */
  approvedAgentIds?: string[];
  declaredSkills?: string[];
  installedSkills?: string[];
  missingSkills?: string[];
  [key: string]: unknown;
};

export type AuthorizedArtifactResolutionRoot = {
  root: string;
  canonicalRoot: string;
  source: "workspace" | "expert-runtime";
};

export function resolveExpertSessionRuntimeRoot(override?: string): string {
  return override?.trim() || process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT?.trim()
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
    const markerPath = join(resolvedDirectory, EXPERT_SESSION_MARKER_NAME);
    const markerInfo = await lstat(markerPath);
    if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) return null;
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
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

/**
 * Ordered skill roots for expert session materialization:
 * explicit override (tests, exclusive) → package-local skills → profile /
 * OPENCODE_GLOBAL_SKILLS_DIR / legacy (fallback for names only in the user root).
 *
 * Package trees win over a same-named personal install so the session dir
 * holds the expert-declared copy.
 */
export function resolveExpertSkillSourceRoots(
  override?: string,
  packageName?: string,
): string[] {
  if (override?.trim()) return [resolve(override.trim())];
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string | undefined | null) => {
    if (!candidate?.trim()) return;
    const resolved = resolve(candidate.trim());
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };
  for (const candidate of [
    ...resolvePackageSkillSourceRoots(packageName),
    process.env.OPENCODE_GLOBAL_SKILLS_DIR?.trim(),
    globalSkillsDir(),
    legacyOnmyagentSkillsDir(),
  ]) {
    push(candidate);
  }
  return roots;
}

/**
 * Package-bundled skill trees: `…/experts/installed/<pkg>/skills` (and mine).
 * ONMYAGENT_EXPERTS_DIR points at the installed experts root when set by desktop.
 */
export function resolvePackageSkillSourceRoots(packageName?: string): string[] {
  const name = packageName?.trim();
  if (!name || !isSafeSkillFolderName(name)) return [];
  const candidates: string[] = [];
  const expertsDir = process.env.ONMYAGENT_EXPERTS_DIR?.trim();
  if (expertsDir) {
    candidates.push(join(expertsDir, name, "skills"));
  }
  const profileExperts = join(
    homedir(),
    ".onmyagent",
    "profiles",
    "local",
    "config",
    "experts",
  );
  candidates.push(join(profileExperts, "installed", name, "skills"));
  candidates.push(join(profileExperts, "mine", name, "skills"));
  return candidates;
}

function findSkillSourceDir(
  skillName: string,
  sourceRoots: readonly string[],
): string | null {
  for (const root of sourceRoots) {
    // Package roots already end with `/skills`; global roots are the skills parent.
    const direct = join(root, skillName);
    if (existsSync(join(direct, "SKILL.md"))) return direct;
  }
  return null;
}

/**
 * Copy only allowlisted skill folders into `targetDir/.opencode/skills/<name>`.
 * Searches profile / global / legacy / package skill roots. Unknown names are skipped.
 */
export async function materializeExpertSessionSkills(input: {
  skillNames: readonly string[] | undefined;
  targetDirectory: string;
  skillsSourceRoot?: string;
  /** When set, also search experts/installed|mine/<package>/skills. */
  packageName?: string;
}): Promise<string[]> {
  const targetDirectory = resolve(input.targetDirectory);
  const sourceRoots = resolveExpertSkillSourceRoots(
    input.skillsSourceRoot,
    input.packageName,
  );
  const names = normalizeSkillNameList(input.skillNames);
  const skillsDir = join(targetDirectory, ".opencode", "skills");
  const installed: string[] = [];
  try {
    await mkdir(skillsDir, { recursive: true });
    // Lazy repair converges physical skills to the package declaration. Stale
    // folders from a previous Expert must not survive into marker v3.
    const existing = await readdir(skillsDir, { withFileTypes: true });
    await Promise.all(
      existing
        .filter((entry) => !names.includes(entry.name))
        .map((entry) => rm(join(skillsDir, entry.name), { recursive: true, force: true })),
    );
  } catch {
    // The following copy/write operation reports a real filesystem failure.
  }
  try {
    for (const skillName of names) {
      const source = findSkillSourceDir(skillName, sourceRoots);
      if (!source) continue;
      const destination = join(skillsDir, skillName);
      await rm(destination, { recursive: true, force: true });
      await cp(source, destination, { recursive: true });
      installed.push(skillName);
    }
    recordExpertLifecycleEvent({
      kind: "materialize",
      source: "runtime",
      phase: "complete",
      outcome: "succeeded",
      declaredSkillCount: names.length,
      installedSkillCount: installed.length,
      missingSkillCount: names.length - installed.length,
    });
    return installed;
  } catch (error) {
    recordExpertLifecycleEvent({
      kind: "materialize",
      source: "runtime",
      phase: "complete",
      outcome: "failed",
      code: "materialize_failed",
      declaredSkillCount: names.length,
      installedSkillCount: installed.length,
      missingSkillCount: names.length - installed.length,
    });
    throw error;
  }
}

/**
 * Write opencode.json + lean agent file + optional skills into an expert
 * session directory (create or upgrade).
 */
export async function applyExpertSessionIsolation(input: {
  directory: string;
  workspaceId: string;
  agentId?: string;
  packageName?: string;
  sessionId?: string;
  agentSegment?: string;
  sessionKey?: string;
  skillNames?: readonly string[];
  declaredSkills?: readonly string[];
  approvedAgentIds?: readonly string[];
  skillsSourceRoot?: string;
  defaultAgent?: string;
  /** Preserve existing marker fields when upgrading. */
  existingMarker?: Record<string, unknown> | null;
}): Promise<{
  agentId?: string;
  packageName?: string;
  sessionId?: string;
  declaredSkills: string[];
  approvedAgentIds: string[];
  installedSkills: string[];
  missingSkills: string[];
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

  const prior = input.existingMarker && typeof input.existingMarker === "object"
    ? input.existingMarker
    : {};
  const packageNameForSkills = input.packageName?.trim() ||
    (typeof prior.packageName === "string" && prior.packageName.trim()
      ? prior.packageName.trim()
      : undefined) ||
    (() => {
      const agentId = input.agentId?.trim() ||
        (typeof prior.agentId === "string" ? prior.agentId.trim() : "");
      // Marketplace agent ids look like `pkg:pkg`; package folder uses the pkg token.
      return agentId.includes(":") ? agentId.split(":")[0] : agentId || undefined;
    })();
  const declaredSkills = normalizeSkillNameList(
    input.declaredSkills ?? input.skillNames ??
      (Array.isArray(prior.declaredSkills)
        ? prior.declaredSkills.filter((item): item is string => typeof item === "string")
        : []),
  );
  // Materialize using the resolved declaration (including prior marker) so an
  // isolation upgrade without explicit skillNames does not wipe installed skills.
  const installedSkills = await materializeExpertSessionSkills({
    skillNames: declaredSkills,
    targetDirectory: directory,
    skillsSourceRoot: input.skillsSourceRoot,
    packageName: packageNameForSkills,
  });
  // The marker must describe the current physical materialization, not stale
  // claims carried by an older marker. A missing source remains missing until
  // a later ensure actually copies it into this runtime directory.
  const effectiveInstalledSkills = installedSkills.filter((skill) =>
    declaredSkills.includes(skill),
  );
  const missingSkills = declaredSkills.filter(
    (skill) => !effectiveInstalledSkills.includes(skill),
  );
  if (missingSkills.length > 0) {
    recordExpertLifecycleEvent({
      kind: "missing_skills",
      source: "runtime",
      phase: "ensure",
      outcome: "partial",
      code: "skills_missing",
      declaredSkillCount: declaredSkills.length,
      missingSkillCount: missingSkills.length,
    });
  }
  const approvedAgentIds = normalizeAgentIdList(
    input.approvedAgentIds ??
      (Array.isArray(prior.approvedAgentIds)
        ? prior.approvedAgentIds.filter((item): item is string => typeof item === "string")
        : []),
  );
  const migratingLegacyMarker =
    typeof prior.isolationVersion !== "number" || prior.isolationVersion < EXPERT_SESSION_ISOLATION_VERSION;
  const agentId = input.agentId?.trim() ||
    (typeof prior.agentId === "string" && prior.agentId.trim() ? prior.agentId.trim() : undefined) ||
    (migratingLegacyMarker && typeof prior.agent === "string" && prior.agent.trim()
      ? prior.agent.trim() : undefined);
  const packageName = input.packageName?.trim() ||
    (typeof prior.packageName === "string" && prior.packageName.trim() ? prior.packageName.trim() : undefined) ||
    (migratingLegacyMarker && agentId ? agentId : undefined);
  const sessionId = input.sessionId?.trim() ||
    (typeof prior.sessionId === "string" && prior.sessionId.trim() ? prior.sessionId.trim() : undefined);
  const hasCompleteIdentity = Boolean(agentId && packageName && sessionId);

  await writeMarkerAtomically(join(directory, EXPERT_SESSION_MARKER_NAME), {
      ...prior,
      kind: "expert-session",
      workspaceId: input.workspaceId,
      ...(agentId ? { agentId } : {}),
      ...(packageName ? { packageName } : {}),
      ...(sessionId ? { sessionId } : {}),
      agent:
        input.agentSegment?.trim() ||
        (typeof prior.agent === "string" ? prior.agent : "expert"),
      sessionKey:
        input.sessionKey?.trim() ||
        (typeof prior.sessionKey === "string" ? prior.sessionKey : undefined),
      runtime: true,
      isolationVersion: hasCompleteIdentity
        ? EXPERT_SESSION_ISOLATION_VERSION
        : EXPERT_SESSION_PENDING_ISOLATION_VERSION,
      defaultAgent,
      approvedAgentIds,
      declaredSkills,
      installedSkills: effectiveInstalledSkills,
      missingSkills,
    });

  return {
    ...(agentId ? { agentId } : {}),
    ...(packageName ? { packageName } : {}),
    ...(sessionId ? { sessionId } : {}),
    approvedAgentIds,
    declaredSkills,
    installedSkills: effectiveInstalledSkills,
    missingSkills,
    isolationVersion: hasCompleteIdentity
      ? EXPERT_SESSION_ISOLATION_VERSION
      : EXPERT_SESSION_PENDING_ISOLATION_VERSION,
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
  agentId?: string;
  packageName?: string;
  sessionId?: string;
  skillNames?: readonly string[];
  approvedAgentIds?: readonly string[];
  skillsSourceRoot?: string;
  runtimeRoot?: string;
}): Promise<{
  directory: string;
  upgraded: boolean;
  agentId?: string;
  packageName?: string;
  sessionId?: string;
  approvedAgentIds: string[];
  declaredSkills: string[];
  installedSkills: string[];
  missingSkills: string[];
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
  const requestedCompleteIdentity = Boolean(
    input.agentId?.trim() && input.packageName?.trim() && input.sessionId?.trim(),
  );
  const existingCompleteIdentity = Boolean(
    typeof existingMarker?.agentId === "string" && existingMarker.agentId.trim() &&
    typeof existingMarker?.packageName === "string" && existingMarker.packageName.trim() &&
    typeof existingMarker?.sessionId === "string" && existingMarker.sessionId.trim(),
  );
  const canBindLegacyIdentity = Boolean(
    input.sessionId?.trim() && (
      input.agentId?.trim() ||
      input.packageName?.trim() ||
      (typeof existingMarker?.agent === "string" && existingMarker.agent.trim())
    ),
  );
  const needsUpgrade =
    !existsSync(agentPath) ||
    (currentVersion < EXPERT_SESSION_ISOLATION_VERSION &&
      (requestedCompleteIdentity || existingCompleteIdentity || canBindLegacyIdentity));
  // An explicit empty declaration is meaningful: it asks a lazy repair to
  // remove stale materialized skill folders. Checking only list length would
  // leave rogue folders behind when an Expert declares no skills.
  const hasSkillRequest = input.skillNames !== undefined;
  const identityMismatch = [
    [input.agentId, existingMarker?.agentId],
    [input.packageName, existingMarker?.packageName],
    [input.sessionId, existingMarker?.sessionId],
  ].some(([requested, existing]) =>
    typeof requested === "string" && requested.trim() && requested.trim() !== existing,
  );
  const existingApprovedAgentIds = Array.isArray(existingMarker?.approvedAgentIds)
    ? normalizeAgentIdList(existingMarker.approvedAgentIds.filter((item): item is string => typeof item === "string"))
    : [];
  const requestedApprovedAgentIds = input.approvedAgentIds === undefined
    ? null
    : normalizeAgentIdList(input.approvedAgentIds);
  const approvedAgentMismatch = requestedApprovedAgentIds !== null &&
    !sameAgentIdList(existingApprovedAgentIds, requestedApprovedAgentIds);
  const markerDeclaredSkills = Array.isArray(existingMarker?.declaredSkills)
    ? normalizeSkillNameList(
      existingMarker.declaredSkills.filter((item): item is string => typeof item === "string"),
    )
    : [];
  // Physical skills may be empty after a failed first materialize (race / wrong
  // skill root). Do not leave isolation-v3 sessions stuck with missingSkills.
  let physicalInstalledSkills: string[] | null = null;
  if (!needsUpgrade && !hasSkillRequest && !identityMismatch && !approvedAgentMismatch) {
    physicalInstalledSkills = await readPhysicalInstalledSkills(
      authorized,
      markerDeclaredSkills,
    );
    const physicalMissing = markerDeclaredSkills.filter(
      (skill) => !physicalInstalledSkills!.includes(skill),
    );
    if (physicalMissing.length === 0) {
      return {
        directory: authorized,
        upgraded: false,
        ...(typeof existingMarker?.agentId === "string" && existingMarker.agentId.trim()
          ? { agentId: existingMarker.agentId.trim() } : {}),
        ...(typeof existingMarker?.packageName === "string" && existingMarker.packageName.trim()
          ? { packageName: existingMarker.packageName.trim() } : {}),
        ...(typeof existingMarker?.sessionId === "string" && existingMarker.sessionId.trim()
          ? { sessionId: existingMarker.sessionId.trim() } : {}),
        approvedAgentIds: existingApprovedAgentIds,
        declaredSkills: markerDeclaredSkills,
        installedSkills: physicalInstalledSkills,
        missingSkills: [],
        isolationVersion: currentVersion || EXPERT_SESSION_ISOLATION_VERSION,
        defaultAgent: EXPERT_SESSION_DEFAULT_AGENT,
      };
    }
    recordExpertLifecycleEvent({
      kind: "missing_skills",
      source: "runtime",
      phase: "ensure",
      outcome: "partial",
      code: "skills_missing_repair",
      declaredSkillCount: markerDeclaredSkills.length,
      missingSkillCount: physicalMissing.length,
    });
  }

  // Prefer explicit skillNames; for auto-repair of missing physical skills use
  // the marker declaration so apply re-copies from global/package roots.
  const skillNamesForApply = hasSkillRequest
    ? input.skillNames
    : (physicalInstalledSkills !== null ? markerDeclaredSkills : input.skillNames);

  const applied = await applyExpertSessionIsolation({
    directory: authorized,
    workspaceId: input.workspace.id,
    agentId: input.agentId,
    packageName: input.packageName,
    sessionId: input.sessionId,
    skillNames: skillNamesForApply,
    approvedAgentIds: input.approvedAgentIds,
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

function normalizeAgentIdList(
  agentIds: readonly string[] | undefined,
): string[] {
  if (!agentIds?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of agentIds) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sameAgentIdList(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

async function readPhysicalInstalledSkills(
  directory: string,
  declaredSkills: readonly string[],
): Promise<string[]> {
  const skillsRoot = join(directory, ".opencode", "skills");
  try {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const folders = new Set(
      entries
        .filter((entry) => entry.isDirectory() && isSafeSkillFolderName(entry.name))
        .map((entry) => entry.name),
    );
    return declaredSkills.filter((skill) =>
      folders.has(skill) && existsSync(join(skillsRoot, skill, "SKILL.md")),
    );
  } catch {
    return [];
  }
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
  packageName?: string;
  sessionId?: string;
  sessionKey?: string;
  runtimeRoot?: string;
  /** Declared expert skills (frontmatter / package). Only these are linked. */
  skillNames?: readonly string[];
  declaredSkills?: readonly string[];
  approvedAgentIds?: readonly string[];
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
    agentId: input.agentId,
    packageName: input.packageName?.trim() || input.agentId?.trim(),
    sessionId: input.sessionId,
    agentSegment,
    sessionKey,
    skillNames: input.skillNames,
    approvedAgentIds: input.approvedAgentIds,
    skillsSourceRoot: input.skillsSourceRoot,
    defaultAgent: input.defaultAgent,
  });

  return {
    directory,
    sessionKey,
    agentSegment,
    ...(applied.agentId ? { agentId: applied.agentId } : {}),
    ...(applied.packageName ? { packageName: applied.packageName } : {}),
    ...(applied.sessionId ? { sessionId: applied.sessionId } : {}),
    approvedAgentIds: applied.approvedAgentIds,
    declaredSkills: applied.declaredSkills,
    installedSkills: applied.installedSkills,
    missingSkills: applied.missingSkills,
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

async function writeMarkerAtomically(path: string, marker: Record<string, unknown>): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function parseExpertSessionMarker(
  marker: unknown,
  workspaceId: string,
): ExpertSessionMarker | null {
  if (!marker || typeof marker !== "object") return null;
  const value = marker as Record<string, unknown>;
  if (value.kind !== "expert-session" || value.workspaceId !== workspaceId) return null;
  const version = value.isolationVersion;
  if (version === undefined) return value as ExpertSessionMarker;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || version > EXPERT_SESSION_ISOLATION_VERSION) {
    return null;
  }
  if (version < EXPERT_SESSION_ISOLATION_VERSION) return value as ExpertSessionMarker;
  if (!["agentId", "packageName", "sessionId"].every(
    (field) => typeof value[field] === "string" && String(value[field]).trim(),
  )) return null;
  if (!["declaredSkills", "installedSkills", "missingSkills"].every(
    (field) => Array.isArray(value[field]) &&
      (value[field] as unknown[]).every((item) => typeof item === "string" && isSafeSkillFolderName(item)),
  )) return null;
  if (value.approvedAgentIds !== undefined &&
    (!Array.isArray(value.approvedAgentIds) ||
      !(value.approvedAgentIds as unknown[]).every(
        (item) => typeof item === "string" && item.trim(),
      ))) return null;
  const declared = new Set(value.declaredSkills as string[]);
  const installed = new Set(value.installedSkills as string[]);
  const missing = new Set(value.missingSkills as string[]);
  if (!( [...installed].every((skill) => declared.has(skill)) &&
    [...missing].every((skill) => declared.has(skill)) &&
    [...installed].every((skill) => !missing.has(skill)))) return null;
  return value as ExpertSessionMarker;
}

function isExpertSessionMarkerForWorkspace(
  marker: unknown,
  workspaceId: string,
): boolean {
  return parseExpertSessionMarker(marker, workspaceId) !== null;
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

/** Files → Expert catalog row; path may include session subdirs (合同输出/…). */
export type ExpertSessionRuntimeFileEntry = {
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  agentSegment: string;
  sessionKey: string;
};

/** Session-local dirs that are runtime plumbing, not user deliverables. */
const EXPERT_SESSION_SKIP_DIR_NAMES = new Set([
  ".opencode",
  "node_modules",
  ".git",
  ".omo",
  ".onmyagent",
]);

/** Runtime / OS junk — same idea as UI `shouldHideEntry`, not business filenames. */
const EXPERT_SESSION_HIDDEN_BASENAMES = new Set([
  "thumbs.db",
  "desktop.ini",
  "onmyagent-session.json",
  "opencode.json",
  "opencode.jsonc",
]);

/**
 * Walk a session directory for deliverable files (recursive).
 * Paths are relative to the session root with forward slashes.
 * Skips marker/dotfiles and known runtime plumbing directories.
 */
async function collectExpertSessionDeliverableFiles(
  sessionDir: string,
  relativePrefix = "",
  depth = 0,
): Promise<Array<{ relPath: string; size: number; mtimeMs: number }>> {
  // Cap depth so a runaway tree cannot explode the Files catalog.
  if (depth > 8) return [];

  let dirEntries: import("node:fs").Dirent[];
  try {
    dirEntries = await readdir(sessionDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: Array<{ relPath: string; size: number; mtimeMs: number }> = [];
  for (const entry of dirEntries) {
    const name = entry.name;
    if (name === EXPERT_SESSION_MARKER_NAME) continue;
    if (name === ".DS_Store" || name.startsWith(".")) continue;
    if (EXPERT_SESSION_HIDDEN_BASENAMES.has(name.toLowerCase())) continue;

    const abs = join(sessionDir, name);
    const relPath = relativePrefix ? `${relativePrefix}/${name}` : name;

    if (entry.isDirectory()) {
      if (EXPERT_SESSION_SKIP_DIR_NAMES.has(name)) continue;
      // Process trees: helpers and scratch live here, never as expert products.
      if (depth === 0 && (name === "scripts" || name === "tmp" || name === "temp")) {
        continue;
      }
      out.push(...(await collectExpertSessionDeliverableFiles(abs, relPath, depth + 1)));
      continue;
    }
    if (!entry.isFile()) continue;

    let info;
    try {
      info = await stat(abs);
    } catch {
      continue;
    }
    out.push({ relPath, size: info.size, mtimeMs: info.mtimeMs });
  }
  return out;
}

/**
 * List every managed expert session artifact under the current workspace's
 * runtime directory. Returns flat entries whose `path` is
 * `<agentSegment>/<sessionKey>/<relativeFile>` (subdirs allowed, e.g.
 * `…/合同输出/foo.docx`) so the UI can build an agent -> session -> file outline.
 *
 * Marker files (`onmyagent-session.json`), dotfiles, `.opencode/`, and process
 * helper folders are filtered server-side; the UI also hides junk via
 * `shouldHideEntry`.
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

      const files = await collectExpertSessionDeliverableFiles(sessionDir);
      for (const file of files) {
        entries.push({
          path: `${agentSegment}/${sessionKey}/${file.relPath}`,
          kind: "file",
          size: file.size,
          mtimeMs: file.mtimeMs,
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
