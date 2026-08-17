import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

let configuredRuntimeStateRoot = process.env.ONMYAGENT_PERSONAL_AGENT_RUNTIME_STATE_ROOT
  ? path.resolve(process.env.ONMYAGENT_PERSONAL_AGENT_RUNTIME_STATE_ROOT)
  : "";
let configuredPersonalAssistantRoot = "";

function safeSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "workspace";
}

export function resolveInteractivePersonalRuntimeStateRoot(userDataDir) {
  const root = String(userDataDir ?? "").trim();
  if (!root) return "";
  return path.join(path.resolve(root), "runtime-state");
}

/** Supervisor subtree under runtime-state (registry + isolated persist parent). */
export function resolveTaskSupervisorPersonalRuntimeStateRoot(userDataDir) {
  const interactive = resolveInteractivePersonalRuntimeStateRoot(userDataDir);
  if (!interactive) return "";
  return path.join(interactive, "task-center-supervisor");
}

/** Isolated Personal workspace persist (runs / conversations / events). */
export function resolveTaskSupervisorPersonalAssistantRoot(userDataDir) {
  const supervisorRoot = resolveTaskSupervisorPersonalRuntimeStateRoot(userDataDir);
  if (!supervisorRoot) return "";
  return path.join(supervisorRoot, "personal-assistant");
}

export function configurePersonalAgentRuntimeState(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "runtimeStateRoot")) {
    const root = String(options.runtimeStateRoot ?? "").trim();
    configuredRuntimeStateRoot = root ? path.resolve(root) : "";
  } else {
    const userDataDir = String(options.userDataDir ?? "").trim();
    if (userDataDir) {
      configuredRuntimeStateRoot = resolveInteractivePersonalRuntimeStateRoot(userDataDir);
    }
  }
  const persist = String(options.personalAssistantRoot ?? "").trim();
  configuredPersonalAssistantRoot = persist ? path.resolve(persist) : "";
  return personalAgentRuntimeStateRoot();
}

/** Clear process-global persist overrides so later `node --test` files see defaults. */
export function resetPersonalAgentRuntimeState() {
  configuredRuntimeStateRoot = process.env.ONMYAGENT_PERSONAL_AGENT_RUNTIME_STATE_ROOT
    ? path.resolve(process.env.ONMYAGENT_PERSONAL_AGENT_RUNTIME_STATE_ROOT)
    : "";
  configuredPersonalAssistantRoot = "";
}

export function personalAgentRuntimeStateRoot() {
  return configuredRuntimeStateRoot || path.join(os.homedir(), ".onmyagent", "runtime-state");
}

export function workspaceIdentity(workspaceRoot) {
  const resolved = path.resolve(String(workspaceRoot ?? "").trim() || os.homedir());
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  return `${safeSegment(path.basename(resolved))}-${hash}`;
}

export function personalAssistantRoot() {
  return configuredPersonalAssistantRoot
    || path.join(personalAgentRuntimeStateRoot(), "personal-assistant");
}

export function personalRunWorkspacesRoot() {
  return path.join(personalAssistantRoot(), "workspaces");
}

export function personalAgentRootAt(runtimeStateRoot, workspaceRoot) {
  const stateRoot = String(runtimeStateRoot ?? "").trim();
  return path.join(
    stateRoot ? path.resolve(stateRoot) : personalAgentRuntimeStateRoot(),
    "personal-assistant",
    "workspaces",
    workspaceIdentity(workspaceRoot),
  );
}

export function personalAgentRoot(workspaceRoot) {
  return path.join(personalAssistantRoot(), "workspaces", workspaceIdentity(workspaceRoot));
}

export function sessionArchiveRoot(workspaceRoot) {
  return path.join(personalAgentRuntimeStateRoot(), "session-archive", "workspaces", workspaceIdentity(workspaceRoot));
}

export function sessionArchiveDbFile(workspaceRoot) {
  return path.join(sessionArchiveRoot(workspaceRoot), "archive.sqlite");
}

export function sessionArchiveLogRoot(workspaceRoot) {
  return path.join(sessionArchiveRoot(workspaceRoot), "logs");
}

export function legacySessionArchiveRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".session-archive");
}

export function legacyPersonalAgentRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".opencode", "personal-assistant");
}

export function runtimeStateWorkspaceRoots(workspaceRoot) {
  const identity = workspaceIdentity(workspaceRoot);
  const runtimeRoot = personalAgentRuntimeStateRoot();
  return {
    workspaceRoot: path.resolve(String(workspaceRoot ?? "").trim() || os.homedir()),
    workspaceIdentity: identity,
    runtimeStateRoot: runtimeRoot,
    personalAgentRoot: personalAgentRoot(workspaceRoot),
    sessionArchiveRoot: sessionArchiveRoot(workspaceRoot),
    sessionArchiveDbFile: sessionArchiveDbFile(workspaceRoot),
    sessionArchiveLogRoot: sessionArchiveLogRoot(workspaceRoot),
    legacyPersonalAgentRoot: legacyPersonalAgentRoot(workspaceRoot),
    legacySessionArchiveRoot: legacySessionArchiveRoot(workspaceRoot),
  };
}

export function personalAgentExtensionsRoot() {
  return path.join(personalAgentRuntimeStateRoot(), "extensions");
}

export function personalAgentExtensionStateFile() {
  return path.join(personalAgentExtensionsRoot(), "state.json");
}
