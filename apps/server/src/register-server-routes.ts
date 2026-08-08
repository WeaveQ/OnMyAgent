import type {
  ApprovalRequest,
  ServerConfig,
  WorkspaceInfo,
  Actor,
  ReloadReason,
  ReloadTrigger,
} from "@onmyagent/types/server";
import type { TokenService } from "./services/tokens.js";
import type { EnvService } from "./services/env-file.js";
import type { FileSessionStore } from "./services/file-sessions.js";
import type { ReloadEventStore } from "./services/events.js";
import type { RequestContext, Route } from "./routes/route-core.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerDevUiRoutes } from "./routes/dev-ui-routes.js";
import { registerRuntimeRoutes } from "./routes/runtime-routes.js";
import { registerWorkspaceImportExportRoutes } from "./routes/workspace-import-export-routes.js";
import { registerExperimentalExtensionRoutes } from "./routes/experimental-extension-routes.js";
import { registerTokenRoutes } from "./routes/token-routes.js";
import { registerEnvRoutes } from "./routes/env-routes.js";
import { registerCommandRoutes } from "./routes/command-routes.js";
import { registerAutomationRoutes } from "./routes/automation-routes.js";
import { registerPluginRoutes } from "./routes/plugin-routes.js";
import { registerArtifactPluginRoutes } from "./routes/artifact-plugin-routes.js";
import { registerSkillRoutes } from "./routes/skill-routes.js";
import { registerWorkBuddyExpertRoutes } from "./routes/workbuddy-expert-routes.js";
import { registerMcpRoutes } from "./routes/mcp-routes.js";
import { registerApprovalRoutes } from "./routes/approval-routes.js";
import { registerWorkspaceObservabilityRoutes } from "./routes/workspace-observability-routes.js";
import { registerWorkspaceSessionArchiveRoutes } from "./routes/workspace-session-archive-routes.js";
import { registerWorkspaceSessionRoutes } from "./routes/workspace-session-routes.js";
import { registerWorkspaceRoutes } from "./routes/workspace-routes.js";
import { registerWorkspaceConfigRoutes } from "./routes/workspace-config-routes.js";
import { registerWorkspaceArtifactRoutes } from "./routes/workspace-artifact-routes.js";
import { registerWorkspaceFileRoutes } from "./routes/workspace-file-routes.js";
import {
  registerWorkspaceBlueprintRoutes,
  type BlueprintMaterializeResult,
} from "./routes/workspace-blueprint-routes.js";
import { registerWorkspaceFileSessionRoutes } from "./routes/workspace-file-session-routes.js";
import { readJsonBody } from "./core/request-body.js";
import { ensureWritable, requireClientScope, scopeRank } from "./core/server-scope.js";
import {
  opencodeConfigPath,
  globalSkillsDir,
} from "./workspace/workspace-files.js";
import {
  normalizeWorkspaceRelativePath,
  isSupportedWorkspaceTextFilePath,
  resolveWorkspaceArtifactTargets,
  resolveInboxDir,
  resolveOutboxDir,
  resolveSafeChildPath,
  decodeArtifactId,
  decodeInboxId,
  listArtifacts,
  listInbox,
  contentTypeForPath,
  contentKindForPath,
  fileRevision,
} from "./workspace/path-utils.js";
import { logoutMcpAuth } from "./services/opencode-proxy.js";
import {
  listWorkspaceSessions,
  readWorkspaceSession,
  readWorkspaceSessionMessages,
  readWorkspaceSessionSnapshot,
  deleteWorkspaceSession,
} from "./services/workspace-sessions.js";
import {
  startAutomationTask,
  waitForAutomationSession,
  reconcileAutomationRuns,
} from "./services/automation-runner.js";

export type RegisterServerRoutesInput = {
  routes: Route[];
  config: ServerConfig;
  tokens: TokenService;
  env: EnvService;
  fileSessions: FileSessionStore;
  serverVersion: string;
  opencodeVersion: string;
  maxFileBytes: number;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  serializeWorkspace: (workspace: ServerConfig["workspaces"][number]) => unknown;
  requireHost: (
    request: Request,
    config: ServerConfig,
    tokens: TokenService,
  ) => Promise<Actor>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  emitReloadEvent: (
    reloadEvents: ReloadEventStore,
    workspace: WorkspaceInfo,
    reason: ReloadReason,
    trigger?: ReloadTrigger,
  ) => void;
  buildConfigTrigger: (path: string) => ReloadTrigger;
  persistServerWorkspaceState: (config: ServerConfig) => Promise<boolean>;
  onWorkspacesChanged: () => void;
  reloadOpencodeEngine: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<void>;
  readOpencodeConfig: (workspaceRoot: string) => Promise<Record<string, unknown>>;
  readOnMyAgentConfig: (workspaceRoot: string) => Promise<Record<string, unknown>>;
  writeOnMyAgentConfig: (
    workspaceRoot: string,
    payload: Record<string, unknown>,
    merge: boolean,
  ) => Promise<void>;
  materializeBlueprintSessions: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
  ) => Promise<BlueprintMaterializeResult>;
  recordWorkspaceFileEvent: (
    workspaceId: string,
    input: {
      type: "write" | "delete" | "rename" | "mkdir";
      path: string;
      toPath?: string;
      revision?: string;
    },
  ) => unknown;
  onGlobalSkillsChanged?: () => Promise<unknown>;
};

/**
 * Composition-root route registration batch. Keeps server.ts thin; behavior is
 * identical to the former inline createRoutes registration block.
 */
export function registerServerRoutes(input: RegisterServerRoutesInput): void {
  const {
    routes,
    config,
    tokens,
    env,
    fileSessions,
    serverVersion,
    opencodeVersion,
    maxFileBytes,
    resolveWorkspace,
    serializeWorkspace,
    requireHost,
    requireApproval,
    emitReloadEvent,
    buildConfigTrigger,
    persistServerWorkspaceState,
    onWorkspacesChanged,
    reloadOpencodeEngine,
    readOpencodeConfig,
    readOnMyAgentConfig,
    writeOnMyAgentConfig,
    materializeBlueprintSessions,
    recordWorkspaceFileEvent,
    onGlobalSkillsChanged,
  } = input;

  registerSystemRoutes({
    routes,
    config,
    serverVersion,
    opencodeVersion,
    resolveWorkspace,
    serializeWorkspace,
  });

  registerDevUiRoutes(routes);

  registerRuntimeRoutes({ routes, readJsonBody });

  registerExperimentalExtensionRoutes({ routes, config, readJsonBody });

  registerTokenRoutes({
    routes,
    config,
    tokens,
    ensureWritable,
    readJsonBody,
  });

  registerEnvRoutes({
    routes,
    config,
    env,
    ensureWritable,
    readJsonBody,
  });


  registerCommandRoutes({
    routes,
    config,
    tokens,
    ensureWritable,
    requireClientScope,
    requireHost,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    readJsonBody,
  });

  registerAutomationRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    reconcileAutomationRuns: async (workspace) => {
      await reconcileAutomationRuns(config, workspace);
    },
    runAutomationTask: async (workspace, task, onStarted) => {
      const execution = await startAutomationTask(config, workspace, task);
      await onStarted(execution);
      const leaseId = task.running?.leaseId?.trim();
      await waitForAutomationSession(
        config,
        workspace,
        execution,
        leaseId
          ? {
              workspaceRoot: workspace.path,
              automationId: task.id,
              leaseId,
            }
          : undefined,
      );
      return execution;
    },
    requireApproval,
    readJsonBody,
  });

  registerPluginRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    opencodeConfigPath,
    readJsonBody,
  });

  registerArtifactPluginRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    emitReloadEvent,
    readJsonBody,
  });

  registerSkillRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    globalSkillsDir,
    readJsonBody,
  });

  registerWorkBuddyExpertRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    readJsonBody,
    onGlobalSkillsChanged,
    emitReloadEvent: (reloadEvents, workspace) => {
      emitReloadEvent(reloadEvents, workspace, "skills", {
        type: "skill",
        name: "getworkbuddy",
        action: "updated",
      });
    },
  });

  registerMcpRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    opencodeConfigPath,
    logoutMcpAuth: (workspace, name) => logoutMcpAuth(config, workspace, name),
    readJsonBody,
  });

  registerApprovalRoutes({ routes, readJsonBody });

  registerWorkspaceObservabilityRoutes({
    routes,
    config,
    resolveWorkspace,
    requireClientScope,
    reloadOpencodeEngine,
  });

  registerWorkspaceSessionArchiveRoutes({
    routes,
    config,
    resolveWorkspace,
  });

  registerWorkspaceSessionRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    readJsonBody,
    listWorkspaceSessions,
    readWorkspaceSession,
    readWorkspaceSessionMessages,
    readWorkspaceSessionSnapshot,
    deleteWorkspaceSession,
  });

  registerWorkspaceRoutes({
    routes,
    config,
    ensureWritable,
    resolveWorkspace,
    serializeWorkspace,
    persistServerWorkspaceState,
    onWorkspacesChanged,
    reloadOpencodeEngine,
    readJsonBody,
  });

  registerWorkspaceConfigRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    readOpencodeConfig,
    readOnMyAgentConfig,
    writeOnMyAgentConfig,
    buildConfigTrigger,
    readJsonBody,
  });

  registerWorkspaceArtifactRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    resolveInboxDir,
    resolveOutboxDir,
    listInbox,
    listArtifacts,
    decodeInboxId,
    decodeArtifactId,
    resolveSafeChildPath,
    normalizeWorkspaceRelativePath,
    resolveWorkspaceArtifactTargets,
    readJsonBody,
  });

  registerWorkspaceFileRoutes({
    routes,
    config,
    maxFileBytes,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    readJsonBody,
    normalizeWorkspaceRelativePath,
    resolveSafeChildPath,
    isSupportedWorkspaceTextFilePath,
    contentTypeForPath,
    fileRevision,
    recordWorkspaceFileEvent,
  });

  registerWorkspaceFileSessionRoutes({
    routes,
    config,
    fileSessions,
    ensureWritable,
    requireClientScope,
    requireApproval,
    resolveWorkspace,
    readJsonBody,
    normalizeWorkspaceRelativePath,
    resolveSafeChildPath,
    contentKindForPath,
    scopeRank,
  });

  registerWorkspaceImportExportRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    readJsonBody,
    readOnMyAgentConfig,
    writeOnMyAgentConfig,
    emitReloadEvent,
    buildConfigTrigger,
  });

  registerWorkspaceBlueprintRoutes({
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    materializeBlueprintSessions,
  });
}
