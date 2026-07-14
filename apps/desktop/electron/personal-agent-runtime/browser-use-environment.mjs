import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { desktopRuntimeTarget } from "../browser-use-runtime-status.mjs";

function ownerIdForRun({ workspaceRoot, conversationId, runId }) {
  const conversationKey = String(conversationId ?? "").trim() || String(runId ?? "").trim();
  if (!String(workspaceRoot ?? "").trim() || !conversationKey) {
    throw new Error("Browser Use environment requires workspaceRoot and conversationId or runId");
  }
  const digest = createHash("sha256")
    .update(`${path.resolve(workspaceRoot)}\0${conversationKey}`)
    .digest("hex")
    .slice(0, 32);
  return `conversation:${digest}`;
}

export function createBrowserUseEnvironmentManager({
  runtimeRoot,
  resourceRoot,
  userDataDir,
  environmentForOwner,
  platform = process.platform,
  arch = process.arch,
}) {
  if (typeof environmentForOwner !== "function") {
    throw new Error("Browser Use broker environment provider is required");
  }
  const target = desktopRuntimeTarget(platform, arch);
  const launcherDir = path.join(runtimeRoot, target, "bin");
  const launcherPath = path.join(
    launcherDir,
    platform === "win32" ? "browser-use.cmd" : "browser-use",
  );
  const helperSource = path.join(resourceRoot, "agent_helpers.py");
  const shortRuntimeRoot = platform === "win32" ? os.tmpdir() : "/tmp";

  async function environmentForRun(input) {
    if (!existsSync(launcherPath)) {
      throw new Error(`Bundled Browser Use launcher is missing: ${launcherPath}`);
    }
    if (!existsSync(helperSource)) {
      throw new Error(`OnMyAgent Browser Use helper is missing: ${helperSource}`);
    }
    const ownerId = ownerIdForRun(input);
    const ownerKey = ownerId.slice("conversation:".length);
    const workspaceRoot = path.join(
      userDataDir,
      "runtime-state",
      "browser-use",
      "workspaces",
      ownerKey,
    );
    await mkdir(workspaceRoot, { recursive: true });
    await copyFile(helperSource, path.join(workspaceRoot, "agent_helpers.py"));
    const brokerEnvironment = await environmentForOwner(ownerId);
    return {
      ownerId,
      workspaceRoot,
      pathEntries: [launcherDir],
      environment: {
        ...brokerEnvironment,
        ANONYMIZED_TELEMETRY: "false",
        BH_AGENT_WORKSPACE: workspaceRoot,
        BH_DOMAIN_SKILLS: "0",
        BH_HOME: path.join(workspaceRoot, "home"),
        BH_RUNTIME_DIR: path.join(shortRuntimeRoot, "onmyagent-browser-use", ownerKey),
        BH_TMP_DIR: path.join(workspaceRoot, "tmp"),
      },
    };
  }

  return { environmentForRun };
}
