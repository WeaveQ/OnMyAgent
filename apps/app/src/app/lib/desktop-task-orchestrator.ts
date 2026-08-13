/**
 * Typed renderer bridge for the desktop-owned Task Orchestrator control plane.
 *
 * Task Center deliberately talks only through this neutral IPC surface. It does
 * not reach into the Personal Local Agent renderer domain or duplicate the
 * desktop store in browser state.
 */
import type {
  TaskOrchestratorArtifactContentGetInput,
  TaskOrchestratorArtifactContentResult,
  TaskOrchestratorArtifactGetInput,
  TaskOrchestratorArtifactsListInput,
  TaskOrchestratorEventsListInput,
  TaskOrchestratorRunsListInput,
  TaskOrchestratorTurnHistoryListInput,
  TaskOrchestratorTurnHistoryListResult,
  TaskOrchestratorOperationsDiagnostics,
  TaskOrchestratorOperationsDiagnosticsGetInput,
  TaskOrchestratorAlignmentMessageInput,
  TaskOrchestratorFinalizeContractInput,
  TaskOrchestratorResolveGateInput,
  TaskOrchestratorRecoveryInput,
  TaskOrchestratorRetryInput,
  TaskOrchestratorRunIdInput,
  TaskOrchestratorDesktopEvent,
  TaskOrchestratorTaskCreateInput,
  TaskOrchestratorTaskArchiveInput,
  TaskOrchestratorTaskGetInput,
  TaskOrchestratorTaskIdInput,
  TaskOrchestratorTaskListInput,
  TaskOrchestratorTaskRestoreInput,
  TaskOrchestratorTaskUpdateInput,
} from "@onmyagent/types";

import { invokeDesktopCommand } from "./desktop-invoke";

export const taskOrchestratorTasksList = (
  input: TaskOrchestratorTaskListInput = {},
) => invokeDesktopCommand("taskOrchestratorTasksList", input);

export const taskOrchestratorTaskGet = (
  input: TaskOrchestratorTaskGetInput,
) => invokeDesktopCommand("taskOrchestratorTaskGet", input);

export const taskOrchestratorRunsList = (
  input: TaskOrchestratorRunsListInput,
) => invokeDesktopCommand("taskOrchestratorRunsList", input);

export const taskOrchestratorTurnHistoryList = (
  input: TaskOrchestratorTurnHistoryListInput,
): Promise<TaskOrchestratorTurnHistoryListResult> =>
  invokeDesktopCommand("taskOrchestratorTurnHistoryList", input);

export const taskOrchestratorOperationsDiagnosticsGet = (
  input: TaskOrchestratorOperationsDiagnosticsGetInput,
): Promise<TaskOrchestratorOperationsDiagnostics> =>
  invokeDesktopCommand("taskOrchestratorOperationsDiagnosticsGet", input);

export const taskOrchestratorEventsList = (
  input: TaskOrchestratorEventsListInput,
) => invokeDesktopCommand("taskOrchestratorEventsList", input);

export const taskOrchestratorArtifactsList = (
  input: TaskOrchestratorArtifactsListInput,
) => invokeDesktopCommand("taskOrchestratorArtifactsList", input);

export const taskOrchestratorArtifactGet = (
  input: TaskOrchestratorArtifactGetInput,
) => invokeDesktopCommand("taskOrchestratorArtifactGet", input);

export const taskOrchestratorArtifactContentGet = (
  input: TaskOrchestratorArtifactContentGetInput,
): Promise<TaskOrchestratorArtifactContentResult> =>
  invokeDesktopCommand("taskOrchestratorArtifactContentGet", input);

export const taskOrchestratorTaskCreate = (
  input: TaskOrchestratorTaskCreateInput,
) => invokeDesktopCommand("taskOrchestratorTaskCreate", input);

export const taskOrchestratorTaskArchive = (
  input: TaskOrchestratorTaskArchiveInput,
) => invokeDesktopCommand("taskOrchestratorTaskArchive", input);

export const taskOrchestratorTaskRestore = (
  input: TaskOrchestratorTaskRestoreInput,
) => invokeDesktopCommand("taskOrchestratorTaskRestore", input);

export const taskOrchestratorAlignmentMessage = (
  input: TaskOrchestratorAlignmentMessageInput,
) => invokeDesktopCommand("taskOrchestratorAlignmentMessage", input);

export const taskOrchestratorAlignmentCancel = (
  input: TaskOrchestratorTaskIdInput,
) => invokeDesktopCommand("taskOrchestratorAlignmentCancel", input);

export const taskOrchestratorContractFinalize = (
  input: TaskOrchestratorFinalizeContractInput,
) => invokeDesktopCommand("taskOrchestratorContractFinalize", input);

export const taskOrchestratorTaskUpdate = (
  input: TaskOrchestratorTaskUpdateInput,
) => invokeDesktopCommand("taskOrchestratorTaskUpdate", input);

export const taskOrchestratorTaskStart = (
  input: TaskOrchestratorTaskIdInput,
) => invokeDesktopCommand("taskOrchestratorTaskStart", input);

export const taskOrchestratorTaskStop = (
  input: TaskOrchestratorRunIdInput,
) => invokeDesktopCommand("taskOrchestratorTaskStop", input);

export const taskOrchestratorTaskPause = (
  input: TaskOrchestratorRunIdInput,
) => invokeDesktopCommand("taskOrchestratorTaskPause", input);

export const taskOrchestratorTaskResume = (
  input: TaskOrchestratorRunIdInput,
) => invokeDesktopCommand("taskOrchestratorTaskResume", input);

export const taskOrchestratorNodeRetry = (
  input: TaskOrchestratorRetryInput,
) => invokeDesktopCommand("taskOrchestratorNodeRetry", input);

export const taskOrchestratorPrimaryRetry = (
  input: TaskOrchestratorRetryInput,
) => invokeDesktopCommand("taskOrchestratorPrimaryRetry", input);

export const taskOrchestratorRecoveryContinue = (
  input: TaskOrchestratorRecoveryInput,
) => invokeDesktopCommand("taskOrchestratorRecoveryContinue", input);

export const taskOrchestratorGateResolve = (
  input: TaskOrchestratorResolveGateInput,
) => invokeDesktopCommand("taskOrchestratorGateResolve", input);

export function subscribeTaskOrchestratorEvents(
  callback: (event: TaskOrchestratorDesktopEvent) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.taskOrchestrator?.onEvent?.(callback) ??
    (() => undefined)
  );
}
