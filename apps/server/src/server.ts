import {
  readFile,
  writeFile,
  rm,
  rename,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
  sep,
} from "node:path";
import type {
  ApprovalRequest,
  ServerConfig,
  WorkspaceInfo,
  Actor,
  ReloadReason,
  ReloadTrigger,
  TokenScope,
} from "@onmyagent/types/server";
import { ApprovalService } from "./services/approvals.js";
import { repairCommands } from "./services/commands.js";
import { ApiError, formatError } from "./core/errors.js";
import { readJsoncFile } from "./core/jsonc.js";
import { ReloadEventStore } from "./services/events.js";
import { startReloadWatchers } from "./reload-watcher.js";
import {
  opencodeConfigPath,
  onmyagentConfigPath,
  globalSkillsDir,
} from "./workspace/workspace-files.js";
import { ensureDir, exists, hashToken, shortId } from "./core/utils.js";
import {
  ensureWorkspaceFiles,
} from "./workspace/workspace-init.js";
import { TokenService } from "./services/tokens.js";
import { EnvService } from "./services/env-file.js";
import { FileSessionStore } from "./services/file-sessions.js";
import {
  applyMaterializedBlueprintSessions,
  normalizeBlueprintSessionTemplates,
  readMaterializedBlueprintSessions,
} from "./workspace/blueprint-sessions.js";
import {
  resolveWorkspaceOpencodeConnection,
} from "./services/opencode-connection.js";
import { seedOpencodeSessionMessages } from "./services/opencode-db.js";
import { type AuthMode, type RequestContext, type Route } from "./routes/route-core.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerDevUiRoutes } from "./routes/dev-ui-routes.js";
import { registerRuntimeRoutes } from "./routes/runtime-routes.js";
import { registerWorkspaceImportExportRoutes } from "./routes/workspace-import-export-routes.js";
import { serve, type ServeResult } from "./serve-node.js";
import { registerExperimentalExtensionRoutes } from "./routes/experimental-extension-routes.js";
import { registerTokenRoutes } from "./routes/token-routes.js";
import { registerEnvRoutes } from "./routes/env-routes.js";
import { registerVoiceRoutes } from "./routes/voice-routes.js";
import { registerCommandRoutes } from "./routes/command-routes.js";
import { registerAutomationRoutes } from "./routes/automation-routes.js";
import { registerPluginRoutes } from "./routes/plugin-routes.js";
import { registerArtifactPluginRoutes } from "./routes/artifact-plugin-routes.js";
import { registerSkillRoutes } from "./routes/skill-routes.js";
import { registerMcpRoutes } from "./routes/mcp-routes.js";
import { registerApprovalRoutes } from "./routes/approval-routes.js";
import { registerWorkspaceObservabilityRoutes } from "./routes/workspace-observability-routes.js";
import { registerWorkspaceSessionArchiveRoutes } from "./routes/workspace-session-archive-routes.js";
import { registerWorkspaceSessionRoutes } from "./routes/workspace-session-routes.js";
import { registerWorkspaceRoutes } from "./routes/workspace-routes.js";
import { registerWorkspaceConfigRoutes } from "./routes/workspace-config-routes.js";
import { registerWorkspaceArtifactRoutes } from "./routes/workspace-artifact-routes.js";
import { registerWorkspaceFileRoutes } from "./routes/workspace-file-routes.js";
import { registerWorkspaceBlueprintRoutes, type BlueprintMaterializeResult } from "./routes/workspace-blueprint-routes.js";
import { registerWorkspaceFileSessionRoutes } from "./routes/workspace-file-session-routes.js";
import pkg from "../package.json" with { type: "json" };
import constants from "../../../constants.json" with { type: "json" };

import { createServerLogger, logRequest } from "./core/server-logger.js";
import { readJsonBody, ensurePlainObject } from "./core/request-body.js";
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
import {
  parseWorkspaceMount,
  parseWorkspaceOpencodeMount,
  assertOpencodeProxyAllowed,
  createWorkspaceOpencodeClient,
  unwrapOpencodeResult,
  logoutMcpAuth,
  proxyOpencodeRequest,
  resolveOpencodeDirectory,
} from "./services/opencode-proxy.js";
import {
  listWorkspaceSessions,
  readWorkspaceSession,
  readWorkspaceSessionMessages,
  readWorkspaceSessionSnapshot,
  deleteWorkspaceSession,
} from "./services/workspace-sessions.js";
import {
  startAutomationScheduler,
  startAutomationTask,
  waitForAutomationSession,
  reconcileAutomationRuns,
} from "./services/automation-runner.js";

// Public API re-exports (tests/cli import these from server)
export { createServerLogger } from "./core/server-logger.js";
export {
  normalizeWorkspaceRelativePath,
  isSupportedWorkspaceTextFilePath,
  resolveWorkspaceArtifactTargets,
} from "./workspace/path-utils.js";

const SERVER_VERSION = pkg.version;
const OPENCODE_VERSION = constants.opencodeVersion.trim().replace(/^v/, "");

const FILE_SESSION_MAX_FILE_BYTES = 5_000_000;
const reloadBaselineRefreshers = new WeakMap<
  ServerConfig,
  (workspaceId: string, reasons?: ReloadReason[]) => Promise<void>
>();

export async function startServer(config: ServerConfig): Promise<ServeResult> {
  const approvals = new ApprovalService(config.approval);
  const reloadEvents = new ReloadEventStore();
  const tokens = new TokenService(config);
  const env = new EnvService();
  const logger = createServerLogger(config);
  let watcherHandle = startReloadWatchers({ config, reloadEvents, logger });
  const automationScheduler = startAutomationScheduler(config, logger);
  const refreshWorkspaceReloadBaseline = (
    workspaceId: string,
    reasons?: ReloadReason[],
  ) => watcherHandle.refreshWorkspace(workspaceId, reasons);
  reloadBaselineRefreshers.set(config, refreshWorkspaceReloadBaseline);
  const restartReloadWatchers = () => {
    watcherHandle.close();
    watcherHandle = startReloadWatchers({ config, reloadEvents, logger });
  };
  const routes = createRoutes(
    config,
    approvals,
    tokens,
    env,
    restartReloadWatchers,
  );

  const serverOptions: {
    hostname: string;
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  } = {
    hostname: config.host,
    port: config.port,
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      const startedAt = Date.now();
      let authMode: AuthMode = "none";
      let proxyService: "opencode" | undefined;
      let proxyBaseUrl: string | undefined;
      let errorMessage: string | undefined;

      const finalize = (response: Response) => {
        const wrapped = withCors(response, request, config);
        if (config.logRequests) {
          logRequest({
            logger,
            request,
            response: wrapped,
            durationMs: Date.now() - startedAt,
            authMode,
            proxyService,
            proxyBaseUrl,
            error: errorMessage,
          });
        }
        return wrapped;
      };

      const proxyWorkspaceOpencodeMount = async (mount: {
        workspaceId: string;
        restPath: string;
      }) => {
        authMode = "client";
        try {
          const actor = await requireClient(request, config, tokens);
          assertOpencodeProxyAllowed(actor, request.method, mount.restPath);
          const workspace = await resolveWorkspace(config, mount.workspaceId);
          proxyService = "opencode";
          proxyBaseUrl = workspace.baseUrl?.trim() || undefined;
          const response = await proxyOpencodeRequest({
            config,
            request,
            url,
            workspace,
            proxyPath: mount.restPath,
          });
          return finalize(response);
        } catch (error) {
          const apiError =
            error instanceof ApiError
              ? error
              : new ApiError(500, "internal_error", "Unexpected server error");
          errorMessage = apiError.message;
          return finalize(jsonResponse(formatError(apiError), apiError.status));
        }
      };

      if (request.method === "OPTIONS") {
        return finalize(new Response(null, { status: 204 }));
      }

      const canonicalOpencodeMount = parseWorkspaceOpencodeMount(url.pathname);
      if (canonicalOpencodeMount) {
        return proxyWorkspaceOpencodeMount(canonicalOpencodeMount);
      }

      const mount = parseWorkspaceMount(url.pathname);
      if (
        mount &&
        (mount.restPath === "/opencode" ||
          mount.restPath.startsWith("/opencode/"))
      ) {
        return proxyWorkspaceOpencodeMount(mount);
      }

      // Allow clients to use a mounted base URL (e.g. http://host:8787/w/<id>) while
      // still calling the existing /workspace/:id/* API surface.
      // Example: baseUrl + "/workspace/<id>/plugins" => "/w/<id>/workspace/<id>/plugins".
      // We strip the mount prefix and route-match on the rest path.
      //
      // Important: when using a mounted base URL, enforce that the nested /workspace/:id
      // matches the mount workspace id to preserve the "single-workspace" mental model.
      if (mount && mount.restPath.startsWith("/workspace/")) {
        const match = mount.restPath.match(/^\/workspace\/([^/]+)/);
        const nestedId = match?.[1] ? decodeURIComponent(match[1]) : null;
        if (nestedId && nestedId !== mount.workspaceId) {
          errorMessage = "not_found";
          return finalize(
            jsonResponse({ code: "not_found", message: "Not found" }, 404),
          );
        }
        url.pathname = mount.restPath;
      }

      if (
        url.pathname === "/opencode" ||
        url.pathname.startsWith("/opencode/")
      ) {
        authMode = "client";
        proxyBaseUrl = config.workspaces[0]?.baseUrl?.trim() || undefined;
        try {
          const actor = await requireClient(request, config, tokens);
          assertOpencodeProxyAllowed(actor, request.method, url.pathname);
          proxyService = "opencode";
          const response = await proxyOpencodeRequest({
            config,
            request,
            url,
            workspace: config.workspaces[0],
          });
          return finalize(response);
        } catch (error) {
          const apiError =
            error instanceof ApiError
              ? error
              : new ApiError(500, "internal_error", "Unexpected server error");
          errorMessage = apiError.message;
          return finalize(jsonResponse(formatError(apiError), apiError.status));
        }
      }

      const route = matchRoute(routes, request.method, url.pathname);
      if (!route) {
        errorMessage = "not_found";
        return finalize(
          jsonResponse({ code: "not_found", message: "Not found" }, 404),
        );
      }

      authMode = route.auth;
      try {
        const actor =
          route.auth === "host-token"
            ? requireHostToken(request, config)
            : route.auth === "host"
              ? await requireHost(request, config, tokens)
              : route.auth === "client"
                ? await requireClient(request, config, tokens)
                : undefined;
        const response = await route.handler({
          request,
          url,
          params: route.params,
          config,
          approvals,
          reloadEvents,
          tokens,
          actor,
        });
        return finalize(response);
      } catch (error) {
        if (!(error instanceof ApiError)) {
          console.error("[onmyagent-server] Unhandled error:", error);
        }
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(500, "internal_error", "Unexpected server error");
        errorMessage = apiError.message;
        return finalize(jsonResponse(formatError(apiError), apiError.status));
      }
    },
  };

  const server = await serve({
    ...serverOptions,
    idleTimeout: 120,
  });

  return {
    ...server,
    stop: async () => {
      automationScheduler.close();
      watcherHandle.close();
      reloadBaselineRefreshers.delete(config);
      await server.stop();
    },
  };
}

function matchRoute(routes: Route[], method: string, path: string) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.regex);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    return { ...route, params };
  }
  return null;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withCors(response: Response, request: Request, config: ServerConfig) {
  const origin = request.headers.get("origin");
  const allowedOrigins = config.corsOrigins;
  let allowOrigin: string | null = null;
  if (allowedOrigins.includes("*")) {
    allowOrigin = "*";
  } else if (origin && allowedOrigins.includes(origin)) {
    allowOrigin = origin;
  }

  if (!allowOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-OnMyAgent-Host-Token, X-OnMyAgent-Client-Id, X-OpenCode-Directory, X-Opencode-Directory, x-opencode-directory",
  );
  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

async function requireClient(
  request: Request,
  config: ServerConfig,
  tokens: TokenService,
): Promise<Actor> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) {
    throw new ApiError(401, "unauthorized", "Invalid bearer token");
  }
  const scope = await tokens.scopeForToken(token);
  if (!scope) {
    throw new ApiError(401, "unauthorized", "Invalid bearer token");
  }
  const clientId = request.headers.get("x-onmyagent-client-id") ?? undefined;
  return { type: "remote", clientId, tokenHash: hashToken(token), scope };
}

function requireHostToken(request: Request, config: ServerConfig): Actor {
  const hostToken = request.headers.get("x-onmyagent-host-token");
  if (hostToken && hostToken === config.hostToken) {
    return { type: "host", tokenHash: hashToken(hostToken), scope: "owner" };
  }
  throw new ApiError(401, "unauthorized", "Invalid host token");
}

async function requireHost(
  request: Request,
  config: ServerConfig,
  tokens: TokenService,
): Promise<Actor> {
  const hostToken = request.headers.get("x-onmyagent-host-token");
  if (hostToken && hostToken === config.hostToken) {
    return { type: "host", tokenHash: hashToken(hostToken), scope: "owner" };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const bearer = match?.[1];
  if (!bearer) {
    throw new ApiError(401, "unauthorized", "Invalid host token");
  }
  const scope = await tokens.scopeForToken(bearer);
  if (scope !== "owner") {
    throw new ApiError(401, "unauthorized", "Invalid host token");
  }
  const clientId = request.headers.get("x-onmyagent-client-id") ?? undefined;
  return { type: "remote", clientId, tokenHash: hashToken(bearer), scope };
}

function emitReloadEvent(
  reloadEvents: ReloadEventStore,
  workspace: WorkspaceInfo,
  reason: ReloadReason,
  trigger?: ReloadTrigger,
) {
  reloadEvents.recordDebounced(workspace.id, reason, trigger);
}

function buildConfigTrigger(path: string): ReloadTrigger {
  const name = path.split(/[\\/]/).filter(Boolean).pop();
  return {
    type: "config",
    name: name || "opencode.json",
    action: "updated",
    path,
  };
}

function serializeWorkspace(workspace: ServerConfig["workspaces"][number]) {
  const { opencodeUsername, opencodePassword, ...rest } = workspace;
  const opencodeDirectory = resolveOpencodeDirectory(workspace);
  const opencode =
    workspace.baseUrl ||
    opencodeDirectory ||
    opencodeUsername ||
    opencodePassword
      ? {
          baseUrl: workspace.baseUrl,
          directory: opencodeDirectory ?? undefined,
          username: opencodeUsername,
          password: opencodePassword,
        }
      : undefined;
  return {
    ...rest,
    opencode,
  };
}

function createRoutes(
  config: ServerConfig,
  approvals: ApprovalService,
  tokens: TokenService,
  env: EnvService,
  onWorkspacesChanged: () => void,
): Route[] {
  const routes: Route[] = [];
  const fileSessions = new FileSessionStore();

  const recordWorkspaceFileEvent = (
    workspaceId: string,
    input: {
      type: "write" | "delete" | "rename" | "mkdir";
      path: string;
      toPath?: string;
      revision?: string;
    },
  ) => {
    return fileSessions.recordWorkspaceEvent({ workspaceId, ...input });
  };

  registerSystemRoutes({
    routes,
    config,
    serverVersion: SERVER_VERSION,
    opencodeVersion: OPENCODE_VERSION,
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

  registerVoiceRoutes({ routes, env, readJsonBody });

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
      await waitForAutomationSession(config, workspace, execution);
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
    maxFileBytes: FILE_SESSION_MAX_FILE_BYTES,
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

  return routes;
}

async function resolveWorkspace(
  config: ServerConfig,
  id: string,
): Promise<WorkspaceInfo> {
  const workspaceId = id.trim();
  const aliasWorkspaceId = workspaceId.startsWith("rem_")
    ? workspaceId.slice("rem_".length)
    : "";
  const workspace =
    config.workspaces.find((entry) => entry.id === workspaceId) ??
    (aliasWorkspaceId
      ? config.workspaces.find((entry) => entry.id === aliasWorkspaceId)
      : undefined);
  if (!workspace) {
    throw new ApiError(404, "workspace_not_found", "Workspace not found");
  }
  const resolvedWorkspace = resolve(workspace.path);
  const authorized = await isAuthorizedRoot(
    resolvedWorkspace,
    config.authorizedRoots,
  );
  if (!authorized) {
    throw new ApiError(
      403,
      "workspace_unauthorized",
      "Workspace is not authorized",
    );
  }
  if (!config.readOnly) {
    const ensured = await ensureWorkspaceFiles(
      resolvedWorkspace,
      workspace.preset ?? "starter",
    );
    const bootstrapReloadReasons = new Set<ReloadReason>(ensured.reloadReasons);
    if (await repairCommands(resolvedWorkspace)) {
      bootstrapReloadReasons.add("commands");
    }
    if (bootstrapReloadReasons.size > 0) {
      await reloadBaselineRefreshers.get(config)?.(
        workspace.id,
        Array.from(bootstrapReloadReasons),
      );
      reloadOpencodeEngineAfterInternalBootstrap(config, {
        ...workspace,
        path: resolvedWorkspace,
      });
    }
  }
  return { ...workspace, path: resolvedWorkspace };
}

function reloadOpencodeEngineAfterInternalBootstrap(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): void {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  if (!connection.baseUrl?.trim()) return;
  void reloadOpencodeEngine(config, workspace).catch(() => undefined);
}

async function isAuthorizedRoot(
  workspacePath: string,
  roots: string[],
): Promise<boolean> {
  const resolvedWorkspace = resolve(workspacePath);
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    if (resolvedWorkspace === resolvedRoot) return true;
    if (resolvedWorkspace.startsWith(resolvedRoot + sep)) return true;
  }
  return false;
}

function ensureWritable(config: ServerConfig): void {
  if (config.readOnly) {
    throw new ApiError(403, "read_only", "Server is read-only");
  }
}

function scopeRank(scope: TokenScope): number {
  if (scope === "viewer") return 1;
  if (scope === "collaborator") return 2;
  return 3;
}

function requireClientScope(ctx: RequestContext, required: TokenScope): void {
  const scope = ctx.actor?.scope;
  if (!scope) {
    throw new ApiError(401, "unauthorized", "Missing token scope");
  }
  if (scopeRank(scope) < scopeRank(required)) {
    throw new ApiError(403, "forbidden", "Insufficient token scope", {
      required,
      scope,
    });
  }
}

type OnMyAgentServerConfigFile = Record<string, unknown> & {
  workspaces?: Array<Record<string, unknown>>;
  authorizedRoots?: string[];
};

async function readServerConfigFile(
  configPath: string,
): Promise<OnMyAgentServerConfigFile> {
  if (!(await exists(configPath))) {
    return {};
  }

  try {
    const raw = await readFile(configPath, "utf8");
    return ensurePlainObject(JSON.parse(raw)) as OnMyAgentServerConfigFile;
  } catch (error) {
    throw new ApiError(422, "invalid_json", "Failed to parse server config", {
      path: configPath,
      error: String(error),
    });
  }
}

function serializeWorkspaceConfigEntry(
  workspace: WorkspaceInfo,
): Record<string, unknown> {
  return {
    id: workspace.id,
    path: workspace.path,
    name: workspace.name,
    preset: workspace.preset,
    workspaceType: workspace.workspaceType,
    ...(workspace.remoteType ? { remoteType: workspace.remoteType } : {}),
    ...(workspace.baseUrl ? { baseUrl: workspace.baseUrl } : {}),
    ...(workspace.directory ? { directory: workspace.directory } : {}),
    ...(workspace.displayName ? { displayName: workspace.displayName } : {}),
    ...(workspace.onmyagentHostUrl
      ? { onmyagentHostUrl: workspace.onmyagentHostUrl }
      : {}),
    ...(workspace.onmyagentToken
      ? { onmyagentToken: workspace.onmyagentToken }
      : {}),
    ...(workspace.onmyagentWorkspaceId
      ? { onmyagentWorkspaceId: workspace.onmyagentWorkspaceId }
      : {}),
    ...(workspace.onmyagentWorkspaceName
      ? { onmyagentWorkspaceName: workspace.onmyagentWorkspaceName }
      : {}),
    ...(workspace.sandboxBackend
      ? { sandboxBackend: workspace.sandboxBackend }
      : {}),
    ...(workspace.sandboxRunId ? { sandboxRunId: workspace.sandboxRunId } : {}),
    ...(workspace.sandboxContainerName
      ? { sandboxContainerName: workspace.sandboxContainerName }
      : {}),
    ...(workspace.opencodeUsername
      ? { opencodeUsername: workspace.opencodeUsername }
      : {}),
    ...(workspace.opencodePassword
      ? { opencodePassword: workspace.opencodePassword }
      : {}),
  };
}

async function persistServerWorkspaceState(
  config: ServerConfig,
): Promise<boolean> {
  const configPath = config.configPath?.trim() ?? "";
  if (!configPath) return false;
  if (!(await exists(configPath))) return false;

  const parsed = await readServerConfigFile(configPath);
  const next: OnMyAgentServerConfigFile = {
    ...parsed,
    workspaces: config.workspaces.map(serializeWorkspaceConfigEntry),
    authorizedRoots: Array.from(
      new Set(config.authorizedRoots.map((root) => resolve(root))),
    ),
  };

  await ensureDir(dirname(configPath));
  const tmpPath = `${configPath}.tmp.${shortId()}`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tmpPath, configPath);
    return true;
  } finally {
    try {
      await rm(tmpPath);
    } catch {
      // ignore
    }
  }
}

async function readOpencodeConfig(
  workspaceRoot: string,
): Promise<Record<string, unknown>> {
  const { data } = await readJsoncFile(
    opencodeConfigPath(workspaceRoot),
    {} as Record<string, unknown>,
  );
  return data;
}

async function readOnMyAgentConfig(
  workspaceRoot: string,
): Promise<Record<string, unknown>> {
  const path = onmyagentConfigPath(workspaceRoot);
  if (!(await exists(path))) return {};
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ApiError(422, "invalid_json", "Failed to parse onmyagent.json");
  }
}

function buildOpencodeReloadUrl(
  baseUrl: string,
  directory?: string | null,
): string {
  try {
    const url = new URL(baseUrl);
    url.pathname = "/instance/dispose";
    url.search = "";
    if (directory) {
      url.searchParams.set("directory", directory);
    }
    return url.toString();
  } catch {
    throw new ApiError(
      400,
      "opencode_url_invalid",
      "OpenCode base URL is invalid",
    );
  }
}

function parseOpencodeErrorBody(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

async function reloadOpencodeEngine(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): Promise<void> {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const baseUrl = connection.baseUrl?.trim() ?? "";
  if (!baseUrl) {
    throw new ApiError(
      400,
      "opencode_unconfigured",
      "OpenCode base URL is missing for this workspace",
    );
  }

  const directory = resolveOpencodeDirectory(workspace);
  const targetUrl = buildOpencodeReloadUrl(baseUrl, directory);
  const headers: Record<string, string> = {};
  const auth = connection.authHeader ?? null;
  if (auth) headers.Authorization = auth;

  const response = await fetch(targetUrl, { method: "POST", headers });
  if (response.ok) return;
  const body = parseOpencodeErrorBody(await response.text());
  throw new ApiError(502, "opencode_reload_failed", "OpenCode reload failed", {
    status: response.status,
    body,
  });
}

async function writeOnMyAgentConfig(
  workspaceRoot: string,
  payload: Record<string, unknown>,
  merge: boolean,
): Promise<void> {
  const path = onmyagentConfigPath(workspaceRoot);
  const next = merge
    ? { ...(await readOnMyAgentConfig(workspaceRoot)), ...payload }
    : payload;
  await ensureDir(join(workspaceRoot, ".opencode"));
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}

async function requireApproval(
  ctx: RequestContext,
  input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
): Promise<void> {
  const actor = ctx.actor ?? { type: "remote" };
  const result = await ctx.approvals.requestApproval({ ...input, actor });
  if (!result.allowed) {
    throw new ApiError(403, "write_denied", "Write request denied", {
      requestId: result.id,
      reason: result.reason,
    });
  }
}


async function materializeBlueprintSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): Promise<BlueprintMaterializeResult> {
  const onmyagent = await readOnMyAgentConfig(workspace.path);
  const templates = normalizeBlueprintSessionTemplates(onmyagent);
  if (!templates.length) {
    return { ok: true, created: [], existing: [], openSessionId: null };
  }

  const existing = readMaterializedBlueprintSessions(onmyagent);
  if (existing.length > 0) {
    const preferredTemplate =
      templates.find((template) => template.openOnFirstLoad) ??
      templates[0] ??
      null;
    const openSessionId = preferredTemplate
      ? (existing.find((item) => item.templateId === preferredTemplate.id)
          ?.sessionId ??
        existing[0]?.sessionId ??
        null)
      : (existing[0]?.sessionId ?? null);
    return { ok: true, created: [], existing, openSessionId };
  }

  const created: Array<{
    templateId: string;
    sessionId: string;
    title: string;
  }> = [];
  const opencode = createWorkspaceOpencodeClient(config, workspace);
  for (const template of templates) {
    const result = unwrapOpencodeResult(
      await opencode.session.create({ title: template.title }),
      "/session",
    );
    const sessionId =
      result &&
      typeof result === "object" &&
      "id" in result &&
      typeof result.id === "string"
        ? result.id.trim()
        : "";
    if (!sessionId) {
      throw new ApiError(
        502,
        "opencode_failed",
        "OpenCode session did not return an id",
      );
    }
    seedOpencodeSessionMessages({
      sessionId,
      workspaceRoot: resolveOpencodeDirectory(workspace) ?? workspace.path,
      messages: template.messages,
    });
    created.push({ templateId: template.id, sessionId, title: template.title });
  }

  const now = Date.now();
  const nextOnMyAgent = applyMaterializedBlueprintSessions(
    onmyagent,
    created.map(({ templateId, sessionId }) => ({ templateId, sessionId })),
    now,
  );
  await writeOnMyAgentConfig(workspace.path, nextOnMyAgent, false);

  const preferredTemplate =
    templates.find((template) => template.openOnFirstLoad) ??
    templates[0] ??
    null;
  const openSessionId = preferredTemplate
    ? (created.find((item) => item.templateId === preferredTemplate.id)
        ?.sessionId ??
      created[0]?.sessionId ??
      null)
    : (created[0]?.sessionId ?? null);

  return { ok: true, created, existing: [], openSessionId };
}
