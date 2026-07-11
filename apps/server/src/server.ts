import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type {
  ApprovalRequest,
  ServerConfig,
  WorkspaceInfo,
  Actor,
  AutomationTaskItem,
  ReloadReason,
  ReloadTrigger,
  TokenScope,
} from "@onmyagent/types/server";
import { ApprovalService } from "./services/approvals.js";
import { listPlugins } from "./services/plugins.js";
import { listSkills } from "./services/skills.js";
import { listCommands, repairCommands } from "./services/commands.js";
import {
  bindAutomationRunSession,
  claimDueAutomation,
  listAutomations,
  reconcileAutomationRunSuccess,
  recordOverlappingAutomationSkips,
  recordAutomationRun,
  type ClaimedAutomationTask,
} from "./services/automations.js";
import { ApiError, formatError } from "./core/errors.js";
import { readJsoncFile } from "./core/jsonc.js";
import { recordAudit } from "./services/audit.js";
import { ReloadEventStore } from "./services/events.js";
import { computeReloadFingerprint } from "./reload-fingerprint.js";
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
import { sanitizeCommandName } from "./core/validators.js";
import { TokenService } from "./services/tokens.js";
import { EnvService } from "./services/env-file.js";
import { FileSessionStore } from "./services/file-sessions.js";
import {
  applyMaterializedBlueprintSessions,
  normalizeBlueprintSessionTemplates,
  readMaterializedBlueprintSessions,
  sanitizeOnMyAgentTemplateConfig,
} from "./workspace/blueprint-sessions.js";
import {
  resolveWorkspaceOpencodeConnection,
} from "./services/opencode-connection.js";
import { seedOpencodeSessionMessages } from "./services/opencode-db.js";
import {
  buildSession,
  buildSessionList,
  buildSessionMessages,
  buildSessionSnapshot,
  buildSessionStatuses,
  buildSessionTodos,
} from "./services/session-read-model.js";
import { addRoute, type AuthMode, type RequestContext, type Route } from "./routes/route-core.js";
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

const SERVER_VERSION = pkg.version;
const OPENCODE_VERSION = constants.opencodeVersion.trim().replace(/^v/, "");

const FILE_SESSION_MAX_FILE_BYTES = 5_000_000;
const reloadBaselineRefreshers = new WeakMap<
  ServerConfig,
  (workspaceId: string, reasons?: ReloadReason[]) => Promise<void>
>();

type LogLevel = "info" | "warn" | "error";

type LogAttributes = Record<string, unknown>;

type ServerLogger = {
  log: (level: LogLevel, message: string, attributes?: LogAttributes) => void;
};

const LOG_LEVEL_NUMBERS: Record<LogLevel, number> = {
  info: 9,
  warn: 13,
  error: 17,
};

const stdoutErrorGuardInstalled = Symbol.for("onmyagent.server.stdoutErrorGuardInstalled");

function toUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function isIgnorableStdoutWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = Reflect.get(error, "code");
  return code === "EPIPE"
    || code === "ERR_STREAM_DESTROYED"
    || code === "ERR_STREAM_WRITE_AFTER_END";
}

function installStdoutErrorGuard() {
  const stdout = process.stdout as NodeJS.WriteStream & { [stdoutErrorGuardInstalled]?: true };
  if (stdout[stdoutErrorGuardInstalled]) return;
  stdout[stdoutErrorGuardInstalled] = true;
  stdout.on("error", (error) => {
    if (isIgnorableStdoutWriteError(error)) return;
    throw error;
  });
}

function writeStdoutLine(line: string) {
  try {
    installStdoutErrorGuard();
    process.stdout.write(`${line}\n`);
  } catch (error) {
    if (isIgnorableStdoutWriteError(error)) return;
    throw error;
  }
}

export function createServerLogger(config: ServerConfig): ServerLogger {
  const runId = process.env.ONMYAGENT_RUN_ID ?? shortId();
  const host = hostname().trim();
  const resource: Record<string, string> = {
    "service.name": "onmyagent-server",
    "service.version": SERVER_VERSION,
    "service.instance.id": runId,
  };
  if (host) {
    resource["host.name"] = host;
  }
  const baseAttributes: LogAttributes = {
    "run.id": runId,
    "process.pid": process.pid,
  };

  const emit = (
    level: LogLevel,
    message: string,
    attributes?: LogAttributes,
  ) => {
    const merged = { ...baseAttributes, ...(attributes ?? {}) };
    if (config.logFormat === "json") {
      const record = {
        timeUnixNano: toUnixNano(),
        severityText: level.toUpperCase(),
        severityNumber: LOG_LEVEL_NUMBERS[level],
        body: message,
        attributes: merged,
        resource,
      };
      writeStdoutLine(JSON.stringify(record));
      return;
    }
    writeStdoutLine(message);
  };

  return { log: emit };
}

function logRequest(input: {
  logger: ServerLogger;
  request: Request;
  response: Response;
  durationMs: number;
  authMode: AuthMode;
  proxyService?: "opencode";
  proxyBaseUrl?: string;
  error?: string;
}) {
  const {
    logger,
    request,
    response,
    durationMs,
    authMode,
    proxyService,
    proxyBaseUrl,
    error,
  } = input;
  const status = response.status;
  const level: LogLevel =
    status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const proxyLabel = proxyBaseUrl ? ` (${proxyService ?? "proxy"})` : "";
  const message = `${method} ${url.pathname} ${status} ${durationMs}ms${proxyLabel}`;
  const attributes: LogAttributes = {
    method,
    path: url.pathname,
    status,
    durationMs,
    auth: authMode,
  };
  if (proxyBaseUrl) {
    attributes["proxy.base_url"] = proxyBaseUrl;
    if (proxyService) attributes["proxy.service"] = proxyService;
  }
  if (error) {
    attributes.error = error;
  }
  logger.log(level, message, attributes);
}

function parseWorkspaceMount(
  pathname: string,
): { workspaceId: string; restPath: string } | null {
  if (!pathname.startsWith("/w/")) return null;
  const remainder = pathname.slice(3);
  if (!remainder) return null;
  const slash = remainder.indexOf("/");
  if (slash === -1) {
    return { workspaceId: decodeURIComponent(remainder), restPath: "/" };
  }
  const workspaceId = remainder.slice(0, slash);
  const restPath = remainder.slice(slash) || "/";
  if (!workspaceId.trim()) return null;
  return { workspaceId: decodeURIComponent(workspaceId), restPath };
}

function parseWorkspaceOpencodeMount(
  pathname: string,
): { workspaceId: string; restPath: string } | null {
  if (!pathname.startsWith("/workspace/")) return null;
  const remainder = pathname.slice("/workspace/".length);
  if (!remainder) return null;
  const slash = remainder.indexOf("/");
  if (slash === -1) return null;
  const workspaceId = remainder.slice(0, slash);
  const restPath = remainder.slice(slash) || "/";
  if (!workspaceId.trim()) return null;
  if (restPath !== "/opencode" && !restPath.startsWith("/opencode/"))
    return null;
  return { workspaceId: decodeURIComponent(workspaceId), restPath };
}

function normalizeOpencodeProxyPath(proxyPath: string): string {
  const raw = (proxyPath ?? "").trim() || "/";
  const withoutPrefix = raw.startsWith("/opencode")
    ? raw.slice("/opencode".length)
    : raw;
  const normalized = (withoutPrefix || "/").replace(/\/+$/, "");
  return normalized || "/";
}

function assertOpencodeProxyAllowed(
  actor: Actor,
  method: string,
  proxyPath: string,
) {
  const m = method.toUpperCase();
  const scope = actor.scope ?? "viewer";

  if (scope === "viewer" && m !== "GET" && m !== "HEAD") {
    throw new ApiError(403, "forbidden", "Viewer tokens are read-only");
  }

  // Prevent collaborators/viewers from self-approving OpenCode permission requests via the proxy.
  // OpenCode uses /permission/:requestId/reply (and historically also a session-scoped variant).
  if (scope !== "owner" && m !== "GET" && m !== "HEAD") {
    const normalized = normalizeOpencodeProxyPath(proxyPath);
    if (/\/permission\/[^/]+\/reply$/.test(normalized)) {
      throw new ApiError(
        403,
        "forbidden",
        "Only owner tokens can reply to permission requests",
      );
    }
  }
}

function isSessionCommandProxyRequest(method: string, proxyPath: string) {
  return (
    method === "POST" &&
    /^\/session\/[^/]+\/command$/.test(normalizeOpencodeProxyPath(proxyPath))
  );
}

function startAutomationScheduler(config: ServerConfig, logger: ServerLogger) {
  const inFlight = new Set<string>();
  let closed = false;

  const run = async () => {
    if (closed || config.readOnly) return;
    for (const workspace of config.workspaces) {
      const workspaceId = workspace.id.trim();
      if (!workspaceId || inFlight.has(workspaceId)) continue;
      inFlight.add(workspaceId);
      try {
        await runDueWorkspaceAutomations(config, workspace, logger);
      } catch (error) {
        logger.log("warn", "Automation scheduler failed", {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlight.delete(workspaceId);
      }
    }
  };

  const interval = setInterval(() => {
    void run();
  }, 30_000);
  void run();

  return {
    close: () => {
      closed = true;
      clearInterval(interval);
    },
  };
}

async function runDueWorkspaceAutomations(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  logger: ServerLogger,
) {
  await recordOverlappingAutomationSkips(workspace.path);
  const tasks = await listAutomations(workspace.path);
  const now = Date.now();
  if (!tasks.some((task) => (
    task.running?.expiresAt != null && task.running.expiresAt <= now
  ) || (
    task.enabled &&
    task.nextRunAt != null &&
    task.nextRunAt <= now
  ))) {
    return;
  }

  let task = await claimDueAutomation(workspace.path);
  while (task) {
    const claimed = task;
    void executeClaimedAutomation(config, workspace, claimed, logger).catch((error: unknown) => {
      logger.log("error", "Automation execution bookkeeping failed", {
        workspaceId: workspace.id,
        automationId: claimed.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    task = await claimDueAutomation(workspace.path);
  }
}

async function executeClaimedAutomation(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  task: ClaimedAutomationTask,
  logger: ServerLogger,
) {
  let execution: AutomationExecution | null = null;
  try {
    execution = await startAutomationTask(config, workspace, task);
    await bindAutomationRunSession(
      workspace.path,
      task.id,
      task.running.leaseId,
      execution.sessionId,
      execution.groupName,
      execution.outputDirectory,
    );
    await waitForAutomationSession(config, workspace, execution);
    await recordAutomationRun(workspace.path, task.id, {
      status: "success",
      source: "scheduled",
      ranAt: Date.now(),
      sessionId: execution.sessionId,
      groupName: execution.groupName,
      outputDirectory: execution.outputDirectory,
    }, task.running.leaseId);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: { type: "host" },
      action: "automations.run.scheduled",
      target: task.id,
      summary: `Scheduled automation ${task.title} started session ${execution.sessionId}`,
      timestamp: Date.now(),
    });
    logger.log("info", "Automation task started", {
      workspaceId: workspace.id,
      automationId: task.id,
      sessionId: execution.sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAutomationRun(workspace.path, task.id, {
      status: "failed",
      source: "scheduled",
      ranAt: Date.now(),
      error: message,
      sessionId: execution?.sessionId,
      groupName: execution?.groupName,
      outputDirectory: execution?.outputDirectory,
    }, task.running.leaseId);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: { type: "host" },
      action: "automations.run.scheduled.failed",
      target: task.id,
      summary: `Scheduled automation ${task.title} failed: ${message}`,
      timestamp: Date.now(),
    });
    logger.log("warn", "Automation task failed", {
      workspaceId: workspace.id,
      automationId: task.id,
      error: message,
    });
  }
}

type AutomationExecution = {
  sessionId: string;
  groupName: string;
  outputDirectory: string;
};

type AutomationModel = {
  providerID: string;
  modelID: string;
};

async function startAutomationTask(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  task: Pick<AutomationTaskItem, "title" | "prompt" | "workspaceDirectory" | "model" | "agent" | "accessMode">,
): Promise<AutomationExecution> {
  const workspaceRoot = task.workspaceDirectory?.trim() || workspace.path;
  const { groupName, outputDirectory } = await createAutomationOutputDirectory(workspaceRoot);
  const opencode = createWorkspaceOpencodeClient(config, workspace, outputDirectory);
  await writeFile(
    join(outputDirectory, "任务说明.md"),
    `# ${task.title}\n\n${task.prompt}\n`,
    "utf8",
  );
  const created = unwrapOpencodeResult(
    await opencode.session.create({ title: task.title, directory: outputDirectory }),
    "/session",
  );
  const sessionId =
    created &&
    typeof created === "object" &&
    "id" in created &&
    typeof created.id === "string"
      ? created.id.trim()
      : "";
  if (!sessionId) {
    throw new ApiError(502, "opencode_failed", "OpenCode session did not return an id");
  }

  const model = task.model ?? task.agent?.model ?? await readAutomationModel();
  const system = automationSystemPrompt(task);
  ensureOpencodeRequestSucceeded(
    await opencode.session.promptAsync({
      sessionID: sessionId,
      ...(model ? { model } : {}),
      ...(task.agent?.tools ? { tools: task.agent.tools } : {}),
      ...(system ? { system } : {}),
      parts: [{
        type: "text",
        text: [
          task.prompt,
          "",
          `本次自动化任务的工作目录是：${outputDirectory}`,
          "请将本次任务生成的报告、文档、图片和其他文件全部保存到当前工作目录。",
          "请至少把最终结果保存为“执行结果.md”，不要把生成文件写到工作区的其他目录。",
        ].join("\n"),
      }],
    }),
    `/session/${encodeURIComponent(sessionId)}/prompt`,
  );
  return { sessionId, groupName, outputDirectory };
}

function automationSystemPrompt(
  task: Pick<AutomationTaskItem, "agent" | "accessMode">,
) {
  return [
    task.agent?.systemPrompt,
    task.accessMode === "full"
      ? "本次自动化任务由用户选择“完全访问权限”。在需要执行文件、命令、联网或工具操作时，优先按任务目标自主推进；仍需遵守系统和宿主应用的安全边界。"
      : null,
  ].filter((part): part is string => Boolean(part)).join("\n\n") || undefined;
}

async function waitForAutomationSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  execution: AutomationExecution,
): Promise<void> {
  const opencode = createWorkspaceOpencodeClient(config, workspace, execution.outputDirectory);
  const startedAt = Date.now();
  const timeoutAt = startedAt + 2 * 60 * 60 * 1000;
  const emptyOutputGraceMs = 30_000;
  let observedActive = false;
  let inactiveSince: number | null = null;

  while (Date.now() < timeoutAt) {
    const statuses = buildSessionStatuses(
      unwrapOpencodeResult(await opencode.session.status(), "/session/status"),
    );
    const status = statuses[execution.sessionId];
    if (status?.type === "busy" || status?.type === "retry") {
      observedActive = true;
      inactiveSince = null;
    } else if (!status || status.type === "idle") {
      const saved = await saveAutomationSessionOutput(opencode, execution);
      if (saved) return;
      const sessionError = await readAutomationSessionError(opencode, execution);
      if (sessionError) {
        throw new ApiError(502, "automation_session_failed", sessionError);
      }
      inactiveSince ??= Date.now();
      if (
        (observedActive || Date.now() - startedAt >= 5_000) &&
        Date.now() - inactiveSince >= emptyOutputGraceMs
      ) {
        throw new ApiError(
          502,
          "automation_empty_output",
          "OpenCode completed without assistant output",
        );
      }
    }
    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, 1_000);
    });
  }

  throw new ApiError(504, "automation_timeout", "Automation session timed out");
}

async function readAutomationSessionError(
  opencode: ReturnType<typeof createWorkspaceOpencodeClient>,
  execution: AutomationExecution,
) {
  const messages = buildSessionMessages(
    unwrapOpencodeResult(
      await opencode.session.messages({ sessionID: execution.sessionId }),
      `/session/${encodeURIComponent(execution.sessionId)}/message`,
    ),
  );
  for (const message of messages.slice().reverse()) {
    if (message.info.role !== "assistant") continue;
    const error = Reflect.get(message.info, "error");
    if (!error) continue;
    return describeOpencodeClientError(error);
  }
  return null;
}

async function reconcileAutomationRuns(
  config: ServerConfig,
  workspace: WorkspaceInfo,
) {
  const automations = await listAutomations(workspace.path);
  for (const automation of automations) {
    for (const run of automation.runs) {
      if (
        run.status !== "failed" ||
        !run.sessionId ||
        !run.outputDirectory
      ) continue;
      try {
        const opencode = createWorkspaceOpencodeClient(config, workspace, run.outputDirectory);
        const saved = await saveAutomationSessionOutput(opencode, {
          sessionId: run.sessionId,
          groupName: run.groupName ?? basename(run.outputDirectory),
          outputDirectory: run.outputDirectory,
        });
        if (saved) {
          await reconcileAutomationRunSuccess(workspace.path, automation.id, run.ranAt);
        }
      } catch {
      }
    }
  }
}

async function createAutomationOutputDirectory(workspaceRoot: string) {
  let timestamp = Date.now();
  while (true) {
    const groupName = automationGroupName(timestamp);
    const outputDirectory = join(workspaceRoot, groupName);
    if (!(await exists(outputDirectory))) {
      await mkdir(outputDirectory, { recursive: false });
      return { groupName, outputDirectory };
    }
    timestamp += 1_000;
  }
}

function automationGroupName(timestamp: number) {
  const date = new Date(timestamp);
  const values = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ].map((value) => String(value).padStart(2, "0"));
  return `自动化任务-${values.join("-")}`;
}

async function saveAutomationSessionOutput(
  opencode: ReturnType<typeof createWorkspaceOpencodeClient>,
  execution: AutomationExecution,
) {
  const resultPath = join(execution.outputDirectory, "执行结果.md");
  try {
    if ((await readFile(resultPath, "utf8")).trim()) return true;
  } catch {
  }
  const messages = buildSessionMessages(
    unwrapOpencodeResult(
      await opencode.session.messages({ sessionID: execution.sessionId }),
      `/session/${encodeURIComponent(execution.sessionId)}/message`,
    ),
  );
  const assistantText = messages
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) => message.parts.map(readAutomationTextPart))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!assistantText) return false;
  await writeFile(
    resultPath,
    `${assistantText}\n`,
    "utf8",
  );
  return true;
}

function readAutomationTextPart(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  if (!("type" in value) || value.type !== "text") return "";
  if (!("text" in value) || typeof value.text !== "string") return "";
  return value.text.trim();
}

async function readAutomationModel(): Promise<AutomationModel | undefined> {
  const stateRoots = [
    process.env.XDG_STATE_HOME?.trim(),
    join(homedir(), ".local", "state"),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  for (const stateRoot of stateRoots) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(stateRoot, "opencode", "model.json"), "utf8"),
      );
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      if (!("recent" in parsed) || !Array.isArray(parsed.recent)) continue;
      for (const entry of parsed.recent) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        if (!("providerID" in entry) || typeof entry.providerID !== "string") continue;
        if (!("modelID" in entry) || typeof entry.modelID !== "string") continue;
        const providerID = entry.providerID.trim();
        const modelID = entry.modelID.trim();
        if (providerID && modelID) return { providerID, modelID };
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

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

function buildOpencodeProxyUrl(baseUrl: string, path: string, search: string) {
  const target = new URL(baseUrl);
  const trimmedPath = path.replace(/^\/opencode/, "");
  target.pathname = trimmedPath.startsWith("/")
    ? trimmedPath
    : `/${trimmedPath}`;
  target.search = search;
  return target.toString();
}

function buildOpencodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory)
    ? encodeURIComponent(directory)
    : directory;
}

function createOpencodeDirectoryFetch(directory: string): typeof fetch {
  return Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const headers = new Headers(init?.headers ?? request.headers);
      headers.set(
        "x-opencode-directory",
        buildOpencodeDirectoryHeader(directory),
      );
      return fetch(new Request(request, { headers }));
    },
    { preconnect: fetch.preconnect },
  );
}

type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };

function createWorkspaceOpencodeClient(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  directoryOverride?: string,
) {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const directory = directoryOverride?.trim() || resolveOpencodeDirectory(workspace);
  const directoryFetch = directory
    ? createOpencodeDirectoryFetch(directory)
    : undefined;

  return createOpencodeClient({
    baseUrl: connection.baseUrl?.trim(),
    ...(directory ? { directory } : {}),
    ...(directoryFetch ? { fetch: directoryFetch } : {}),
    ...(connection.authHeader
      ? { headers: { Authorization: connection.authHeader } }
      : {}),
  });
}

function unwrapOpencodeResult<T, E>(
  result: OpencodeClientResult<T, E>,
  path: string,
): NonNullable<T> {
  if (result.data != null) {
    return result.data;
  }
  if (result.error === undefined) {
    throw new ApiError(
      502,
      "opencode_empty_response",
      "OpenCode returned an empty response",
      { path },
    );
  }
  throw new ApiError(
    502,
    "opencode_request_failed",
    describeOpencodeClientError(result.error),
    {
      status: result.response.status,
      body: result.error,
      path,
    },
  );
}

function ensureOpencodeRequestSucceeded<T, E>(
  result: OpencodeClientResult<T, E>,
  path: string,
): void {
  if (result.error === undefined) return;
  throw new ApiError(
    502,
    "opencode_request_failed",
    describeOpencodeClientError(result.error),
    {
      status: result.response.status,
      body: result.error,
      path,
    },
  );
}

async function logoutMcpAuth(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  name: string,
): Promise<void> {
  try {
    const opencode = createWorkspaceOpencodeClient(config, workspace);
    unwrapOpencodeResult(
      await opencode.mcp.disconnect({ name }),
      `/mcp/${encodeURIComponent(name)}/disconnect`,
    );
  } catch {
    // ignore
  }

  try {
    const opencode = createWorkspaceOpencodeClient(config, workspace);
    unwrapOpencodeResult(
      await opencode.mcp.auth.remove({ name }),
      `/mcp/${encodeURIComponent(name)}/auth`,
    );
  } catch (error) {
    if (isMissingMcpAuthError(error)) return;
    throw error;
  }
}

function isMissingMcpAuthError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code !== "opencode_request_failed") return false;
  const details = error.details;
  if (!details || typeof details !== "object" || !("status" in details)) {
    return false;
  }
  return details.status === 404;
}

function assertOpencodeSuccess<T, E>(
  result: OpencodeClientResult<T, E>,
  path: string,
): void {
  if (result.error === undefined) return;
  throw new ApiError(
    502,
    "opencode_request_failed",
    describeOpencodeClientError(result.error),
    {
      status: result.response.status,
      body: result.error,
      path,
    },
  );
}

function describeOpencodeClientError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return `OpenCode request failed: ${error.message.trim()}`;
  }
  return "OpenCode request failed";
}

async function proxyOpencodeRequest(input: {
  config: ServerConfig;
  request: Request;
  url: URL;
  workspace?: WorkspaceInfo;
  proxyPath?: string;
}) {
  const workspace = input.workspace;
  const baseUrl = workspace
    ? (resolveWorkspaceOpencodeConnection(
        input.config,
        workspace,
      ).baseUrl?.trim() ?? "")
    : "";
  if (!baseUrl) {
    throw new ApiError(
      400,
      "opencode_unconfigured",
      "OpenCode base URL is missing for this workspace",
    );
  }

  const proxyPath = input.proxyPath ?? input.url.pathname;
  const targetUrl = buildOpencodeProxyUrl(baseUrl, proxyPath, input.url.search);
  const headers = new Headers(input.request.headers);
  headers.delete("authorization");
  headers.delete("x-onmyagent-host-token");
  headers.delete("x-onmyagent-client-id");
  headers.delete("host");
  headers.delete("origin");

  const directory = workspace ? resolveOpencodeDirectory(workspace) : null;
  if (directory && !headers.has("x-opencode-directory")) {
    headers.set(
      "x-opencode-directory",
      buildOpencodeDirectoryHeader(directory),
    );
  }

  const auth = workspace
    ? (resolveWorkspaceOpencodeConnection(input.config, workspace).authHeader ??
      null)
    : null;
  if (auth) {
    headers.set("Authorization", auth);
  }

  const method = input.request.method.toUpperCase();
  // Buffer the request body so it can be forwarded reliably across Node.js
  // stream boundaries (Readable.toWeb streams from the HTTP adapter aren't
  // always accepted directly by Node's global fetch as a body).
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await input.request
          .arrayBuffer()
          .then((buf) => (buf.byteLength > 0 ? buf : undefined));
  if (isSessionCommandProxyRequest(method, proxyPath)) {
    void fetch(targetUrl, {
      method,
      headers,
      body,
    }).catch(() => {
      // Command failures are surfaced through the OpenCode event stream.
    });
    return jsonResponse({ ok: true, accepted: true });
  }
  const response = await fetch(targetUrl, {
    method,
    headers,
    body,
  });

  return sanitizeProxyResponse(response);
}

/**
 * Strip hop-by-hop and transport-level headers that Bun's native fetch keeps
 * in the upstream response even after it has already decoded the body for us.
 * Without this the browser sees `content-encoding: gzip` on a plain-text
 * payload and bails out with ERR_CONTENT_DECODING_FAILED, breaking any UI
 * code that reaches through /opencode/* (including session.create).
 */
function sanitizeProxyResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

function resolveInboxDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent", "inbox");
}

function resolveOutboxDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent", "outbox");
}

export function normalizeWorkspaceRelativePath(
  input: string,
  options: { allowSubdirs: boolean },
): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (raw.includes("\u0000")) {
    throw new ApiError(400, "invalid_path", "Path contains null byte");
  }

  // A lot of user-facing surfaces (artifacts, tool logs) reference files as
  // `workspace/<path>` or `/workspace/<path>`. The server API expects
  // workspace-relative paths, so normalize those common prefixes here.
  let normalized = raw.replace(/\\/g, "/");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^workspaces\/[^/]+\//i, "");
  normalized = normalized.replace(
    /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i,
    "",
  );
  normalized = normalized.replace(/^workspace\//, "");
  normalized = normalized.replace(/^\/+/, "");

  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (!options.allowSubdirs && parts.length > 1) {
    throw new ApiError(400, "invalid_path", "Subdirectories are not allowed");
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
    }
  }
  return parts.join("/");
}

export function isSupportedWorkspaceTextFilePath(
  relativePath: string,
): boolean {
  const lowered = relativePath.toLowerCase();
  return [
    ".md",
    ".mdx",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".html",
    ".htm",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".css",
    ".scss",
    ".txt",
    ".log",
  ].some((ext) => lowered.endsWith(ext));
}

function resolveSafeChildPath(root: string, child: string): string {
  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, child);
  if (candidate === rootResolved) {
    throw new ApiError(400, "invalid_path", "Path must point to a file");
  }
  if (!candidate.startsWith(rootResolved + sep)) {
    throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
  }
  return candidate;
}

function encodeArtifactId(path: string): string {
  return Buffer.from(path, "utf8").toString("base64url");
}

function decodeArtifactId(id: string): string {
  const raw = (id ?? "").trim();
  if (!raw) {
    throw new ApiError(400, "invalid_artifact", "Artifact id is required");
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    return normalizeWorkspaceRelativePath(decoded, { allowSubdirs: true });
  } catch {
    throw new ApiError(400, "invalid_artifact", "Artifact id is invalid");
  }
}

function contentTypeForPath(path: string): string {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".html") || lowered.endsWith(".htm"))
    return "text/html; charset=utf-8";
  if (lowered.endsWith(".svg")) return "image/svg+xml";
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg"))
    return "image/jpeg";
  if (lowered.endsWith(".gif")) return "image/gif";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".pdf")) return "application/pdf";
  if (lowered.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lowered.endsWith(".tsv"))
    return "text/tab-separated-values; charset=utf-8";
  if (lowered.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lowered.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lowered.endsWith(".ods"))
    return "application/vnd.oasis.opendocument.spreadsheet";
  if (isSupportedWorkspaceTextFilePath(path))
    return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function contentKindForPath(path: string): "text" | "image" | "pdf" | "binary" {
  const lowered = path.toLowerCase();
  if (isSupportedWorkspaceTextFilePath(path)) return "text";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lowered)) return "image";
  if (lowered.endsWith(".pdf")) return "pdf";
  return "binary";
}

function fileRevision(info: { mtimeMs: number; size: number }): string {
  return `${Math.floor(info.mtimeMs)}:${info.size}`;
}

type ArtifactTargetInput = {
  kind?: unknown;
  value?: unknown;
  name?: unknown;
  preview?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

function artifactPreviewForPath(path: string): string {
  const lowered = path.toLowerCase();
  if (/\.(md|markdown|mdx)$/.test(lowered)) return "markdown";
  if (/\.(csv|tsv|xlsx|xls|ods)$/.test(lowered)) return "sheet";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lowered)) return "image";
  if (lowered.endsWith(".pdf")) return "pdf";
  if (/\.(html|htm)$/.test(lowered)) return "html";
  if (isSupportedWorkspaceTextFilePath(path)) return "text";
  return "external";
}

function normalizeUrlTarget(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function resolveWorkspaceArtifactTargets(
  workspaceRoot: string,
  input: unknown,
): Promise<Array<Record<string, unknown>>> {
  const targets = Array.isArray(input) ? input.slice(0, 80) : [];
  const results = new Map<string, Record<string, unknown>>();
  const workspaceResolved = resolve(workspaceRoot);

  for (const item of targets) {
    if (!item || typeof item !== "object") continue;
    const target = item as ArtifactTargetInput;
    const kind = target.kind === "url" ? "url" : "file";
    const rawValue =
      typeof target.value === "string" ? target.value.trim() : "";
    if (!rawValue) continue;
    const confidence =
      typeof target.confidence === "number" &&
      Number.isFinite(target.confidence)
        ? target.confidence
        : 0;
    const reason = typeof target.reason === "string" ? target.reason : "server";

    if (kind === "url") {
      const url = normalizeUrlTarget(rawValue);
      if (!url) continue;
      const key = `url:${url}`;
      const next = {
        id: key,
        kind: "url",
        value: url,
        name:
          typeof target.name === "string" && target.name.trim()
            ? target.name.trim()
            : url,
        preview: "browser",
        confidence,
        reason,
        exists: true,
      };
      const previous = results.get(key);
      if (!previous || confidence >= Number(previous.confidence ?? 0))
        results.set(key, next);
      continue;
    }

    let relativePath: string;
    try {
      if (isAbsolute(rawValue)) {
        const absolutePath = resolve(rawValue);
        const pathFromWorkspace = relative(workspaceResolved, absolutePath);
        if (
          !pathFromWorkspace ||
          pathFromWorkspace === ".." ||
          pathFromWorkspace.startsWith(`..${sep}`) ||
          isAbsolute(pathFromWorkspace)
        ) {
          continue;
        }
        relativePath = normalizeWorkspaceRelativePath(pathFromWorkspace, {
          allowSubdirs: true,
        });
      } else {
        relativePath = normalizeWorkspaceRelativePath(rawValue, {
          allowSubdirs: true,
        });
      }
    } catch {
      continue;
    }
    const key = `file:${relativePath.toLowerCase()}`;
    const absPath = resolveSafeChildPath(workspaceRoot, relativePath);
    let existsFile = false;
    let size: number | undefined;
    let updatedAt: number | undefined;
    let kindValue: "file" | "dir" | "other" | undefined;
    if (await exists(absPath)) {
      const info = await stat(absPath);
      kindValue = info.isFile() ? "file" : info.isDirectory() ? "dir" : "other";
      existsFile = info.isFile();
      size = info.size;
      updatedAt = info.mtimeMs;
    }
    const next = {
      id: key,
      kind: "file",
      value: relativePath,
      name: basename(relativePath),
      preview: artifactPreviewForPath(relativePath),
      confidence,
      reason,
      exists: existsFile,
      fileKind: kindValue,
      size,
      updatedAt,
      contentType: contentTypeForPath(relativePath),
    };
    const previous = results.get(key);
    if (!previous || confidence >= Number(previous.confidence ?? 0))
      results.set(key, next);
  }

  return Array.from(results.values());
}

function encodeInboxId(path: string): string {
  return encodeArtifactId(path);
}

function decodeInboxId(id: string): string {
  try {
    return decodeArtifactId(id);
  } catch {
    throw new ApiError(400, "invalid_inbox_item", "Inbox item id is invalid");
  }
}

async function listArtifacts(
  outboxRoot: string,
): Promise<
  Array<{ id: string; path: string; size: number; updatedAt: number }>
> {
  const rootResolved = resolve(outboxRoot);
  if (!(await exists(rootResolved))) return [];

  const items: Array<{
    id: string;
    path: string;
    size: number;
    updatedAt: number;
  }> = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = normalizeWorkspaceRelativePath(relative(rootResolved, abs), {
        allowSubdirs: true,
      });
      const info = await stat(abs);
      items.push({
        id: encodeArtifactId(rel),
        path: rel,
        size: info.size,
        updatedAt: info.mtimeMs,
      });
    }
  };

  try {
    await walk(rootResolved);
  } catch {
    return [];
  }

  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

async function listInbox(inboxRoot: string): Promise<
  Array<{
    id: string;
    path: string;
    size: number;
    updatedAt: number;
    name: string;
  }>
> {
  const items = await listArtifacts(inboxRoot);
  return items.map((item) => ({
    ...item,
    id: encodeInboxId(item.path),
    name: basename(item.path),
  }));
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

function remapSessionReadError(error: unknown): never {
  if (error instanceof ApiError && error.code === "opencode_request_failed") {
    const details = error.details;
    const upstreamStatus =
      details && typeof details === "object" && "status" in details
        ? Number((details as { status?: unknown }).status)
        : NaN;
    if (upstreamStatus === 400) {
      throw new ApiError(
        400,
        "invalid_query",
        "OpenCode rejected the session read request",
        details,
      );
    }
    if (upstreamStatus === 404) {
      throw new ApiError(
        404,
        "session_not_found",
        "Session not found",
        details,
      );
    }
  }
  throw error;
}

async function listWorkspaceSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: { roots?: boolean; start?: number; search?: string; limit?: number; directory?: string },
) {
  try {
    const connection = resolveWorkspaceOpencodeConnection(config, workspace);
    if (!connection.baseUrl?.trim()) {
      return [];
    }
    const opencode = createWorkspaceOpencodeClient(config, workspace, input.directory);
    return buildSessionList(
      unwrapOpencodeResult(
        await opencode.session.list({
          roots: input.roots,
          start: input.start,
          search: input.search,
          limit: input.limit,
        }),
        "/session",
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  directory?: string,
) {
  try {
    const opencode = createWorkspaceOpencodeClient(config, workspace, directory);
    return buildSession(
      unwrapOpencodeResult(
        await opencode.session.get({ sessionID: sessionId }),
        `/session/${encodeURIComponent(sessionId)}`,
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSessionMessages(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number; directory?: string },
) {
  try {
    const opencode = createWorkspaceOpencodeClient(config, workspace, input.directory);
    return buildSessionMessages(
      unwrapOpencodeResult(
        await opencode.session.messages({
          sessionID: sessionId,
          limit: input.limit,
        }),
        `/session/${encodeURIComponent(sessionId)}/message`,
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSessionTodos(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
) {
  try {
    const opencode = createWorkspaceOpencodeClient(config, workspace);
    return buildSessionTodos(
      unwrapOpencodeResult(
        await opencode.session.todo({ sessionID: sessionId }),
        `/session/${encodeURIComponent(sessionId)}/todo`,
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSessionStatuses(
  config: ServerConfig,
  workspace: WorkspaceInfo,
) {
  try {
    const opencode = createWorkspaceOpencodeClient(config, workspace);
    return buildSessionStatuses(
      unwrapOpencodeResult(await opencode.session.status(), "/session/status"),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSessionSnapshot(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number; directory?: string },
) {
  try {
    const opencode = createWorkspaceOpencodeClient(config, workspace, input.directory);
    const [session, messages, todos, statuses] = await Promise.all([
      opencode.session
        .get({ sessionID: sessionId })
        .then((result) =>
          unwrapOpencodeResult(
            result,
            `/session/${encodeURIComponent(sessionId)}`,
          ),
        ),
      opencode.session
        .messages({ sessionID: sessionId, limit: input.limit })
        .then((result) =>
          unwrapOpencodeResult(
            result,
            `/session/${encodeURIComponent(sessionId)}/message`,
          ),
        ),
      opencode.session
        .todo({ sessionID: sessionId })
        .then((result) =>
          unwrapOpencodeResult(
            result,
            `/session/${encodeURIComponent(sessionId)}/todo`,
          ),
        ),
      opencode.session
        .status()
        .then((result) => unwrapOpencodeResult(result, "/session/status")),
    ]);
    return buildSessionSnapshot({ session, messages, todos, statuses });
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function deleteWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  directory?: string,
): Promise<void> {
  const opencode = createWorkspaceOpencodeClient(config, workspace, directory);
  unwrapOpencodeResult(
    await opencode.session.delete({ sessionID: sessionId }),
    `/session/${encodeURIComponent(sessionId)}`,
  );
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

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const json = await request.json();
    return json as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON body");
  }
}

function readBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function readOptionalBodyString(body: Record<string, unknown>, key: string): string | undefined {
  const trimmed = readBodyString(body, key).trim();
  return trimmed || undefined;
}

function readRequiredBodyString(body: Record<string, unknown>, key: string): string {
  const trimmed = readOptionalBodyString(body, key);
  if (!trimmed) throw new ApiError(400, "invalid_request", `${key} is required`);
  return trimmed;
}

function readOptionalBodyNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) throw new ApiError(400, "invalid_request", `${key} must be a number`);
  return parsed;
}

function readRequiredBodyBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") throw new ApiError(400, "invalid_request", `${key} must be a boolean`);
  return value;
}

function readBodyStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, "invalid_request", `${key} must be an array`);
  return value.map((entry) => String(entry));
}

function readBodyModel(body: Record<string, unknown>): { providerID: string; modelID: string } | undefined {
  const value = body.model;
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_request", "model must be an object");
  const record = value as Record<string, unknown>;
  const providerID = typeof record.providerID === "string" ? record.providerID.trim() : "";
  const modelID = typeof record.modelID === "string" ? record.modelID.trim() : "";
  if (!providerID || !modelID) throw new ApiError(400, "invalid_request", "model.providerID and model.modelID are required");
  return { providerID, modelID };
}

function readBodyBooleanMap(body: Record<string, unknown>, key: string): Record<string, boolean> | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_request", `${key} must be an object`);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => {
    if (typeof entryValue !== "boolean") throw new ApiError(400, "invalid_request", `${key}.${entryKey} must be a boolean`);
    return [entryKey, entryValue] as const;
  }));
}

function readTeamCommentKind(body: Record<string, unknown>): "comment" | "decision" | "question" | "progress" | undefined {
  const kind = readOptionalBodyString(body, "kind");
  if (!kind) return undefined;
  if (kind === "comment" || kind === "decision" || kind === "question" || kind === "progress") return kind;
  throw new ApiError(400, "invalid_request", "kind must be comment, decision, question, or progress");
}

function parseOptionalPositiveInteger(
  value: string | null,
  name: string,
): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(
      400,
      "invalid_query",
      `${name} must be a positive integer`,
    );
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(
  value: string | null,
  name: string,
): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(
      400,
      "invalid_query",
      `${name} must be a non-negative integer`,
    );
  }
  return parsed;
}

function parseOptionalBoolean(
  value: string | null,
  name: string,
): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ApiError(400, "invalid_query", `${name} must be a boolean`);
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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

function normalizeOpencodeScope(
  value: string | null | undefined,
): "project" | "global" {
  return value?.trim().toLowerCase() === "global" ? "global" : "project";
}

function resolveOpencodeConfigFilePath(
  scope: "project" | "global",
  workspaceRoot: string,
): string {
  if (scope === "global") {
    const base = join(homedir(), ".config", "opencode");
    const jsoncPath = join(base, "opencode.jsonc");
    const jsonPath = join(base, "opencode.json");
    if (existsSync(jsoncPath)) return jsoncPath;
    if (existsSync(jsonPath)) return jsonPath;
    return jsoncPath;
  }
  return opencodeConfigPath(workspaceRoot);
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

function resolveOpencodeDirectory(workspace: WorkspaceInfo): string | null {
  const explicit = workspace.directory?.trim() ?? "";
  if (explicit) return normalizeOpencodeDirectory(explicit);
  if (workspace.workspaceType === "local")
    return normalizeOpencodeDirectory(workspace.path);
  return null;
}

function normalizeOpencodeDirectory(directory: string): string {
  // OpenCode stores/list-filters Windows sessions by regular drive paths
  // (`C:\Users\...`). Electron can persist local workspaces as extended-length
  // paths (`\\?\C:\Users\...`); passing those through as the directory query
  // makes OpenCode return an empty session list even though the sessions exist.
  if (process.platform === "win32") {
    return directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "");
  }
  return directory;
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
