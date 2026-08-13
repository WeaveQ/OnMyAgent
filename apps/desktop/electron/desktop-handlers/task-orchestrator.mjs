/**
 * Neutral Task Center orchestration handlers.
 *
 * The service owns task state and gives one primary agent a capability-scoped
 * depth-one worker control plane backed by the Personal Local Agent runtime.
 * Renderer callers never access worker stores or control capabilities directly.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "taskOrchestratorTasksList",
  "taskOrchestratorTaskGet",
  "taskOrchestratorRunsList",
  "taskOrchestratorTurnHistoryList",
  "taskOrchestratorEventsList",
  "taskOrchestratorArtifactsList",
  "taskOrchestratorArtifactGet",
  "taskOrchestratorArtifactContentGet",
  "taskOrchestratorTaskArchive",
  "taskOrchestratorTaskRestore",
  "taskOrchestratorTaskPurge",
  "taskOrchestratorTaskExportManifest",
  "taskOrchestratorMaintenanceRun",
  "taskOrchestratorHealthGet",
  "taskOrchestratorOperationsDiagnosticsGet",
  "taskOrchestratorTaskCreate",
  "taskOrchestratorTaskUpdate",
  "taskOrchestratorAlignmentMessage",
  "taskOrchestratorAlignmentCancel",
  "taskOrchestratorContractFinalize",
  "taskOrchestratorTaskStart",
  "taskOrchestratorTaskStop",
  "taskOrchestratorTaskPause",
  "taskOrchestratorTaskResume",
  "taskOrchestratorPrimaryRetry",
  "taskOrchestratorRecoveryContinue",
  "taskOrchestratorNodeRetry",
  "taskOrchestratorGateResolve",
]);

/**
 * @param {{ taskOrchestrator?: Record<string, Function> }} deps
 * @returns {Record<string, (event: unknown, args: unknown[]) => unknown>}
 */
export function createTaskOrchestratorDomainHandlers({ taskOrchestrator } = {}) {
  function service() {
    if (!taskOrchestrator) {
      throw new Error("taskOrchestrator is required");
    }
    return taskOrchestrator;
  }
  return {
    taskOrchestratorTasksList: (_event, args) =>
      service().listTasks(args[0] ?? {}),
    taskOrchestratorTaskGet: (_event, args) =>
      service().getTask(args[0] ?? {}),
    taskOrchestratorRunsList: (_event, args) =>
      service().listRuns(args[0] ?? {}),
    taskOrchestratorTurnHistoryList: (_event, args) =>
      service().listTurnHistory(args[0] ?? {}),
    taskOrchestratorEventsList: (_event, args) =>
      service().listEvents(args[0] ?? {}),
    taskOrchestratorArtifactsList: (_event, args) =>
      service().listArtifacts(args[0] ?? {}),
    taskOrchestratorArtifactGet: (_event, args) =>
      service().getArtifact(args[0] ?? {}),
    taskOrchestratorArtifactContentGet: (_event, args) =>
      service().getArtifactContent(args[0] ?? {}),
    taskOrchestratorTaskArchive: (_event, args) =>
      service().archiveTask(args[0] ?? {}),
    taskOrchestratorTaskRestore: (_event, args) =>
      service().restoreTask(args[0] ?? {}),
    taskOrchestratorTaskPurge: (_event, args) =>
      service().purgeTask(args[0] ?? {}),
    taskOrchestratorTaskExportManifest: (_event, args) =>
      service().exportTaskManifest(args[0] ?? {}),
    taskOrchestratorMaintenanceRun: (_event, args) =>
      service().runMaintenance(args[0] ?? {}),
    taskOrchestratorHealthGet: (_event, args) =>
      service().getHealth(args[0] ?? {}),
    taskOrchestratorOperationsDiagnosticsGet: (_event, args) =>
      service().getOperationsDiagnostics(args[0] ?? {}),
    taskOrchestratorTaskCreate: (_event, args) =>
      service().createTask(args[0] ?? {}),
    taskOrchestratorAlignmentMessage: (_event, args) =>
      service().sendAlignmentMessage(args[0] ?? {}),
    taskOrchestratorAlignmentCancel: (_event, args) =>
      service().cancelAlignment(args[0] ?? {}),
    taskOrchestratorContractFinalize: (_event, args) =>
      service().finalizeContract(args[0] ?? {}),
    taskOrchestratorTaskUpdate: (_event, args) =>
      service().updateTask(args[0] ?? {}),
    taskOrchestratorTaskStart: (_event, args) =>
      service().startTask(args[0] ?? {}),
    taskOrchestratorTaskStop: (_event, args) =>
      service().stopRun(args[0] ?? {}),
    taskOrchestratorTaskPause: (_event, args) =>
      service().pauseTask(args[0] ?? {}),
    taskOrchestratorTaskResume: (_event, args) =>
      service().resumeTask(args[0] ?? {}),
    taskOrchestratorPrimaryRetry: (_event, args) =>
      service().retryPrimary(args[0] ?? {}),
    taskOrchestratorRecoveryContinue: (_event, args) =>
      service().continueRecovery(args[0] ?? {}),
    taskOrchestratorNodeRetry: (_event, args) =>
      service().retryNode(args[0] ?? {}),
    taskOrchestratorGateResolve: (_event, args) =>
      service().resolveGate(args[0] ?? {}),
  };
}
