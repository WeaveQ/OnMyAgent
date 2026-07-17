/**
 * workspace domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "workspaceBootstrap",
  "workspaceSetSelected",
  "workspaceSetRuntimeActive",
  "workspaceCreate",
  "workspaceCreateRemote",
  "workspaceUpdateRemote",
  "workspaceUpdateDisplayName",
  "workspaceForget",
  "workspaceAddAuthorizedRoot",
  "workspaceOpenworkRead",
  "workspaceOnMyAgentRead",
  "workspaceOpenworkWrite",
  "workspaceOnMyAgentWrite",
  "workspaceExportConfig",
  "workspaceImportConfig",
  "codeWorkspaceOpenTargets",
  "codeWorkspaceEnvironment",
  "codeWorkspaceOpen",
  "codeWorkspaceTerminalCreate",
  "codeWorkspaceTerminalWrite",
  "codeWorkspaceTerminalResize",
  "codeWorkspaceTerminalSnapshot",
  "codeWorkspaceTerminalClose",
  "codeWorkspaceFilesList",
  "codeWorkspaceFileRead",
  "codeWorkspaceGitSwitchBranch",
  "codeWorkspaceGitCommit",
  "codeWorkspaceGitPush",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createWorkspaceDomainHandlers({
  readWorkspaceState,
  mutateWorkspaceState,
  normalizeLocalWorkspacePath,
  normalizeWorkspaceEntry,
  localWorkspaceId,
  normalizeWorkspacePathKey,
  ensureDefaultWorkspaceOpencodeConfig,
  writeWorkspaceOnMyAgentConfig,
  defaultWorkspaceOnMyAgentConfig,
  mkdir,
  path,
  stripOnMyAgentWorkspaceMount,
  parseOnMyAgentWorkspaceIdFromUrl,
  discoverOnMyAgentWorkspace,
  onmyagentWorkspaceDisplayName,
  onmyagentRemoteWorkspaceId,
  remoteWorkspaceId,
  readWorkspaceOnMyAgentConfig,
  exportWorkspaceConfig,
  importWorkspaceConfig,
  codeWorkspaceActions,
  codeTerminalManager,
  isDirectory,
  listCodeWorkspaceFiles,
  readCodeWorkspaceFile,
} = {}) {
  return {
  workspaceBootstrap: async (event, args) => {
    return readWorkspaceState();
  },

  workspaceSetSelected: async (event, args) => {
    return mutateWorkspaceState((state) => {
      const workspaceId = typeof args[0] === "string" ? args[0] : "";
      state.selectedId = workspaceId;
      state.activeId = workspaceId || null;
      return state;
    });
  },

  workspaceSetRuntimeActive: async (event, args) => {
    return mutateWorkspaceState((state) => {
      state.watchedId =
        typeof args[0] === "string" && args[0].trim() ? args[0] : null;
      return state;
    });
  },

  workspaceCreate: async (event, args) => {
    const input = args[0] ?? {};
    const rawFolderPath = String(input.folderPath ?? "").trim();
    if (!rawFolderPath) throw new Error("folderPath is required");
    const folderPath = await normalizeLocalWorkspacePath(rawFolderPath);
    await mkdir(folderPath, { recursive: true });
    const preset = String(input.preset ?? "starter");
    const workspace = normalizeWorkspaceEntry({
      id: localWorkspaceId(folderPath),
      name: String(input.name ?? (path.basename(folderPath) || "Workspace")),
      displayName: String(
        input.name ?? (path.basename(folderPath) || "Workspace"),
      ),
      path: folderPath,
      preset,
      workspaceType: "local",
    });
    await mkdir(path.join(folderPath, ".opencode"), { recursive: true });
    await ensureDefaultWorkspaceOpencodeConfig(folderPath);
    await writeWorkspaceOnMyAgentConfig(
      folderPath,
      defaultWorkspaceOnMyAgentConfig(folderPath, preset),
    );

    return mutateWorkspaceState((state) => {
      const workspacePathKey = normalizeWorkspacePathKey(workspace.path);
      state.workspaces = state.workspaces.filter(
        (entry) =>
          entry.id !== workspace.id &&
          normalizeWorkspacePathKey(entry.path) !== workspacePathKey,
      );
      state.workspaces.push(workspace);
      state.selectedId = workspace.id;
      state.activeId = workspace.id;
      state.watchedId = workspace.id;
      return state;
    });
  },

  workspaceCreateRemote: async (event, args) => {
    const input = args[0] ?? {};
    const baseUrl = String(input.baseUrl ?? "").trim();
    if (!baseUrl) throw new Error("baseUrl is required");
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      throw new Error("baseUrl must start with http:// or https://");
    }
    const remoteType =
      input.remoteType === "opencode" ? "opencode" : "onmyagent";
    const directory =
      typeof input.directory === "string" && input.directory.trim()
        ? input.directory.trim()
        : null;
    const rawOnMyAgentHostUrl =
      typeof input.onmyagentHostUrl === "string" &&
      input.onmyagentHostUrl.trim()
        ? input.onmyagentHostUrl.trim()
        : null;
    const onmyagentHostUrl =
      remoteType === "onmyagent"
        ? stripOnMyAgentWorkspaceMount(rawOnMyAgentHostUrl ?? baseUrl)
        : rawOnMyAgentHostUrl;
    const onmyagentWorkspaceId =
      typeof input.onmyagentWorkspaceId === "string" &&
      input.onmyagentWorkspaceId.trim()
        ? input.onmyagentWorkspaceId.trim()
        : remoteType === "onmyagent"
          ? parseOnMyAgentWorkspaceIdFromUrl(rawOnMyAgentHostUrl) ||
            parseOnMyAgentWorkspaceIdFromUrl(baseUrl)
          : null;
    let resolvedOnMyAgentWorkspaceId = onmyagentWorkspaceId;
    let resolvedOnMyAgentWorkspaceName = input.onmyagentWorkspaceName ?? null;
    if (remoteType === "onmyagent" && !resolvedOnMyAgentWorkspaceId) {
      const discovered = await discoverOnMyAgentWorkspace({
        hostUrl: onmyagentHostUrl ?? baseUrl,
        token: input.onmyagentToken,
        hostToken: input.onmyagentHostToken,
        directory,
      });
      if (!discovered?.id) {
        throw new Error(
          directory
            ? `OnMyAgent server has no workspace matching ${directory}.`
            : "OnMyAgent server returned no workspaces.",
        );
      }
      resolvedOnMyAgentWorkspaceId = String(discovered.id).trim();
      resolvedOnMyAgentWorkspaceName =
        onmyagentWorkspaceDisplayName(discovered);
    }
    const id =
      remoteType === "onmyagent"
        ? onmyagentRemoteWorkspaceId(
            onmyagentHostUrl ?? baseUrl,
            resolvedOnMyAgentWorkspaceId,
          )
        : remoteWorkspaceId(baseUrl, directory);
    const workspace = normalizeWorkspaceEntry({
      id,
      name: String(
        input.displayName ??
          resolvedOnMyAgentWorkspaceName ??
          "Remote workspace",
      ),
      displayName: input.displayName ?? null,
      path: directory ?? "",
      preset: "remote",
      workspaceType: "remote",
      remoteType,
      baseUrl:
        remoteType === "onmyagent" ? (onmyagentHostUrl ?? baseUrl) : baseUrl,
      directory,
      onmyagentHostUrl,
      onmyagentToken: input.onmyagentToken ?? null,
      onmyagentClientToken: input.onmyagentClientToken ?? null,
      onmyagentHostToken: input.onmyagentHostToken ?? null,
      onmyagentWorkspaceId: resolvedOnMyAgentWorkspaceId,
      onmyagentWorkspaceName: resolvedOnMyAgentWorkspaceName,
      sandboxBackend: input.sandboxBackend ?? null,
      sandboxRunId: input.sandboxRunId ?? null,
      sandboxContainerName: input.sandboxContainerName ?? null,
    });
    return mutateWorkspaceState((state) => {
      state.workspaces = state.workspaces.filter(
        (entry) => entry.id !== workspace.id,
      );
      state.workspaces.push(workspace);
      state.selectedId = workspace.id;
      state.activeId = workspace.id;
      return state;
    });
  },

  workspaceUpdateRemote: async (event, args) => {
    const input = args[0] ?? {};
    const workspaceId = String(input.workspaceId ?? "").trim();
    if (!workspaceId) throw new Error("workspaceId is required");
    const { workspaceId: _workspaceId, ...patch } = input;
    return mutateWorkspaceState(async (state) => {
      const existing = state.workspaces.find(
        (entry) => entry.id === workspaceId,
      );
      if (!existing) return state;

      let nextWorkspace = { ...existing, ...patch };
      const nextRemoteType =
        nextWorkspace.remoteType === "opencode" ? "opencode" : "onmyagent";
      if (nextRemoteType === "onmyagent") {
        const rawHostUrl =
          typeof nextWorkspace.onmyagentHostUrl === "string" &&
          nextWorkspace.onmyagentHostUrl.trim()
            ? nextWorkspace.onmyagentHostUrl.trim()
            : null;
        const nextBaseUrl = String(nextWorkspace.baseUrl ?? "").trim();
        const hostUrl = stripOnMyAgentWorkspaceMount(
          rawHostUrl ?? nextBaseUrl,
        );
        const directory =
          typeof nextWorkspace.directory === "string" &&
          nextWorkspace.directory.trim()
            ? nextWorkspace.directory.trim()
            : null;
        const parsedWorkspaceId =
          parseOnMyAgentWorkspaceIdFromUrl(rawHostUrl) ||
          parseOnMyAgentWorkspaceIdFromUrl(nextBaseUrl);
        let remoteWorkspaceId =
          parsedWorkspaceId ||
          (typeof nextWorkspace.onmyagentWorkspaceId === "string" &&
          nextWorkspace.onmyagentWorkspaceId.trim()
            ? nextWorkspace.onmyagentWorkspaceId.trim()
            : null);
        let remoteWorkspaceName = nextWorkspace.onmyagentWorkspaceName ?? null;
        if (!remoteWorkspaceId) {
          const discovered = await discoverOnMyAgentWorkspace({
            hostUrl: hostUrl ?? nextBaseUrl,
            token: nextWorkspace.onmyagentToken,
            hostToken: nextWorkspace.onmyagentHostToken,
            directory,
          });
          if (!discovered?.id) {
            throw new Error(
              directory
                ? `OnMyAgent server has no workspace matching ${directory}.`
                : "OnMyAgent server returned no workspaces.",
            );
          }
          remoteWorkspaceId = String(discovered.id).trim();
          remoteWorkspaceName = onmyagentWorkspaceDisplayName(discovered);
        }
        const nextId = onmyagentRemoteWorkspaceId(
          hostUrl ?? nextBaseUrl,
          remoteWorkspaceId,
        );
        nextWorkspace = normalizeWorkspaceEntry({
          ...nextWorkspace,
          id: nextId,
          baseUrl: hostUrl ?? nextBaseUrl,
          onmyagentHostUrl: hostUrl,
          directory,
          remoteType: "onmyagent",
          onmyagentWorkspaceId: remoteWorkspaceId,
          onmyagentWorkspaceName: remoteWorkspaceName,
        });
        if (nextId !== workspaceId) {
          if (state.selectedId === workspaceId) state.selectedId = nextId;
          if (state.activeId === workspaceId) state.activeId = nextId;
          if (state.watchedId === workspaceId) state.watchedId = nextId;
        }
      }

      state.workspaces = state.workspaces.map((entry) =>
        entry.id === workspaceId ? nextWorkspace : entry,
      );
      return state;
    });
  },

  workspaceUpdateDisplayName: async (event, args) => {
    const input = args[0] ?? {};
    const workspaceId = String(input.workspaceId ?? "").trim();
    if (!workspaceId) throw new Error("workspaceId is required");
    return mutateWorkspaceState((state) => {
      state.workspaces = state.workspaces.map((entry) =>
        entry.id === workspaceId
          ? { ...entry, displayName: input.displayName ?? null }
          : entry,
      );
      return state;
    });
  },

  workspaceForget: async (event, args) => {
    const workspaceId = String(args[0] ?? "").trim();
    if (!workspaceId) throw new Error("workspaceId is required");
    return mutateWorkspaceState((state) => {
      state.workspaces = state.workspaces.filter(
        (entry) => entry.id !== workspaceId,
      );
      if (state.selectedId === workspaceId) state.selectedId = "";
      if (state.activeId === workspaceId) state.activeId = null;
      if (state.watchedId === workspaceId) state.watchedId = null;
      return state;
    });
  },

  workspaceAddAuthorizedRoot: async (event, args) => {
    const input = args[0] ?? {};
    const workspacePath = String(input.workspacePath ?? "").trim();
    const authorizedRoot = String(
      input.folderPath ?? input.authorizedRoot ?? "",
    ).trim();
    if (!workspacePath || !authorizedRoot) {
      throw new Error("workspacePath and folderPath are required");
    }
    const config = await readWorkspaceOnMyAgentConfig(workspacePath);
    if (!Array.isArray(config.authorizedRoots)) {
      config.authorizedRoots = [];
    }
    if (!config.authorizedRoots.includes(authorizedRoot)) {
      config.authorizedRoots.push(authorizedRoot);
    }
    return writeWorkspaceOnMyAgentConfig(workspacePath, config);
  },

  // shared: workspaceOpenworkRead, workspaceOnMyAgentRead
  workspaceOpenworkRead: async (event, args) => {
    return readWorkspaceOnMyAgentConfig(
      String(args[0]?.workspacePath ?? "").trim(),
    );
  },
  workspaceOnMyAgentRead: async (event, args) => {
    return readWorkspaceOnMyAgentConfig(
      String(args[0]?.workspacePath ?? "").trim(),
    );
  },

  // shared: workspaceOpenworkWrite, workspaceOnMyAgentWrite
  workspaceOpenworkWrite: async (event, args) => {
    return writeWorkspaceOnMyAgentConfig(
      String(args[0]?.workspacePath ?? "").trim(),
      args[0]?.config ?? defaultWorkspaceOnMyAgentConfig(""),
    );
  },
  workspaceOnMyAgentWrite: async (event, args) => {
    return writeWorkspaceOnMyAgentConfig(
      String(args[0]?.workspacePath ?? "").trim(),
      args[0]?.config ?? defaultWorkspaceOnMyAgentConfig(""),
    );
  },

  workspaceExportConfig: async (event, args) => {
    const input = args[0] ?? {};
    const workspaceId = String(input.workspaceId ?? "").trim();
    const outputPath = String(input.outputPath ?? "").trim();
    if (!workspaceId) throw new Error("workspaceId is required");
    if (!outputPath) throw new Error("outputPath is required");
    const state = await readWorkspaceState();
    const workspace = state.workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace) throw new Error("Unknown workspaceId");
    return exportWorkspaceConfig({ workspace, outputPath });
  },

  workspaceImportConfig: async (event, args) => {
    const input = args[0] ?? {};
    const archivePath = String(input.archivePath ?? "").trim();
    const targetDirRaw = String(input.targetDir ?? "").trim();
    if (!archivePath) throw new Error("archivePath is required");
    if (!targetDirRaw) throw new Error("targetDir is required");
    const targetDir = await normalizeLocalWorkspacePath(targetDirRaw);
    const imported = await importWorkspaceConfig({
      archivePath,
      targetDir,
      name: input.name ?? null,
    });
    const workspace = normalizeWorkspaceEntry({
      id: localWorkspaceId(targetDir),
      name: imported.workspaceName,
      displayName: null,
      path: targetDir,
      preset: imported.preset,
      workspaceType: "local",
    });
    return mutateWorkspaceState((state) => {
      const workspacePathKey = normalizeWorkspacePathKey(workspace.path);
      state.workspaces = state.workspaces.filter(
        (entry) =>
          entry.id !== workspace.id &&
          normalizeWorkspacePathKey(entry.path) !== workspacePathKey,
      );
      state.workspaces.push(workspace);
      state.selectedId = workspace.id;
      state.activeId = workspace.id;
      state.watchedId = workspace.id;
      return state;
    });
  },

  codeWorkspaceOpenTargets: async (event, args) => {
    return codeWorkspaceActions.codeWorkspaceOpenTargets();
  },

  codeWorkspaceEnvironment: async (event, args) => {
    return codeWorkspaceActions.codeWorkspaceEnvironment(args[0]);
  },

  codeWorkspaceOpen: async (event, args) => {
    return codeWorkspaceActions.openCodeWorkspace(args[0]);
  },

  codeWorkspaceTerminalCreate: async (event, args) => {
    const workspacePath = await codeWorkspaceActions.resolveCodeWorkspacePath(args[0]);
    if (!workspacePath || !(await isDirectory(workspacePath))) {
      throw new Error("Workspace path is not a directory.");
    }
    return codeTerminalManager.create({ workspacePath });
  },

  codeWorkspaceTerminalWrite: async (event, args) => {
    return codeTerminalManager.write(args[0]);
  },

  codeWorkspaceTerminalResize: async (event, args) => {
    return codeTerminalManager.resize(args[0]);
  },

  codeWorkspaceTerminalSnapshot: async (event, args) => {
    return codeTerminalManager.snapshot(args[0]);
  },

  codeWorkspaceTerminalClose: async (event, args) => {
    return codeTerminalManager.close(args[0]);
  },

  codeWorkspaceFilesList: async (event, args) => {
    return listCodeWorkspaceFiles(args[0]);
  },

  codeWorkspaceFileRead: async (event, args) => {
    return readCodeWorkspaceFile(args[0]);
  },

  codeWorkspaceGitSwitchBranch: async (event, args) => {
    return codeWorkspaceActions.codeWorkspaceGitSwitchBranch(args[0]);
  },

  codeWorkspaceGitCommit: async (event, args) => {
    return codeWorkspaceActions.codeWorkspaceGitCommit(args[0]);
  },

  codeWorkspaceGitPush: async (event, args) => {
    return codeWorkspaceActions.codeWorkspaceGitPush(args[0]);
  },

  };
}
