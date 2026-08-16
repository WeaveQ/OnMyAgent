/**
 * Desktop workspace list + bootstrap config store.
 * Extracted from main.mjs so the composition root stays thin.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./desktop-json.mjs";
import {
  defaultWorkspaceOnMyAgentConfig,
  execResult,
  normalizeDesktopBootstrapConfig,
  normalizeWorkspaceEntry,
} from "./desktop-main-helpers.mjs";
import {
  onmyagentRemoteWorkspaceId,
  parseOnMyAgentWorkspaceIdFromUrl,
  stripOnMyAgentWorkspaceMount,
} from "./desktop-workspace-ids.mjs";
import { selectOnMyAgentWorkspaceForConnection } from "./remote-workspace.mjs";

/**
 * @param {{
 *   app: { getPath: (name: string) => string },
 *   desktopBootstrapPath: () => string,
 *   forceRequireSignin: boolean,
 *   defaultDenBaseUrl: string,
 *   defaultRequireSignin: boolean,
 *   emptyWorkspaceList: object,
 * }} deps
 */
export function createDesktopWorkspaceStore({
  app,
  desktopBootstrapPath,
  forceRequireSignin,
  defaultDenBaseUrl,
  defaultRequireSignin,
  emptyWorkspaceList,
}) {
  function workspaceStatePath() {
    return path.join(app.getPath("userData"), "onmyagent-workspaces.json");
  }

  function legacyElectronWorkspaceStatePath() {
    return path.join(app.getPath("userData"), "workspace-state.json");
  }
  async function migrateLegacyElectronWorkspaceStateIfNeeded() {
    const current = workspaceStatePath();
    const legacy = legacyElectronWorkspaceStatePath();
    try {
      if (existsSync(current)) return false;
      if (!existsSync(legacy)) return false;
      await mkdir(path.dirname(current), { recursive: true });
      const raw = await readFile(legacy, "utf8");
      await writeFile(current, raw, "utf8");
      console.info(
        "[migration] copied workspace-state.json → onmyagent-workspaces.json",
      );
      return true;
    } catch (error) {
      console.warn(
        "[migration] legacy Electron workspace-state copy failed",
        error,
      );
      return false;
    }
  }

  async function pathExists(targetPath) {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async function isDirectory(targetPath) {
    try {
      return (await stat(targetPath)).isDirectory();
    } catch {
      return false;
    }
  }

  function bootstrapNormalize(input) {
    return normalizeDesktopBootstrapConfig(input, {
      forceRequireSignin: forceRequireSignin,
    });
  }

  async function getDesktopBootstrapConfig() {
    const configPath = desktopBootstrapPath();
    try {
      const raw = await readFile(configPath, "utf8");
      return bootstrapNormalize(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[desktop-bootstrap] falling back to defaults", {
          path: configPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        baseUrl: defaultDenBaseUrl,
        apiBaseUrl: null,
        requireSignin: defaultRequireSignin,
      };
    }
  }

  async function debugDesktopBootstrapConfig() {
    const configPath = desktopBootstrapPath();
    const result = {
      path: configPath,
      home: os.homedir(),
      envHome: process.env.HOME ?? null,
      envOverride: process.env.ONMYAGENT_DESKTOP_BOOTSTRAP_PATH ?? null,
      exists: existsSync(configPath),
      raw: null,
      parsed: null,
      normalized: null,
      error: null,
    };

    try {
      result.raw = await readFile(configPath, "utf8");
      result.parsed = JSON.parse(result.raw);
      result.normalized = bootstrapNormalize(result.parsed);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  async function setDesktopBootstrapConfig(config) {
    const normalized = bootstrapNormalize(config);
    const outputPath = desktopBootstrapPath();
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      "utf8",
    );
    return normalized;
  }

  async function workspaceOpencodeConfigPath(workspacePath) {
    const candidates = [
      path.join(workspacePath, "opencode.jsonc"),
      path.join(workspacePath, "opencode.json"),
      path.join(workspacePath, ".opencode", "opencode.jsonc"),
      path.join(workspacePath, ".opencode", "opencode.json"),
    ];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }
    return candidates[0];
  }

  async function ensureDefaultWorkspaceOpencodeConfig(workspacePath) {
    const configPath = await workspaceOpencodeConfigPath(workspacePath);
    if (await pathExists(configPath)) return false;
    await writeJsonFileAtomic(configPath, {
      $schema: "https://opencode.ai/config.json",
      default_agent: "onmyagent",
    });
    return true;
  }

  async function normalizeLocalWorkspacePath(rawPath) {
    const trimmed = String(rawPath ?? "").trim();
    if (!trimmed) return "";
    const expanded =
      trimmed === "~"
        ? os.homedir()
        : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
          ? path.join(os.homedir(), trimmed.slice(2))
          : trimmed;
    const resolved = path.resolve(expanded);
    return realpath(resolved).catch(() => resolved);
  }

  async function fetchOnMyAgentWorkspaceList(hostUrl, token, hostToken) {
    const url = `${String(hostUrl ?? "").replace(/\/+$/, "")}/workspaces`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const headers = new Headers();
    const bearerToken = String(token ?? "").trim();
    const hostAuthToken = String(hostToken ?? "").trim();
    if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
    if (hostAuthToken) headers.set("X-OnMyAgent-Host-Token", hostAuthToken);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new Error(
          `OnMyAgent workspace discovery failed (${response.status} ${response.statusText || "HTTP error"})`,
        );
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function discoverOnMyAgentWorkspace({
    hostUrl,
    token,
    hostToken,
    directory,
  }) {
    const list = await fetchOnMyAgentWorkspaceList(hostUrl, token, hostToken);
    return selectOnMyAgentWorkspaceForConnection(list, directory);
  }

  async function readWorkspaceOnMyAgentConfig(workspacePath) {
    const onmyagentPath = path.join(workspacePath, ".opencode", "onmyagent.json");
    if (!(await pathExists(onmyagentPath))) {
      return defaultWorkspaceOnMyAgentConfig(workspacePath);
    }
    const raw = await readFile(onmyagentPath, "utf8");
    return JSON.parse(raw);
  }

  async function writeWorkspaceOnMyAgentConfig(workspacePath, config) {
    const onmyagentPath = path.join(workspacePath, ".opencode", "onmyagent.json");
    await mkdir(path.dirname(onmyagentPath), { recursive: true });
    await writeFile(onmyagentPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return execResult(true, `Wrote ${onmyagentPath}`);
  }

  async function readWorkspaceState() {
    const state = await readJsonFile(workspaceStatePath(), emptyWorkspaceList);
    const selectedId =
      typeof state?.selectedId === "string"
        ? state.selectedId
        : typeof state?.selectedWorkspaceId === "string"
          ? state.selectedWorkspaceId
          : typeof state?.activeId === "string"
            ? state.activeId
            : "";
    const watchedId =
      typeof state?.watchedId === "string"
        ? state.watchedId
        : typeof state?.watchedWorkspaceId === "string"
          ? state.watchedWorkspaceId
          : null;
    const activeId = typeof state?.activeId === "string" ? state.activeId : null;
    const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : [];
    let changed = false;
    const idMap = new Map();
    const migratedWorkspaces = workspaces.map((entry) => {
      const workspace =
        entry && typeof entry === "object"
          ? entry
          : normalizeWorkspaceEntry(entry ?? {});
      if (
        workspace.workspaceType !== "remote" ||
        workspace.remoteType !== "onmyagent"
      )
        return workspace;

      const remoteWorkspaceId =
        String(workspace.onmyagentWorkspaceId ?? "").trim() ||
        parseOnMyAgentWorkspaceIdFromUrl(workspace.onmyagentHostUrl) ||
        parseOnMyAgentWorkspaceIdFromUrl(workspace.baseUrl);
      if (!remoteWorkspaceId) return workspace;

      const hostUrl =
        stripOnMyAgentWorkspaceMount(workspace.onmyagentHostUrl) ||
        stripOnMyAgentWorkspaceMount(workspace.baseUrl);
      const nextId = onmyagentRemoteWorkspaceId(
        hostUrl ?? workspace.baseUrl,
        remoteWorkspaceId,
      );
      idMap.set(workspace.id, nextId);
      const nextWorkspace = {
        ...workspace,
        id: nextId,
        baseUrl: hostUrl,
        onmyagentWorkspaceId: remoteWorkspaceId,
        onmyagentHostUrl: hostUrl,
      };
      if (
        workspace.id !== nextWorkspace.id ||
        workspace.baseUrl !== nextWorkspace.baseUrl ||
        workspace.onmyagentWorkspaceId !== nextWorkspace.onmyagentWorkspaceId ||
        workspace.onmyagentHostUrl !== nextWorkspace.onmyagentHostUrl
      ) {
        changed = true;
      }
      return nextWorkspace;
    });
    // Older desktop state can contain multiple OnMyAgent remote entries that
    // normalize to the same `rem_<workspaceId>` after stripping worker mounts.
    // Collapse them here so React never receives duplicate workspace keys.
    const workspaceIndexById = new Map();
    const dedupedWorkspaces = [];
    for (const workspace of migratedWorkspaces) {
      const workspaceId = String(workspace?.id ?? "").trim();
      if (!workspaceId) {
        dedupedWorkspaces.push(workspace);
        continue;
      }
      const existingIndex = workspaceIndexById.get(workspaceId);
      if (existingIndex === undefined) {
        workspaceIndexById.set(workspaceId, dedupedWorkspaces.length);
        dedupedWorkspaces.push(workspace);
        continue;
      }
      // Keep the later entry: normal mutations replace-then-push refreshed
      // remote workspaces, and there is no persisted updatedAt to compare.
      dedupedWorkspaces[existingIndex] = workspace;
      changed = true;
    }

    const migratedSelectedId = idMap.get(selectedId) ?? selectedId;
    const migratedWatchedId = watchedId
      ? (idMap.get(watchedId) ?? watchedId)
      : null;
    const migratedActiveId = activeId ? (idMap.get(activeId) ?? activeId) : null;
    if (
      migratedSelectedId !== selectedId ||
      migratedWatchedId !== watchedId ||
      migratedActiveId !== activeId
    )
      changed = true;

    const nextState = {
      selectedId: migratedSelectedId,
      watchedId: migratedWatchedId,
      activeId: migratedActiveId,
      workspaces: dedupedWorkspaces,
    };

    if (changed) {
      return writeWorkspaceState(nextState);
    }
    return nextState;
  }

  async function writeWorkspaceState(nextState) {
    const outputPath = workspaceStatePath();
    const selectedId = String(nextState?.selectedId ?? nextState?.activeId ?? "");
    const watchedId =
      typeof nextState?.watchedId === "string" ? nextState.watchedId : "";
    const output = {
      ...nextState,
      // Tauri's Rust state uses selectedWorkspaceId/watchedWorkspaceId on disk
      // (with activeId as a legacy alias). Keep Electron's selectedId/watchedId
      // too so older Electron builds can still read the same file.
      selectedId,
      selectedWorkspaceId: selectedId,
      watchedId: watchedId || null,
      watchedWorkspaceId: watchedId,
      activeId: selectedId || null,
    };
    await writeJsonFileAtomic(outputPath, output);
    return output;
  }

  return {
    workspaceStatePath,
    legacyElectronWorkspaceStatePath,
    migrateLegacyElectronWorkspaceStateIfNeeded,
    pathExists,
    isDirectory,
    getDesktopBootstrapConfig,
    debugDesktopBootstrapConfig,
    setDesktopBootstrapConfig,
    workspaceOpencodeConfigPath,
    ensureDefaultWorkspaceOpencodeConfig,
    normalizeLocalWorkspacePath,
    fetchOnMyAgentWorkspaceList,
    discoverOnMyAgentWorkspace,
    readWorkspaceOnMyAgentConfig,
    writeWorkspaceOnMyAgentConfig,
    readWorkspaceState,
    writeWorkspaceState,
  };
}
