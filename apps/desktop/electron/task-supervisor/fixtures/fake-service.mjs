let eventListener = null;
let calls = 0;

export function createTaskSupervisorService() {
  return {
    subscribe(listener) {
      eventListener = listener;
      return () => { if (eventListener === listener) eventListener = null; };
    },
    async listTasks() {
      calls += 1;
      eventListener?.({ type: "fake-progress", calls });
      return {
        tasks: [{ id: "fake-task", calls }],
        issues: process.env.ONMYAGENT_TASK_SUPERVISOR_ENV_SNAPSHOT_TEST
          ? [{ environmentSnapshot: process.env.ONMYAGENT_TASK_SUPERVISOR_ENV_SNAPSHOT_TEST }]
          : [],
      };
    },
    async getTask(input) {
      return { task: { id: String(input?.taskId ?? "fake-task") }, run: null, artifacts: [], events: [], gates: [] };
    },
    async listRuns(input) {
      return { runs: [{ id: "fake-run", taskId: input?.taskId }], nextCursor: null, hasMore: false };
    },
    async listEvents(input) {
      return { events: [{ id: "fake-event", taskId: input?.taskId }], nextCursor: input?.cursor ?? 0, hasMore: false };
    },
    async listArtifacts(input) {
      return { artifacts: [{ id: "fake-artifact", taskRunId: input?.taskRunId }], nextCursor: null, hasMore: false };
    },
    async getArtifact(input) {
      return { id: input?.artifactId, content: "full fake artifact" };
    },
    async getArtifactContent(input) {
      return {
        artifact: { id: input?.artifactId },
        offset: input?.offset ?? 0,
        contentChunk: "fake chunk",
        nextOffset: null,
        complete: true,
        totalChars: 10,
        evidenceOffset: input?.evidenceOffset ?? 0,
        evidence: [],
        nextEvidenceOffset: null,
        evidenceComplete: true,
        totalEvidence: 0,
      };
    },
    async archiveTask(input) {
      return { task: { id: input?.taskId, definitionStatus: "archived" } };
    },
    async restoreTask(input) {
      return { task: { id: input?.taskId, definitionStatus: "ready" } };
    },
    async purgeTask(input) {
      return { ok: true, taskId: input?.taskId, taskRevision: input?.expectedRevision, manifestSha256: input?.manifestSha256, auditId: "purge-fake", purgedAt: Date.now() };
    },
    async exportTaskManifest(input) {
      return { taskId: input?.taskId, manifestSha256: "a".repeat(64), entries: [], nextCursor: null, hasMore: false };
    },
    async runMaintenance() {
      return { protectedRows: { tasks: 1, runs: 1, artifacts: 1 } };
    },
    async getHealth() {
      return { healthy: true, rows: { tasks: 1 } };
    },
    async getOperationsDiagnostics() {
      return { version: 1, generatedAt: 1, truncated: true };
    },
    async activeWorkStatus() {
      return { active: false, activeCount: 0, tasks: [], truncated: false };
    },
    async pauseAllAndDrain(reason) {
      if (process.env.ONMYAGENT_TASK_SUPERVISOR_FAIL_DRAIN === "1") {
        throw Object.assign(new Error("fake drain failed"), { code: "FAKE_DRAIN_FAILED" });
      }
      return { ok: true, reason };
    },
  };
}
