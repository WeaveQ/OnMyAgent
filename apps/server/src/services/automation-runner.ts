import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  AgentRuntimeKind,
  AgentRuntimeModelRef,
} from "@onmyagent/types/agent-runtime";
import type {
  AutomationTaskItem,
  ServerConfig,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import {
  bindAutomationRunSession,
  claimDueAutomation,
  listAutomations,
  parseAutomationPromptCommand,
  reconcileAutomationRunSuccess,
  recordOverlappingAutomationSkips,
  recordAutomationRun,
  type ClaimedAutomationTask,
} from "./automations.js";
import { ApiError, isApiError } from "../core/errors.js";
import { exists, shortId } from "../core/utils.js";
import type { ServerLogger } from "../core/server-logger.js";
import { recordAudit } from "./audit.js";
import {
  createWorkspaceOpencodeClient,
  describeOpencodeClientError,
  ensureOpencodeRequestSucceeded,
  unwrapOpencodeResult,
} from "./opencode-proxy.js";
import {
  ExpertRuntimeContractError,
  resolveExpertRuntimeDirectoryCandidate,
} from "./expert-runtime-contract.js";
import {
  buildSessionMessages,
  buildSessionStatuses,
} from "./session-read-model.js";
import {
  AUTOMATION_SCHEDULER_DEFAULT_MS,
  nextAutomationWakeMs,
} from "./automation-schedule-policy.js";
import { decideAutomationWaitTick } from "./automation-wait-policy.js";
import { defaultOpencodeClientPool } from "./opencode-client-pool.js";
import { upsertSessionOrigin } from "./session-origins.js";
import type { PrimaryRuntimeRegistry } from "./primary-runtime-registry.js";
import type { PrimaryRuntimeEventBus } from "./primary-runtime-events.js";

export type AutomationExecution = {
  sessionId: string;
  groupName: string;
  outputDirectory: string;
  runtimeKind?: AgentRuntimeKind;
};

export type AutomationPrimaryRuntime = {
  registry: PrimaryRuntimeRegistry;
  events: PrimaryRuntimeEventBus;
};

type AutomationModel = {
  providerID: string;
  modelID: string;
};

export function startAutomationScheduler(
  config: ServerConfig,
  logger: ServerLogger,
  resolveRuntimeKind: (workspaceId: string) => Promise<AgentRuntimeKind>
    = async () => "opencode",
  primaryRuntime?: AutomationPrimaryRuntime,
) {
  const inFlight = new Set<string>();
  const executions = new Set<Promise<void>>();
  const controller = new AbortController();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sweep: Promise<void> | null = null;

  const triggerRun = () => {
    if (closed || sweep) return;
    const task = run();
    sweep = task;
    void task.finally(() => {
      if (sweep === task) sweep = null;
    });
  };

  const scheduleNext = (delayMs: number) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      triggerRun();
    }, delayMs);
    timer.unref?.();
  };

  const run = async () => {
    if (closed || config.readOnly) return;
    const now = Date.now();
    const nextRunAts: number[] = [];
    let hasRunning = false;
    let hasExpiringLease = false;

    for (const workspace of config.workspaces) {
      if (controller.signal.aborted) break;
      const workspaceId = workspace.id.trim();
      if (!workspaceId || inFlight.has(workspaceId)) continue;
      inFlight.add(workspaceId);
      try {
        const tasks = await listAutomations(workspace.path);
        for (const task of tasks) {
          if (task.running) {
            hasRunning = true;
            if (
              task.running.expiresAt != null &&
              task.running.expiresAt <= now + 60_000
            ) {
              hasExpiringLease = true;
            }
          }
          if (task.enabled && task.nextRunAt != null) {
            nextRunAts.push(task.nextRunAt);
          }
        }
        await runDueWorkspaceAutomations(
          config,
          workspace,
          logger,
          tasks,
          resolveRuntimeKind,
          primaryRuntime,
          controller.signal,
          (execution) => {
            executions.add(execution);
            void execution.finally(() => executions.delete(execution));
          },
        );
      } catch (error) {
        logger.log("warn", "Automation scheduler failed", {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlight.delete(workspaceId);
      }
    }

    const wakeMs = nextAutomationWakeMs({
      now: Date.now(),
      nextRunAts,
      hasRunning,
      hasExpiringLease,
    });
    scheduleNext(wakeMs || AUTOMATION_SCHEDULER_DEFAULT_MS);
  };

  triggerRun();

  return {
    close: async () => {
      closed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      timer = null;
      await sweep;
      await Promise.allSettled([...executions]);
    },
  };
}

async function runDueWorkspaceAutomations(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  logger: ServerLogger,
  prefetchedTasks?: AutomationTaskItem[],
  resolveRuntimeKind: (workspaceId: string) => Promise<AgentRuntimeKind>
    = async () => "opencode",
  primaryRuntime?: AutomationPrimaryRuntime,
  signal?: AbortSignal,
  onExecution?: (execution: Promise<void>) => void,
) {
  await recordOverlappingAutomationSkips(workspace.path);
  const tasks = prefetchedTasks ?? (await listAutomations(workspace.path));
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
    if (signal?.aborted) return;
    const claimed = task;
    const execution = executeClaimedAutomation(
      config,
      workspace,
      claimed,
      logger,
      resolveRuntimeKind,
      primaryRuntime,
      signal,
    ).catch((error: unknown) => {
      logger.log("error", "Automation execution bookkeeping failed", {
        workspaceId: workspace.id,
        automationId: claimed.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    onExecution?.(execution);
    void execution;
    task = await claimDueAutomation(workspace.path);
  }
}

async function executeClaimedAutomation(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  task: ClaimedAutomationTask,
  logger: ServerLogger,
  resolveRuntimeKind: (workspaceId: string) => Promise<AgentRuntimeKind>,
  primaryRuntime?: AutomationPrimaryRuntime,
  signal?: AbortSignal,
) {
  let execution: AutomationExecution | null = null;
  try {
    execution = await startAutomationTask(config, workspace, task, {
      runtimeKind: await resolveRuntimeKind(workspace.id),
      primaryRuntime,
      signal,
    });
    await bindAutomationRunSession(
      workspace.path,
      task.id,
      task.running.leaseId,
      execution.sessionId,
      execution.groupName,
      execution.outputDirectory,
    );
    await waitForAutomationSession(config, workspace, execution, {
      ownership: {
        workspaceRoot: workspace.path,
        automationId: task.id,
        leaseId: task.running.leaseId,
      },
      primaryRuntime,
      signal,
    });
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
    // Stop/replace already finalized this generation — do not write a second outcome.
    if (
      isApiError(error)
      && (error.code === "automation_run_superseded"
        || error.code === "automation_scheduler_stopped")
    ) {
      logger.log("info", "Automation task wait ended after stop or replace", {
        workspaceId: workspace.id,
        automationId: task.id,
        leaseId: task.running.leaseId,
      });
      return;
    }
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

export async function resolveAutomationRunModel(
  task: Pick<AutomationTaskItem, "model" | "agent">,
): Promise<AutomationModel | undefined> {
  const direct = task.model ?? task.agent?.model;
  if (direct?.providerID?.trim() && direct?.modelID?.trim()) {
    return {
      providerID: direct.providerID.trim(),
      modelID: direct.modelID.trim(),
    };
  }
  return readAutomationModel();
}

export async function startAutomationTask(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  task: Pick<AutomationTaskItem, "title" | "prompt" | "workspaceDirectory" | "model" | "agent" | "accessMode">,
  options: {
    runtimeKind?: AgentRuntimeKind;
    primaryRuntime?: AutomationPrimaryRuntime;
    signal?: AbortSignal;
  } = {},
): Promise<AutomationExecution> {
  assertAutomationWaitActive(options.signal);
  const runtimeKind = options.runtimeKind ?? "opencode";
  if (options.primaryRuntime) {
    return startCanonicalAutomationTask(
      config,
      workspace,
      task,
      runtimeKind,
      options.primaryRuntime,
      options.signal,
    );
  }
  if (runtimeKind !== "opencode") {
    throw new ApiError(500, "automation_runtime_misconfigured", "Canonical runtime services are required for Grok Build automation");
  }
  // Resolve model before creating a session so empty-model runs fail fast
  // without leaving orphan sessions that only show the user prompt.
  const model = await resolveAutomationRunModel(task);
  if (!model) {
    throw new ApiError(
      400,
      "automation_model_missing",
      "Automation requires a model. Select a model in the automation task, or set a default model in OpenCode / app settings.",
    );
  }

  const workspaceRoot = task.workspaceDirectory?.trim() || workspace.path;
  const expertRuntimeTarget = await resolveExpertRuntimeDirectoryCandidate({
    workspaceId: workspace.id,
    sessionRoot: workspaceRoot,
    allowWorkspaceMismatch: true,
  });
  if (expertRuntimeTarget) {
    throw new ExpertRuntimeContractError(
      "authorized_directory",
      { workspace, sessionId: "", directory: workspaceRoot },
      "Automation cannot target an Expert runtime directory",
    );
  }
  const { groupName, outputDirectory } = await createAutomationOutputDirectory(workspaceRoot);
  const opencode = defaultOpencodeClientPool.get(config, workspace, outputDirectory);
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
  await upsertSessionOrigin(workspace, sessionId, {
    kind: "automation",
    ...(task.agent?.id?.trim() ? { agentId: task.agent.id.trim() } : {}),
    directory: outputDirectory,
  }).catch((error) => {
    console.warn("[automation] unable to persist session origin", sessionId, error);
  });

  const system = automationSystemPrompt(task);
  const executionPrompt = [
    task.prompt,
    "",
    `本次自动化任务的工作目录是：${outputDirectory}`,
    "请将本次任务生成的报告、文档、图片和其他文件全部保存到当前工作目录。",
    "请至少把最终结果保存为“执行结果.md”，不要把生成文件写到工作区的其他目录。",
  ].join("\n");
  const command = parseAutomationPromptCommand(task.prompt);
  if (command) {
    ensureOpencodeRequestSucceeded(
      await opencode.session.command({
        sessionID: sessionId,
        command: command.name,
        arguments: [
          command.arguments,
          `本次自动化任务的工作目录是：${outputDirectory}`,
          "请将本次任务生成的报告、文档、图片和其他文件全部保存到当前工作目录。",
          "请至少把最终结果保存为“执行结果.md”，不要把生成文件写到工作区的其他目录。",
        ].filter(Boolean).join("\n"),
        model: `${model.providerID}/${model.modelID}`,
      }),
      `/session/${encodeURIComponent(sessionId)}/command`,
    );
  } else {
    ensureOpencodeRequestSucceeded(
      await opencode.session.promptAsync({
        sessionID: sessionId,
        model,
        ...(task.agent?.tools ? { tools: task.agent.tools } : {}),
        ...(system ? { system } : {}),
        parts: [{ type: "text", text: executionPrompt }],
      }),
      `/session/${encodeURIComponent(sessionId)}/prompt`,
    );
  }
  return { sessionId, groupName, outputDirectory };
}

async function startCanonicalAutomationTask(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  task: Pick<AutomationTaskItem, "title" | "prompt" | "workspaceDirectory" | "model" | "agent" | "accessMode">,
  runtimeKind: AgentRuntimeKind,
  primaryRuntime: AutomationPrimaryRuntime,
  signal?: AbortSignal,
): Promise<AutomationExecution> {
  assertAutomationWaitActive(signal);
  const workspaceRoot = task.workspaceDirectory?.trim() || workspace.path;
  assertAutomationWorkspaceAuthorized(config, workspace, workspaceRoot);
  const expertRuntimeTarget = await resolveExpertRuntimeDirectoryCandidate({
    workspaceId: workspace.id,
    sessionRoot: workspaceRoot,
    allowWorkspaceMismatch: true,
  });
  if (expertRuntimeTarget) {
    throw new ExpertRuntimeContractError(
      "authorized_directory",
      { workspace, sessionId: "", directory: workspaceRoot },
      "Automation cannot target an Expert runtime directory",
    );
  }
  const modelRef = await resolveCanonicalAutomationModel(
    workspace.id,
    runtimeKind,
    task,
    primaryRuntime.registry,
  );
  assertAutomationWaitActive(signal);
  const { groupName, outputDirectory } = await createAutomationOutputDirectory(workspaceRoot);
  await writeFile(
    join(outputDirectory, "任务说明.md"),
    `# ${task.title}\n\n${task.prompt}\n`,
    "utf8",
  );
  const productSessionId = `automation-${shortId()}`;
  const systemPrompt = automationSystemPrompt(task);
  await primaryRuntime.registry.createSession({
    productSessionId,
    workspaceId: workspace.id,
    runtimeKind,
    modelRef,
    workingDirectory: outputDirectory,
    workingDirectoryRoots: [workspace.path, ...(config.authorizedRoots ?? [])],
    profile: {
      kind: "assistant",
      ...(systemPrompt ? { systemPrompt } : {}),
    },
  });
  const command = parseAutomationPromptCommand(task.prompt);
  const outputInstructions = [
    `本次自动化任务的工作目录是：${outputDirectory}`,
    "请将本次任务生成的报告、文档、图片和其他文件全部保存到当前工作目录。",
    "请至少把最终结果保存为“执行结果.md”，不要把生成文件写到工作区的其他目录。",
  ];
  try {
    if (command) {
      await primaryRuntime.registry.executeSessionCommand(
        workspace.id,
        productSessionId,
        command.name,
        {
          arguments: [command.arguments, ...outputInstructions]
            .filter(Boolean)
            .join("\n"),
        },
      );
    } else {
      await primaryRuntime.registry.promptSession(workspace.id, productSessionId, {
        text: [task.prompt, "", ...outputInstructions].join("\n"),
      });
    }
  } catch (error) {
    await primaryRuntime.registry.closeSession(workspace.id, productSessionId)
      .catch(() => undefined);
    throw error;
  }
  return {
    sessionId: productSessionId,
    groupName,
    outputDirectory,
    runtimeKind,
  };
}

function assertAutomationWorkspaceAuthorized(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  directory: string,
): void {
  const target = join(directory);
  const roots = [workspace.path, ...(config.authorizedRoots ?? [])];
  const authorized = roots.some((root) => {
    const relativePath = relative(resolve(root), resolve(target));
    return relativePath === ""
      || (relativePath !== ".."
        && !relativePath.startsWith(`..${sep}`)
        && !isAbsolute(relativePath));
  });
  if (!authorized) {
    throw new ApiError(
      403,
      "automation_workspace_unauthorized",
      "Automation workspace directory is outside the authorized roots",
    );
  }
}

async function resolveCanonicalAutomationModel(
  workspaceId: string,
  runtimeKind: AgentRuntimeKind,
  task: Pick<AutomationTaskItem, "model" | "agent">,
  registry: PrimaryRuntimeRegistry,
): Promise<AgentRuntimeModelRef> {
  if (runtimeKind === "opencode") {
    const model = await resolveAutomationRunModel(task);
    if (!model) {
      throw new ApiError(
        400,
        "automation_model_missing",
        "Automation requires an available OpenCode model",
      );
    }
    return { providerId: model.providerID, modelId: model.modelID };
  }

  const catalog = await registry.getModelCatalog(workspaceId, runtimeKind);
  if (catalog.auth.state !== "ready") {
    throw new ApiError(
      409,
      "agent_runtime_auth_required",
      "Grok Build authentication is required before running automation",
    );
  }
  const requested = task.model ?? task.agent?.model;
  const requestedModelId = requested?.providerID?.trim() === "grok-build"
    ? requested.modelID?.trim()
    : undefined;
  const selected = requestedModelId
    ? catalog.models.find((model) => model.available && model.ref.modelId === requestedModelId)?.ref
    : catalog.defaultModelRef
      ?? catalog.models.find((model) => model.available)?.ref;
  if (!selected) {
    throw new ApiError(
      400,
      "automation_model_missing",
      "Automation requires an available Grok Build model",
    );
  }
  return selected.modelId === "grok-4.5" && !selected.variant
    ? { ...selected, variant: "low" }
    : selected;
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

export type AutomationWaitOwnership = {
  workspaceRoot: string;
  automationId: string;
  leaseId: string;
};

export type AutomationWaitOptions = {
  ownership?: AutomationWaitOwnership;
  primaryRuntime?: AutomationPrimaryRuntime;
  signal?: AbortSignal;
};

export async function waitForAutomationSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  execution: AutomationExecution,
  options: AutomationWaitOptions = {},
): Promise<void> {
  if (options.primaryRuntime && execution.runtimeKind) {
    return waitForCanonicalAutomationSession(
      workspace,
      execution,
      options,
    );
  }
  const ownership = options.ownership;
  const opencode = defaultOpencodeClientPool.get(config, workspace, execution.outputDirectory);
  const startedAt = Date.now();
  const timeoutAt = startedAt + 2 * 60 * 60 * 1000;
  let observedActive = false;
  let inactiveSince: number | null = null;
  // Ownership is product-level; poll every few ticks instead of every second.
  let ownershipCheckCounter = 0;
  const OWNERSHIP_CHECK_EVERY_TICKS = 3;

  while (Date.now() < timeoutAt) {
    assertAutomationWaitActive(options.signal);
    if (ownership) {
      ownershipCheckCounter += 1;
      if (ownershipCheckCounter === 1 || ownershipCheckCounter % OWNERSHIP_CHECK_EVERY_TICKS === 0) {
        await assertAutomationLeaseStillHeld(ownership);
      }
    }

    const statuses = buildSessionStatuses(
      unwrapOpencodeResult(await opencode.session.status(), "/session/status"),
    );
    const status = statuses[execution.sessionId];
    const statusType =
      status?.type === "busy" || status?.type === "retry" || status?.type === "idle"
        ? status.type
        : "missing";

    let hasSavedOutput = false;
    let hasSessionError = false;
    let sessionErrorMessage: string | null = null;
    if (statusType === "idle" || statusType === "missing") {
      hasSavedOutput = await saveAutomationSessionOutput(opencode, execution);
      if (!hasSavedOutput) {
        sessionErrorMessage = await readAutomationSessionError(opencode, execution);
        hasSessionError = Boolean(sessionErrorMessage);
      }
    }

    const decision = decideAutomationWaitTick({
      statusType,
      observedActive,
      inactiveSince,
      now: Date.now(),
      startedAt,
      hasSavedOutput,
      hasSessionError,
    });
    observedActive = decision.observedActive;
    inactiveSince = decision.inactiveSince;

    if (decision.action === "complete") return;
    if (decision.action === "fail_error") {
      throw new ApiError(
        502,
        "automation_session_failed",
        sessionErrorMessage || "Automation session failed",
      );
    }
    if (decision.action === "fail_empty") {
      throw new ApiError(
        502,
        "automation_empty_output",
        "OpenCode completed without assistant output. Check that the selected model is available, then re-run the automation.",
      );
    }

    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, 1_000);
    });
  }

  throw new ApiError(504, "automation_timeout", "Automation session timed out");
}

async function waitForCanonicalAutomationSession(
  workspace: WorkspaceInfo,
  execution: AutomationExecution,
  options: AutomationWaitOptions,
): Promise<void> {
  const primaryRuntime = options.primaryRuntime;
  if (!primaryRuntime) {
    throw new ApiError(
      500,
      "automation_runtime_misconfigured",
      "Canonical runtime services are unavailable",
    );
  }
  const startedAt = Date.now();
  const timeoutAt = startedAt + 2 * 60 * 60 * 1000;
  let ownershipCheckCounter = 0;
  let completionObservedAt: number | null = null;
  while (Date.now() < timeoutAt) {
    assertAutomationWaitActive(options.signal);
    if (options.ownership) {
      ownershipCheckCounter += 1;
      if (ownershipCheckCounter === 1 || ownershipCheckCounter % 3 === 0) {
        await assertAutomationLeaseStillHeld(options.ownership);
      }
    }
    const snapshot = primaryRuntime.events.snapshot(execution.sessionId);
    const terminal = snapshot.events.slice().reverse().find((event) =>
      event.kind === "turn.completed" || event.kind === "session.error");
    if (terminal?.kind === "session.error") {
      throw new ApiError(
        502,
        "automation_session_failed",
        terminal.error.message,
      );
    }
    if (terminal?.kind === "turn.completed") {
      if (terminal.outcome !== "completed") {
        throw new ApiError(
          502,
          "automation_session_failed",
          terminal.error?.message || `Automation session ${terminal.outcome}`,
        );
      }
      completionObservedAt ??= Date.now();
    }
    const output = await saveCanonicalAutomationSessionOutput(
      primaryRuntime.registry,
      workspace,
      execution,
    );
    if (output.saved && (completionObservedAt !== null || output.completed)) {
      return;
    }
    if (completionObservedAt !== null && Date.now() - completionObservedAt >= 10_000) {
      throw new ApiError(
        502,
        "automation_empty_output",
        "Runtime completed without assistant output",
      );
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new ApiError(504, "automation_timeout", "Automation session timed out");
}

function assertAutomationWaitActive(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new ApiError(
    409,
    "automation_scheduler_stopped",
    "Automation scheduler stopped before the run completed",
  );
}

async function assertAutomationLeaseStillHeld(
  ownership: AutomationWaitOwnership,
): Promise<void> {
  const tasks = await listAutomations(ownership.workspaceRoot);
  const task = tasks.find((item) => item.id === ownership.automationId);
  if (!task?.running || task.running.leaseId !== ownership.leaseId) {
    throw new ApiError(
      409,
      "automation_run_superseded",
      "Automation run was stopped or replaced by a newer generation",
    );
  }
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

export async function reconcileAutomationRuns(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  primaryRuntime?: AutomationPrimaryRuntime,
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
        if (primaryRuntime) {
          try {
            const output = await saveCanonicalAutomationSessionOutput(
              primaryRuntime.registry,
              workspace,
              {
                sessionId: run.sessionId,
                groupName: run.groupName ?? basename(run.outputDirectory),
                outputDirectory: run.outputDirectory,
              },
            );
            if (output.saved && output.completed) {
              await reconcileAutomationRunSuccess(workspace.path, automation.id, run.ranAt);
            }
            continue;
          } catch (error) {
            if (!isUnboundCanonicalAutomation(error)) continue;
          }
        }
        const opencode = defaultOpencodeClientPool.get(config, workspace, run.outputDirectory);
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
    // Clear stuck "运行中" leases when the session already finished or the lease expired.
    await reconcileStuckRunningLease(
      config,
      workspace,
      automation,
      primaryRuntime,
    ).catch(() => undefined);
  }
}

/**
 * If a run lease is still held but the session is idle (or the lease expired),
 * finalize the run so the UI does not spin "运行中" forever.
 */
async function reconcileStuckRunningLease(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  automation: AutomationTaskItem,
  primaryRuntime?: AutomationPrimaryRuntime,
) {
  const running = automation.running;
  if (!running) return;
  const now = Date.now();
  const leaseExpired = running.expiresAt <= now;

  if (!running.sessionId || !running.outputDirectory) {
    if (!leaseExpired) return;
    await recordAutomationRun(
      workspace.path,
      automation.id,
      {
        status: "failed",
        source: "scheduled",
        ranAt: now,
        error: "Automation run lease expired before a session started",
      },
      running.leaseId,
    );
    return;
  }

  const execution: AutomationExecution = {
    sessionId: running.sessionId,
    groupName: running.groupName ?? basename(running.outputDirectory),
    outputDirectory: running.outputDirectory,
  };

  if (primaryRuntime) {
    try {
      const canonicalOutput = await saveCanonicalAutomationSessionOutput(
        primaryRuntime.registry,
        workspace,
        execution,
      );
      if (canonicalOutput.saved && canonicalOutput.completed) {
        await recordAutomationRun(
          workspace.path,
          automation.id,
          {
            status: "success",
            source: "scheduled",
            ranAt: now,
            sessionId: execution.sessionId,
            groupName: execution.groupName,
            outputDirectory: execution.outputDirectory,
          },
          running.leaseId,
        );
        return;
      }
      if (!leaseExpired) return;
      await recordAutomationRun(
        workspace.path,
        automation.id,
        {
          status: "failed",
          source: "scheduled",
          ranAt: now,
          error: "Automation run lease expired before completion",
          sessionId: execution.sessionId,
          groupName: execution.groupName,
          outputDirectory: execution.outputDirectory,
        },
        running.leaseId,
      );
      return;
    } catch (error) {
      if (!isUnboundCanonicalAutomation(error)) {
        if (!leaseExpired) return;
        await recordAutomationRun(
          workspace.path,
          automation.id,
          {
            status: "failed",
            source: "scheduled",
            ranAt: now,
            error: "Automation run lease expired before completion",
            sessionId: execution.sessionId,
            groupName: execution.groupName,
            outputDirectory: execution.outputDirectory,
          },
          running.leaseId,
        );
        return;
      }
    }
  }

  try {
    const opencode = defaultOpencodeClientPool.get(
      config,
      workspace,
      execution.outputDirectory,
    );
    const statuses = buildSessionStatuses(
      unwrapOpencodeResult(await opencode.session.status(), "/session/status"),
    );
    const status = statuses[execution.sessionId];
    const statusType =
      status?.type === "busy" || status?.type === "retry" || status?.type === "idle"
        ? status.type
        : "missing";

    // Still actively generating — leave the lease alone unless expired.
    if ((statusType === "busy" || statusType === "retry") && !leaseExpired) {
      return;
    }

    const hasSavedOutput = await saveAutomationSessionOutput(opencode, execution);
    if (hasSavedOutput) {
      await recordAutomationRun(
        workspace.path,
        automation.id,
        {
          status: "success",
          source: "scheduled",
          ranAt: now,
          sessionId: execution.sessionId,
          groupName: execution.groupName,
          outputDirectory: execution.outputDirectory,
        },
        running.leaseId,
      );
      return;
    }

    // Idle/missing with no salvageable output: only force-close when expired
    // or the session has been idle long enough after start.
    const idleLongEnough = now - running.startedAt >= 60_000;
    if (!leaseExpired && !idleLongEnough) return;

    const sessionError = await readAutomationSessionError(opencode, execution);
    await recordAutomationRun(
      workspace.path,
      automation.id,
      {
        status: "failed",
        source: "scheduled",
        ranAt: now,
        error:
          sessionError ||
          (leaseExpired
            ? "Automation run lease expired before completion"
            : "Automation session finished without output"),
        sessionId: execution.sessionId,
        groupName: execution.groupName,
        outputDirectory: execution.outputDirectory,
      },
      running.leaseId,
    );
  } catch {
    if (!leaseExpired) return;
    await recordAutomationRun(
      workspace.path,
      automation.id,
      {
        status: "failed",
        source: "scheduled",
        ranAt: now,
        error: "Automation run lease expired before completion",
        sessionId: running.sessionId,
        groupName: running.groupName,
        outputDirectory: running.outputDirectory,
      },
      running.leaseId,
    );
  }
}

/** Product layout root for task / automation outputs (Files → 任务文件). */
const TASKS_LAYOUT_DIR = "tasks";

async function createAutomationOutputDirectory(workspaceRoot: string) {
  let timestamp = Date.now();
  const tasksRoot = join(workspaceRoot, TASKS_LAYOUT_DIR);
  await mkdir(tasksRoot, { recursive: true });
  while (true) {
    const groupName = automationGroupName(timestamp);
    const outputDirectory = join(tasksRoot, groupName);
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

async function saveCanonicalAutomationSessionOutput(
  registry: PrimaryRuntimeRegistry,
  workspace: WorkspaceInfo,
  execution: AutomationExecution,
): Promise<{ saved: boolean; completed: boolean }> {
  const resultPath = join(execution.outputDirectory, "执行结果.md");
  let existingOutput = false;
  try {
    if ((await readFile(resultPath, "utf8")).trim()) {
      existingOutput = true;
    }
  } catch {
  }
  const response = await registry.readSessionMessages(
    workspace.id,
    execution.sessionId,
  );
  const assistantText = response.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts.map(readAutomationTextPart))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!assistantText) {
    return {
      saved: existingOutput,
      completed: existingOutput && completionObservedAtFromMessages(response.messages),
    };
  }
  if (!existingOutput) {
    await writeFile(resultPath, `${assistantText}\n`, "utf8");
  }
  return {
    saved: true,
    completed: completionObservedAtFromMessages(response.messages),
  };
}

function completionObservedAtFromMessages(
  messages: readonly import("@onmyagent/types/agent-runtime").AgentRuntimeMessage[],
): boolean {
  return messages.some((message) =>
    message.role === "assistant" && message.completedAt !== undefined);
}

export function isUnboundCanonicalAutomation(error: unknown): boolean {
  return isApiError(error) && error.code === "runtime_session_binding_not_found";
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
