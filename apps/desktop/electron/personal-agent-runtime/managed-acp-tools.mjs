import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { personalAgentRuntimeStateRoot } from "./runtime-state.mjs";

export const MANAGED_ACP_TOOLS = Object.freeze({
  codex: Object.freeze({ id: "codex-acp", packageName: "@agentclientprotocol/codex-acp", version: "1.0.1", binName: "codex-acp" }),
  claude: Object.freeze({ id: "claude-agent-acp", packageName: "@agentclientprotocol/claude-agent-acp", version: "0.52.0", binName: "claude-agent-acp" }),
});

function platformTarget() {
  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  return `${process.platform}-${arch}`;
}

export function managedAcpToolSpec(provider) {
  return MANAGED_ACP_TOOLS[provider] ?? null;
}

export function managedAcpToolRoot(provider) {
  const spec = managedAcpToolSpec(provider);
  if (!spec) return "";
  return path.join(personalAgentRuntimeStateRoot(), "managed-resources", "acp", spec.id, spec.version, platformTarget());
}

export function managedAcpBinPath(provider) {
  const spec = managedAcpToolSpec(provider);
  if (!spec) return "";
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(managedAcpToolRoot(provider), "node_modules", ".bin", `${spec.binName}${suffix}`);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => resolve({ ok: false, code: null, stdout, stderr: error.message }));
    child.once("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

export async function ensureManagedAcpTool(provider) {
  const spec = managedAcpToolSpec(provider);
  if (!spec) return null;
  const root = managedAcpToolRoot(provider);
  const binPath = managedAcpBinPath(provider);
  if (await exists(binPath)) {
    return { ...spec, root, binPath, installed: true, prepared: false };
  }
  await mkdir(root, { recursive: true });
  const pkg = `${spec.packageName}@${spec.version}`;
  const install = await run("npm", ["install", "--prefix", root, "--no-save", "--no-audit", "--no-fund", pkg], root);
  if (!install.ok || !(await exists(binPath))) {
    const detail = [install.stderr, install.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Failed to prepare ${spec.id}: ${detail || `npm exited ${install.code}`}`);
  }
  return { ...spec, root, binPath, installed: true, prepared: true };
}

export async function resolveManagedAcpTool(provider) {
  const spec = managedAcpToolSpec(provider);
  if (!spec) return null;
  const root = managedAcpToolRoot(provider);
  const binPath = managedAcpBinPath(provider);
  return { ...spec, root, binPath, installed: await exists(binPath), prepared: false };
}

// Read the installed package version from the managed install's node_modules
// manifest so we can compare it against the expected version.
async function readInstalledVersion(provider) {
  const spec = managedAcpToolSpec(provider);
  if (!spec) return null;
  const manifest = path.join(managedAcpToolRoot(provider), "node_modules", spec.packageName, "package.json");
  try {
    const raw = await readFile(manifest, "utf8");
    const parsed = JSON.parse(raw);
    const version = String(parsed?.version ?? "").trim();
    return version || null;
  } catch {
    return null;
  }
}

/**
 * Validate the installed managed ACP tool against the expected version.
 * Returns { provider, expected, installed, installedVersion, match, reason }.
 * When the tool is missing or the version differs, `match` is false and the
 * caller should prompt a reinstall (via `ensureManagedAcpTool`).
 */
export async function validateManagedAcpTool(provider) {
  const spec = managedAcpToolSpec(provider);
  if (!spec) return { provider, expected: null, installed: false, installedVersion: null, match: false, reason: "unknown_provider" };
  const binPath = managedAcpBinPath(provider);
  const installed = await exists(binPath);
  if (!installed) {
    return { provider, expected: spec.version, installed: false, installedVersion: null, match: false, reason: "not_installed" };
  }
  const installedVersion = await readInstalledVersion(provider);
  if (!installedVersion) {
    // Binary present but manifest unreadable — treat as a match to avoid
    // needless reinstalls, but surface the ambiguity.
    return { provider, expected: spec.version, installed: true, installedVersion: null, match: true, reason: "version_unknown" };
  }
  const match = installedVersion === spec.version;
  return {
    provider,
    expected: spec.version,
    installed: true,
    installedVersion,
    match,
    reason: match ? "ok" : "version_mismatch",
  };
}
