import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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
import { ApiError } from "../core/errors.js";
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
  buildSessionMessages,
  buildSessionStatuses,
} from "./session-read-model.js";

export type AutomationExecution = {
  sessionId: string;
  groupName: string;
  outputDirectory: string;
};

type AutomationModel = {
  providerID: string;
  modelID: string;
};

export function startAutomationScheduler(config: ServerConfig, logger: ServerLogger) {
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

export async function startAutomationTask(
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
        ...(model ? { model: `${model.providerID}/${model.modelID}` } : {}),
      }),
      `/session/${encodeURIComponent(sessionId)}/command`,
    );
  } else {
    ensureOpencodeRequestSucceeded(
      await opencode.session.promptAsync({
        sessionID: sessionId,
        ...(model ? { model } : {}),
        ...(task.agent?.tools ? { tools: task.agent.tools } : {}),
        ...(system ? { system } : {}),
        parts: [{ type: "text", text: executionPrompt }],
      }),
      `/session/${encodeURIComponent(sessionId)}/prompt`,
    );
  }
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

export async function waitForAutomationSession(
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

export async function reconcileAutomationRuns(
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
