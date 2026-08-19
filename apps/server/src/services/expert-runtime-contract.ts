import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
  ExpertLifecycleContractAssertionEvent,
  WorkspaceInfo,
} from "@onmyagent/types/server";

import { ApiError } from "../core/errors.js";
import {
  ensureExpertSessionRuntimeIsolation,
  EXPERT_SESSION_DEFAULT_AGENT,
  EXPERT_SESSION_ISOLATION_VERSION,
  normalizeSkillNameList,
  parseExpertSessionMarker,
  resolveAuthorizedExpertSessionRuntimeDirectory,
  resolveExpertSessionRuntimeRoot,
  type ExpertSessionMarker,
} from "./expert-session-runtime.js";
import { recordExpertLifecycleEvent } from "./expert-lifecycle-events.js";

/** Expert prompt contracts are intentionally stricter than ordinary sessions. */
export const EXPERT_RUNTIME_CONTRACT_VERSION = EXPERT_SESSION_ISOLATION_VERSION;
export const EXPERT_PROMPT_TOKEN_LIMIT = 8_000;
/**
 * Inspection cap for text-only Expert prompts. File-bearing bodies use
 * `EXPERT_PROMPT_BODY_MAX_BYTES_WITH_FILES` so a spreadsheet/PDF/image
 * data URL cannot trip the proxy before the text budget is checked.
 */
export const EXPERT_PROMPT_BODY_MAX_BYTES = 512 * 1024;
/** Hard read cap when the prompt includes file parts (data URLs or paths). */
export const EXPERT_PROMPT_BODY_MAX_BYTES_WITH_FILES = 16 * 1024 * 1024;

export type ExpertRuntimeContractViolationCode =
  | "authorized_directory"
  | "marker_version"
  | "workspace_identity"
  | "session_identity"
  | "agent_identity"
  | "default_agent"
  | "plugin_isolation"
  | "skills_mismatch"
  | "prompt_agent_not_allowed"
  | "prompt_body_invalid"
  | "prompt_body_too_large"
  | "prompt_token_budget";

export type ExpertRuntimeContractEvent = {
  type: "expert_runtime_contract_violation";
  contractVersion: number;
  violationCode: ExpertRuntimeContractViolationCode;
  workspaceHash: string;
  sessionHash: string;
  directoryHash: string;
};

export type ExpertRuntimeContractSnapshot = {
  contractVersion: number;
  workspaceId: string;
  sessionId: string;
  directory: string;
  marker: ExpertSessionMarker;
  agent: string;
  approvedAgentIds: string[];
  declaredSkills: string[];
  installedSkills: string[];
  missingSkills: string[];
  promptTokens?: number;
};

export type ExpertRuntimeContractInput = {
  workspace: WorkspaceInfo;
  sessionId: string;
  directory: string;
  /** Agent selected in the first prompt body. Empty means the light default. */
  agent?: string;
  /** Package manifest declarations, supplied by the caller when available. */
  approvedAgentIds?: readonly string[];
  /** Expected package/agent identity from the caller's authoritative directory. */
  agentId?: string;
  packageName?: string;
  declaredSkills?: readonly string[];
  runtimeRoot?: string;
  promptBody?: unknown;
};

export class ExpertRuntimeContractError extends ApiError {
  readonly violationCode: ExpertRuntimeContractViolationCode;

  constructor(
    violationCode: ExpertRuntimeContractViolationCode,
    input: Pick<ExpertRuntimeContractInput, "workspace" | "sessionId" | "directory">,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(409, "expert_runtime_contract_violated", message, {
      contractVersion: EXPERT_RUNTIME_CONTRACT_VERSION,
      violationCode,
      workspaceHash: hashRedacted(input.workspace.id),
      sessionHash: hashRedacted(input.sessionId),
      directoryHash: hashRedacted(input.directory),
      ...details,
    });
    this.name = "ExpertRuntimeContractError";
    this.violationCode = violationCode;
  }

  toEvent(): ExpertRuntimeContractEvent {
    const details = this.details && typeof this.details === "object"
      ? this.details as Record<string, unknown>
      : {};
    const readString = (key: string): string =>
      typeof details[key] === "string"
        ? String(details[key])
        : "";
    return {
      type: "expert_runtime_contract_violation",
      contractVersion: EXPERT_RUNTIME_CONTRACT_VERSION,
      violationCode: this.violationCode,
      workspaceHash: readString("workspaceHash"),
      sessionHash: readString("sessionHash"),
      directoryHash: readString("directoryHash"),
    };
  }
}

export function isExpertRuntimeContractError(
  error: unknown,
): error is ExpertRuntimeContractError {
  return error instanceof ExpertRuntimeContractError || (
    error instanceof ApiError &&
    error.code === "expert_runtime_contract_violated" &&
    typeof error.details === "object" &&
    error.details !== null &&
    "violationCode" in error.details
  );
}

/**
 * Resolve the prompt agent using a package-declared allowlist. The old
 * heavy-agent blacklist was intentionally removed: unknown ids fail closed.
 */
export function resolveExpertPromptAgent(
  selectedAgent: string | null | undefined,
  approvedAgentIds: readonly string[] = [],
): string {
  const selected = selectedAgent?.trim() ?? "";
  if (!selected) return EXPERT_SESSION_DEFAULT_AGENT;
  const approved = new Set(normalizeApprovedAgentIds(approvedAgentIds));
  if (selected === EXPERT_SESSION_DEFAULT_AGENT || approved.has(selected)) {
    return selected;
  }
  throw new ApiError(
    409,
    "expert_runtime_contract_violated",
    "The selected agent is not declared by this Expert package",
    { violationCode: "prompt_agent_not_allowed", agent: selected },
  );
}

export function normalizeApprovedAgentIds(
  agentIds: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of agentIds ?? []) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

/**
 * Marketplace packages often omit `approvedAgentIds` and only declare
 * `agentName` / `agents[]`. The lead identity is still an allowed prompt
 * agent; Sisyphus and other unlisted ids stay rejected.
 */
export function resolveDeclaredExpertAgentIds(input: {
  approvedAgentIds?: readonly string[];
  markerAgent?: string | null;
  agentId?: string | null;
  packageName?: string | null;
  agentName?: string | null;
}): string[] {
  const extras: string[] = [];
  for (const raw of [
    input.markerAgent,
    input.agentId,
    input.packageName,
    input.agentName,
  ]) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    extras.push(value);
    const tail = value.includes(":") ? value.slice(value.lastIndexOf(":") + 1).trim() : "";
    if (tail) extras.push(tail);
  }
  return normalizeApprovedAgentIds([...(input.approvedAgentIds ?? []), ...extras]);
}

/**
 * Conservative UTF-8 estimator for prompt *text* only (`system` + text parts).
 * File / image parts (including data URLs) are excluded: review experts need
 * to attach tables and PDFs, and those bytes are not prompt tokens.
 * This is not a provider tokenizer; the release smoke still needs a live
 * measurement. Non-ASCII is counted more densely so a large CJK context
 * still fails closed.
 */
export function estimateExpertPromptTokens(body: unknown): number {
  return estimateTextTokens(collectExpertPromptText(body));
}

export function expertPromptHasFileParts(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const parts = (body as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return false;
  return parts.some((part) => isExpertPromptFilePart(part));
}

function isExpertPromptFilePart(part: unknown): boolean {
  if (!part || typeof part !== "object" || Array.isArray(part)) return false;
  const item = part as Record<string, unknown>;
  const type = typeof item.type === "string" ? item.type : "";
  if (type === "file" || type === "image" || type === "binary") return true;
  const url = typeof item.url === "string" ? item.url : "";
  return url.startsWith("data:") || url.startsWith("file:");
}

function collectExpertPromptText(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const chunks: string[] = [];
  const system = record.system;
  if (typeof system === "string") chunks.push(system);
  else if (Array.isArray(system)) {
    for (const item of system) {
      if (typeof item === "string") chunks.push(item);
    }
  }
  const parts = record.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      if (isExpertPromptFilePart(part)) continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("\n");
}

function estimateTextTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of text) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

export function assertExpertPromptTokenBudget(
  input: ExpertRuntimeContractInput,
): number {
  const promptTokens = estimateExpertPromptTokens(input.promptBody ?? {});
  if (promptTokens > EXPERT_PROMPT_TOKEN_LIMIT) {
    recordExpertLifecycleEvent({
      kind: "contract_assertion",
      phase: "assert",
      outcome: "failed",
      assertion: "prompt_budget",
      code: "prompt_budget_exceeded",
      workspaceId: input.workspace.id,
      expertId: input.agentId,
      sessionId: input.sessionId,
    });
    throw new ExpertRuntimeContractError(
      "prompt_token_budget",
      input,
      "The first Expert request exceeds the 8,000-token context budget",
      { promptTokens, tokenLimit: EXPERT_PROMPT_TOKEN_LIMIT },
    );
  }
  return promptTokens;
}

/**
 * Detect a managed Expert directory even when its marker is malformed. This
 * is intentionally weaker than artifact authorization and exists only so the
 * prompt proxy fails closed instead of treating a broken Expert as ordinary.
 */
export async function resolveExpertRuntimeDirectoryCandidate(input: {
  workspaceId: string;
  sessionRoot: string | undefined;
  runtimeRoot?: string;
  /**
   * Direct `/opencode/*` mounts do not carry a routed workspace id. They
   * still need to surface a managed Expert directory so the strict contract
   * assertion can reject a cross-workspace target instead of forwarding it.
   * The default remains workspace-scoped for callers doing inventory checks.
   */
  allowWorkspaceMismatch?: boolean;
}): Promise<string | null> {
  const sessionRoot = input.sessionRoot?.trim();
  if (!sessionRoot) return null;
  const runtimeRoot = resolve(input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot());
  const directory = resolve(sessionRoot);
  if (!isPathInside(runtimeRoot, directory)) return null;
  try {
    const [canonicalRuntimeRoot, runtimeInfo] = await Promise.all([
      realpath(runtimeRoot),
      lstat(runtimeRoot),
    ]);
    if (runtimeInfo.isSymbolicLink()) return null;

    // A task/preview path may not exist yet. Resolve the nearest existing
    // ancestor while rejecting symlinked directories, then inspect managed
    // Expert markers from that canonical point upward.
    let canonicalDirectory: string | null = null;
    let probe = directory;
    while (isPathInside(runtimeRoot, probe)) {
      try {
        const info = await lstat(probe);
        if (info.isSymbolicLink() || !info.isDirectory()) return null;
        canonicalDirectory = await realpath(probe);
        break;
      } catch {
        if (probe === runtimeRoot) break;
        const parent = resolve(probe, "..");
        if (parent === probe) break;
        probe = parent;
      }
    }
    if (!canonicalDirectory || !isPathInside(canonicalRuntimeRoot, canonicalDirectory)) return null;
    // The proxy normally receives the exact runtime directory. Automation
    // may be handed a nested path, so walk its canonical ancestors until the
    // managed marker is found. Never walk above the external runtime root.
    let cursor = canonicalDirectory;
    while (isPathInside(canonicalRuntimeRoot, cursor)) {
      const markerPath = join(cursor, "onmyagent-session.json");
      try {
        const markerInfo = await lstat(markerPath);
        if (markerInfo.isFile() && !markerInfo.isSymbolicLink()) {
          try {
            const marker = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
            if (marker && typeof marker === "object" && !Array.isArray(marker)) {
              const record = marker as Record<string, unknown>;
              if (record.kind === "expert-session" &&
                (input.allowWorkspaceMismatch || record.workspaceId === input.workspaceId)) {
                return directory;
              }
            }
            // A regular managed-marker file with invalid shape must not turn
            // into an ordinary prompt on direct/proxy safety checks.
            if (input.allowWorkspaceMismatch) return directory;
          } catch {
            if (input.allowWorkspaceMismatch) return directory;
          }
        }
      } catch {
        // Continue to the managed runtime root; a missing marker at one
        // ancestor is ordinary for nested task/preview paths.
      }
      if (cursor === canonicalRuntimeRoot) break;
      const parent = resolve(cursor, "..");
      if (parent === cursor) break;
      cursor = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Assert marker/config/filesystem invariants immediately before an Expert
 * prompt is forwarded to OpenCode. This function never repairs state.
 */
export async function assertExpertRuntimeContract(
  input: ExpertRuntimeContractInput,
): Promise<ExpertRuntimeContractSnapshot> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    throw violation(input, "session_identity", "Expert session id is required");
  }
  const directory = await resolveAuthorizedExpertSessionRuntimeDirectory({
    workspaceId: input.workspace.id,
    sessionRoot: input.directory,
    runtimeRoot: input.runtimeRoot,
  });
  if (!directory) {
    throw violation(input, "authorized_directory", "Directory is not an authorized Expert runtime directory");
  }

  const marker = await readMarker(directory, input);
  if (!marker || marker.isolationVersion !== EXPERT_RUNTIME_CONTRACT_VERSION) {
    throw violation(input, "marker_version", "Expert runtime marker v3 is required");
  }
  if (marker.workspaceId !== input.workspace.id) {
    throw violation(input, "workspace_identity", "Expert runtime belongs to another workspace");
  }
  if (marker.sessionId !== sessionId) {
    throw violation(input, "session_identity", "Expert runtime session identity does not match the request");
  }
  if (input.agentId?.trim() && marker.agentId !== input.agentId.trim()) {
    throw violation(input, "agent_identity", "Expert agent identity does not match the runtime marker");
  }
  if (input.packageName?.trim() && marker.packageName !== input.packageName.trim()) {
    throw violation(input, "agent_identity", "Expert package identity does not match the runtime marker");
  }

  const config = await readJsonRecord(join(directory, "opencode.json"));
  if (!config || config.default_agent !== EXPERT_SESSION_DEFAULT_AGENT) {
    throw violation(input, "default_agent", "Expert runtime default_agent must be onmyagent");
  }
  if (marker.defaultAgent !== undefined && marker.defaultAgent !== EXPERT_SESSION_DEFAULT_AGENT) {
    throw violation(input, "default_agent", "Expert runtime marker defaultAgent must be onmyagent");
  }
  if (!Array.isArray(config.plugin) || config.plugin.length !== 0) {
    throw violation(input, "plugin_isolation", "Expert runtime plugins must be isolated");
  }
  const agentPath = join(directory, ".opencode", "agents", `${EXPERT_SESSION_DEFAULT_AGENT}.md`);
  if (!(await isRegularFile(agentPath))) {
    throw violation(input, "default_agent", "Expert runtime default agent file is missing");
  }

  const declaredSkills = normalizeSkillNameList(marker.declaredSkills);
  const installedSkills = normalizeSkillNameList(marker.installedSkills);
  const missingSkills = normalizeSkillNameList(marker.missingSkills);
  if (
    installedSkills.some((skill) => !declaredSkills.includes(skill)) ||
    missingSkills.some((skill) => !declaredSkills.includes(skill)) ||
    installedSkills.some((skill) => missingSkills.includes(skill)) ||
    declaredSkills.length !== installedSkills.length + missingSkills.length
  ) {
    throw violation(input, "skills_mismatch", "Expert runtime skill declarations are inconsistent");
  }
  if (input.declaredSkills && !sameList(declaredSkills, normalizeSkillNameList(input.declaredSkills))) {
    throw violation(input, "skills_mismatch", "Expert runtime skills do not match the package declaration");
  }
  const materialized = await readMaterializedSkillNames(directory, input);
  if (!sameList(materialized, installedSkills)) {
    throw violation(input, "skills_mismatch", "Expert runtime materialized skills do not match the marker");
  }

  const approvedAgentIds = resolveDeclaredExpertAgentIds({
    approvedAgentIds: [
      ...(input.approvedAgentIds ?? []),
      ...(marker.approvedAgentIds ?? []),
    ],
    markerAgent: marker.agent,
    agentId: input.agentId ?? marker.agentId,
    packageName: input.packageName ?? marker.packageName,
  });
  let agent: string;
  try {
    agent = resolveExpertPromptAgent(input.agent, approvedAgentIds);
  } catch (error) {
    if (error instanceof ApiError) {
      throw violation(input, "prompt_agent_not_allowed", error.message, {
        agent: input.agent?.trim() || EXPERT_SESSION_DEFAULT_AGENT,
      });
    }
    throw error;
  }
  const promptTokens = input.promptBody === undefined
    ? undefined
    : assertExpertPromptTokenBudget({ ...input, directory, promptBody: input.promptBody });
  recordExpertLifecycleEvent({
    kind: "contract_assertion",
    phase: "assert",
    outcome: "succeeded",
    workspaceId: input.workspace.id,
    expertId: input.agentId,
    sessionId,
    code: "contract_valid",
  });
  return {
    contractVersion: EXPERT_RUNTIME_CONTRACT_VERSION,
    workspaceId: input.workspace.id,
    sessionId,
    directory,
    marker,
    agent,
    approvedAgentIds,
    declaredSkills,
    installedSkills,
    missingSkills,
    ...(promptTokens === undefined ? {} : { promptTokens }),
  };
}

const ensureInFlight = new Map<string, Promise<unknown>>();

/** Ensure at most once per request/session + runtime directory, then reassert. */
export async function ensureAndAssertExpertRuntimeContract(
  input: ExpertRuntimeContractInput,
  options: { onViolation?: (event: ExpertRuntimeContractEvent) => void } = {},
): Promise<ExpertRuntimeContractSnapshot> {
  try {
    return await assertExpertRuntimeContract(input);
  } catch (error) {
    emitViolation(error, options.onViolation);
    if (!(error instanceof ExpertRuntimeContractError) || !isRepairableViolation(error.violationCode)) {
      throw error;
    }
    const marker = await readMarkerLoose(input.directory, input.workspace.id);
    const key = `${input.workspace.id}\u0000${input.sessionId.trim()}\u0000${resolve(input.directory)}`;
    let ensurePromise = ensureInFlight.get(key);
    if (!ensurePromise) {
      ensurePromise = ensureExpertSessionRuntimeIsolation({
        workspace: input.workspace,
        directory: input.directory,
        runtimeRoot: input.runtimeRoot,
        agentId: input.agentId?.trim() || marker?.agentId,
        packageName: input.packageName?.trim() || marker?.packageName,
        sessionId: input.sessionId.trim(),
        skillNames: input.declaredSkills ?? marker?.declaredSkills,
        approvedAgentIds: input.approvedAgentIds ?? marker?.approvedAgentIds,
      }).finally(() => {
        if (ensureInFlight.get(key) === ensurePromise) ensureInFlight.delete(key);
      });
      ensureInFlight.set(key, ensurePromise);
    }
    await ensurePromise;
    return await assertExpertRuntimeContract(input);
  }
}

function isRepairableViolation(code: ExpertRuntimeContractViolationCode): boolean {
  return code === "marker_version" || code === "default_agent" || code === "plugin_isolation" || code === "skills_mismatch";
}

function violation(
  input: ExpertRuntimeContractInput,
  code: ExpertRuntimeContractViolationCode,
  message: string,
  details: Record<string, unknown> = {},
): ExpertRuntimeContractError {
  recordExpertLifecycleEvent({
    kind: "contract_assertion",
    phase: "assert",
    outcome: "failed",
    assertion: assertionForViolation(code),
    code: lifecycleCodeForViolation(code),
    workspaceId: input.workspace.id,
    expertId: input.agentId,
    sessionId: input.sessionId,
  });
  return new ExpertRuntimeContractError(code, input, message, details);
}

function assertionForViolation(
  code: ExpertRuntimeContractViolationCode,
): NonNullable<ExpertLifecycleContractAssertionEvent["assertion"]> {
  switch (code) {
    case "authorized_directory": return "authorized_directory";
    case "marker_version": return "marker";
    case "workspace_identity":
    case "session_identity": return "identity";
    case "agent_identity":
    case "prompt_agent_not_allowed": return "agent";
    case "default_agent": return "agent";
    case "plugin_isolation": return "plugin_isolation";
    case "skills_mismatch": return "skills";
    case "prompt_body_invalid":
    case "prompt_body_too_large":
    case "prompt_token_budget": return "prompt_budget";
  }
}

function lifecycleCodeForViolation(
  code: ExpertRuntimeContractViolationCode,
): string {
  return code === "prompt_token_budget" ? "prompt_budget_exceeded" : code;
}

function emitViolation(
  error: unknown,
  callback: ((event: ExpertRuntimeContractEvent) => void) | undefined,
): void {
  if (!callback || !isExpertRuntimeContractError(error)) return;
  if (error instanceof ExpertRuntimeContractError) callback(error.toEvent());
}

async function readMarker(
  directory: string,
  input: ExpertRuntimeContractInput,
): Promise<ExpertSessionMarker | null> {
  const marker = await readMarkerLoose(directory, input.workspace.id);
  if (!marker) throw violation(input, "marker_version", "Expert runtime marker is missing or malformed");
  return marker;
}

async function readMarkerLoose(
  directory: string,
  workspaceId: string,
): Promise<ExpertSessionMarker | null> {
  try {
    const raw = JSON.parse(await readFile(join(directory, "onmyagent-session.json"), "utf8")) as unknown;
    return parseExpertSessionMarker(raw, workspaceId);
  } catch {
    return null;
  }
}

async function readJsonRecord(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readMaterializedSkillNames(
  directory: string,
  input: ExpertRuntimeContractInput,
): Promise<string[]> {
  const skillsDir = join(directory, ".opencode", "skills");
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw violation(input, "skills_mismatch", "Expert runtime skills contain an unsafe entry");
      }
      names.push(entry.name);
    }
    return normalizeSkillNameList(names);
  } catch (error) {
    if (error instanceof ExpertRuntimeContractError) throw error;
    return [];
  }
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function hashRedacted(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
