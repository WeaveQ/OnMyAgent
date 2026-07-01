import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

let configuredRuntimeStateRoot = process.env.ONMYAGENT_PERSONAL_AGENT_RUNTIME_STATE_ROOT
  ? path.resolve(process.env.ONMYAGENT_PERSONAL_AGENT_RUNTIME_STATE_ROOT)
  : "";

function safeSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "workspace";
}

export function configurePersonalAgentRuntimeState(options = {}) {
  const root = String(options.runtimeStateRoot ?? "").trim();
  if (root) {
    configuredRuntimeStateRoot = path.resolve(root);
    return configuredRuntimeStateRoot;
  }
  const userDataDir = String(options.userDataDir ?? "").trim();
  if (userDataDir) {
    configuredRuntimeStateRoot = path.join(userDataDir, "runtime-state");
    return configuredRuntimeStateRoot;
  }
  return personalAgentRuntimeStateRoot();
}

export function personalAgentRuntimeStateRoot() {
  return configuredRuntimeStateRoot || path.join(os.homedir(), ".onmyagent", "runtime-state");
}

export function workspaceIdentity(workspaceRoot) {
  const resolved = path.resolve(String(workspaceRoot ?? "").trim() || os.homedir());
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  return `${safeSegment(path.basename(resolved))}-${hash}`;
}

export function personalAgentRoot(workspaceRoot) {
  return path.join(personalAgentRuntimeStateRoot(), "personal-assistant", "workspaces", workspaceIdentity(workspaceRoot));
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
