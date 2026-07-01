import {
  claimDueHeartbeatJobs,
  createHeartbeatJob,
  deleteHeartbeatJob,
  listHeartbeatJobs,
  listHeartbeatRuns,
  markHeartbeatRunStarted,
  recordHeartbeatRun,
  updateHeartbeatJob,
} from "./heartbeat-store.mjs";

const DEFAULT_POLL_MS = 30_000;
const DEFAULT_RUN_POLL_MS = 1_000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "missing"]);

function promptForJob(job) {
  const sessionContext = String(job.sessionContext ?? "").trim();
  if (!sessionContext) return job.prompt;
  return [
    "You are running a scheduled task that is bound to an existing Studio local-agent session.",
    "First read the bound session context below and execute the latest pending user intent from that session. The schedule firing means deferred wording such as later, soon, 一会, 之后, or 到点 is now due.",
    "If the bound session context conflicts with the scheduled task instruction, the bound session context wins. Use the scheduled task instruction only as the recurrence trigger/cadence unless there is no pending user intent in the session.",
    "Do not replace a concrete pending session request with a generic workspace check unless that generic check is explicitly what the bound session asked for.",
    "",
    "<bound_session_context>",
    sessionContext,
    "</bound_session_context>",
    "",
    "<scheduled_task_instruction>",
    job.prompt,
    "</scheduled_task_instruction>",
  ].join("\n");
}

function normalizeWorkspaceRoot(input) {
  const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
  if (!workspaceRoot) throw new Error("workspaceRoot is required");
  return workspaceRoot;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPersonalAgentHeartbeatScheduler(options = {}) {
  const runtime = options.personalAgentRuntime;
  if (!runtime?.startMessage || !runtime?.getRun) {
    throw new Error("personalAgentRuntime with startMessage/getRun is required");
  }
  const workspaceRoots = new Set();
  const runningJobs = new Set();
  const pollMs = Number(options.pollMs) > 0 ? Number(options.pollMs) : DEFAULT_POLL_MS;
  const runPollMs = Number(options.runPollMs) > 0 ? Number(options.runPollMs) : DEFAULT_RUN_POLL_MS;
  let closed = false;
  let timer = null;

  function register(workspaceRoot) {
    workspaceRoots.add(workspaceRoot);
    scheduleTick();
  }

  function scheduleTick() {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, pollMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  async function refreshWorkspaceRoots() {
    if (closed || typeof options.listWorkspaceRoots !== "function") return [];
    const roots = await options.listWorkspaceRoots().catch(() => []);
    const registered = [];
    for (const item of Array.isArray(roots) ? roots : []) {
      const workspaceRoot = String(item ?? "").trim();
      if (!workspaceRoot) continue;
      register(workspaceRoot);
      registered.push(workspaceRoot);
    }
    return registered;
  }

  async function waitForTerminalRun(workspaceRoot, runId) {
    let snapshot = await runtime.getRun({ runId, workspaceRoot });
    for (let attempt = 0; !TERMINAL_STATUSES.has(snapshot.status) && attempt < 21_600; attempt += 1) {
      await sleep(runPollMs);
      snapshot = await runtime.getRun({ runId, workspaceRoot });
    }
    return snapshot;
  }

  async function executeJob(workspaceRoot, job, force = false) {
    const key = `${workspaceRoot}\n${job.id}`;
    if (runningJobs.has(key)) return null;
    runningJobs.add(key);
    try {
      const started = await runtime.startMessage({
        workspaceRoot,
        prompt: promptForJob(job),
        approvalMode: job.approvalMode,
        conversationId: job.conversationId,
        agent: job.agent,
      });
      await markHeartbeatRunStarted(workspaceRoot, job.id, started.runId);
      if (!started.runId && !TERMINAL_STATUSES.has(started.status)) {
        return recordHeartbeatRun(workspaceRoot, job.id, {
          ...started,
          status: "failed",
          error: "scheduled task runtime did not return a run id",
          finishedAt: Date.now(),
        });
      }
      const terminal = TERMINAL_STATUSES.has(started.status)
        ? started
        : await waitForTerminalRun(workspaceRoot, started.runId);
      return recordHeartbeatRun(workspaceRoot, job.id, terminal);
    } catch (error) {
      return recordHeartbeatRun(workspaceRoot, job.id, {
        runId: null,
        status: "failed",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        output: "",
      });
    } finally {
      runningJobs.delete(key);
      if (!force) scheduleTick();
    }
  }

  async function tick() {
    if (closed) return;
    await refreshWorkspaceRoots();
    for (const workspaceRoot of workspaceRoots) {
      const dueJobs = await claimDueHeartbeatJobs(workspaceRoot);
      for (const job of dueJobs) {
        void executeJob(workspaceRoot, job);
      }
    }
    scheduleTick();
  }

  async function list(input = {}) {
    const workspaceRoot = normalizeWorkspaceRoot(input);
    register(workspaceRoot);
    return { jobs: await listHeartbeatJobs(workspaceRoot) };
  }

  async function create(input = {}) {
    const workspaceRoot = normalizeWorkspaceRoot(input);
    register(workspaceRoot);
    const job = await createHeartbeatJob(workspaceRoot, input);
    return { job };
  }

  async function update(input = {}) {
    const workspaceRoot = normalizeWorkspaceRoot(input);
    register(workspaceRoot);
    const job = await updateHeartbeatJob(workspaceRoot, input.jobId, input.patch ?? input);
    if (!job) return { ok: false, error: "heartbeat job not found" };
    return { ok: true, job };
  }

  async function remove(input = {}) {
    const workspaceRoot = normalizeWorkspaceRoot(input);
    register(workspaceRoot);
    return deleteHeartbeatJob(workspaceRoot, input.jobId);
  }

  async function runNow(input = {}) {
    const workspaceRoot = normalizeWorkspaceRoot(input);
    register(workspaceRoot);
    const jobs = await listHeartbeatJobs(workspaceRoot);
    const job = jobs.find((item) => item.id === String(input.jobId ?? ""));
    if (!job) return { ok: false, error: "heartbeat job not found" };
    if (job.running) return { ok: false, error: "heartbeat job already running" };
    const now = Date.now();
    await updateHeartbeatJob(workspaceRoot, job.id, { nextRunAt: now });
    const claimedJobs = await claimDueHeartbeatJobs(workspaceRoot, now);
    const claimed = claimedJobs.find((item) => item.id === job.id);
    if (!claimed) return { ok: false, error: "heartbeat job already running" };
    const result = await executeJob(workspaceRoot, claimed, true);
    return { ok: true, job: result };
  }

  async function runs(input = {}) {
    const workspaceRoot = normalizeWorkspaceRoot(input);
    register(workspaceRoot);
    return { runs: await listHeartbeatRuns(workspaceRoot, input.jobId) };
  }

  async function close() {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  void refreshWorkspaceRoots().then(() => tick()).catch(() => undefined);

  return { list, create, update, delete: remove, runNow, runs, tick, refreshWorkspaceRoots, close };
}
