/**
 * Pure helpers extracted from personal-agent-runtime/index.mjs.
 * Safe to unit-test without spawning agents or Electron.
 */

/**
 * @param {unknown} value
 * @returns {"auto" | "ask" | "read-only-auto"}
 */
export function normalizeApprovalMode(value) {
  const mode = String(value ?? "ask").trim();
  if (mode === "auto" || mode === "ask" || mode === "read-only-auto") return mode;
  return "ask";
}

/**
 * @param {unknown} input
 * @returns {{ runId: string, workspaceRoot: string }}
 */
export function parseStatusInput(input) {
  if (input && typeof input === "object") {
    const row = /** @type {Record<string, unknown>} */ (input);
    return {
      runId: String(row.runId ?? row.id ?? "").trim(),
      workspaceRoot: String(row.workspaceRoot ?? "").trim(),
    };
  }
  return { runId: String(input ?? "").trim(), workspaceRoot: "" };
}

/**
 * @param {unknown} params
 * @returns {unknown}
 */
export function sanitizeApprovalParams(params) {
  if (!params || typeof params !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(params));
  } catch {
    return { raw: String(params) };
  }
}

/**
 * @param {string} provider
 * @param {{ name?: string, connectionType?: string, supportsAcp?: boolean } | null} [agent]
 */
export function defaultConnectionMode(provider, agent = null) {
  if (provider === "opencode") return "OpenCode ACP session";
  if (provider === "codex") return "Codex ACP session";
  if (provider === "hermes") return "Hermes ACP session";
  if (provider === "claude") return "Claude Code ACP session";
  if (provider === "openclaw") return "OpenClaw ACP session";
  if (provider === "remote") return "Remote ACP WebSocket session";
  if (provider === "custom" && agent && agent.connectionType === "cli" && agent.supportsAcp !== false) {
    const name = agent && typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : null;
    return `${name ?? "Custom"} ACP session`;
  }
  return "本地 Agent harness session";
}

/**
 * @param {string} provider
 * @param {{ connectionType?: string, supportsAcp?: boolean } | null} agent
 * @param {Record<string, any>} injectedAdapters
 * @param {Record<string, any>} adapterFactories
 * @param {any} createGenericAcp
 * @param {any} createRemoteAcp
 * @returns {any}
 */
export function resolveAdapterFactoryForProvider(
  provider,
  agent,
  injectedAdapters,
  adapterFactories,
  createGenericAcp,
  createRemoteAcp,
) {
  if (Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) return adapterFactories[provider];
  if (provider === "remote") return createRemoteAcp;
  if (
    provider === "hermes" ||
    provider === "opencode" ||
    provider === "openclaw" ||
    provider === "codex" ||
    provider === "claude"
  ) {
    return createGenericAcp;
  }
  if (provider === "custom" && agent && agent.connectionType === "cli" && agent.supportsAcp !== false) {
    return createGenericAcp;
  }
  return adapterFactories[provider];
}

/**
 * @param {object} state
 * @param {{ visibleArtifacts: (entries: unknown) => unknown }} deps
 */
export function buildRunMeta(state, deps) {
  return {
    type: "run_meta",
    at: Date.now(),
    runId: state.runId,
    agentId: state.agentId,
    agentProvider: state.agentProvider,
    status: state.status,
    connectionMode: state.connectionMode,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    pid: state.pid,
    command: state.command,
    providerSessionId: state.providerSessionId,
    resumeKey: state.resumeKey,
    metadata: state.metadata,
    workdir: state.workdir,
    conversationId: state.conversationId ?? null,
    debugSummary: state.debugSummary,
    errorInfo: state.errorInfo,
    approvalMode: state.approvalMode,
    pendingApprovals: state.pendingApprovals,
    artifacts: deps.visibleArtifacts(state.artifacts),
    fileChanges: [...(state.fileChanges ?? [])],
  };
}

function assistantChunkText(event) {
  const type = String(event?.type ?? "");
  const text = String(event?.text ?? "").trim();
  if (!text) return "";
  if (type === "assistant_chunk" || type === "chunk") return text;
  if (type === "log" && /^assistant_chunk>\s*/.test(text)) {
    return text.replace(/^assistant_chunk>\s*/, "").trim();
  }
  return "";
}

function compactRunningMessageEvents(allEvents, eventLimit) {
  const tailStart = Math.max(0, allEvents.length - eventLimit);
  const tail = allEvents.slice(tailStart);
  const messageEvents = [];
  const firstUserEvent = allEvents.find((event) => String(event?.type ?? "") === "user");
  if (firstUserEvent && !tail.includes(firstUserEvent)) messageEvents.push(firstUserEvent);

  let assistantPrefix = "";
  /** @type {number | null} */
  let assistantPrefixAt = null;
  for (let index = 0; index < tailStart; index += 1) {
    const event = allEvents[index];
    const chunk = assistantChunkText(event);
    if (!chunk) continue;
    assistantPrefix += chunk;
    assistantPrefixAt = Number(event?.at) || assistantPrefixAt;
  }
  if (assistantPrefix) {
    messageEvents.push({
      type: "assistant_chunk",
      text: assistantPrefix,
      at: assistantPrefixAt ?? 1,
      compacted: true,
    });
  }
  messageEvents.push(...tail);
  return messageEvents;
}

/**
 * @param {object} state
 * @param {{
 *   visibleArtifacts: (entries: unknown) => unknown,
 *   runEventsToConversationMessages: (events: unknown[]) => unknown,
 * }} deps
 */
export function buildRunSnapshot(state, deps, options = {}) {
  const eventLimit = Number(options.eventLimit);
  const conversationMessageEventLimit = Number(options.conversationMessageEventLimit);
  const allEvents = Array.isArray(state.events) ? state.events : [];
  const events = Number.isSafeInteger(eventLimit) && eventLimit > 0 && allEvents.length > eventLimit
    ? allEvents.slice(-eventLimit)
    : [...allEvents];
  const compactRunningMessages = state.status === "running"
    && Number.isSafeInteger(conversationMessageEventLimit)
    && conversationMessageEventLimit > 0
    && allEvents.length > conversationMessageEventLimit;
  const messageEvents = compactRunningMessages
    ? compactRunningMessageEvents(allEvents, conversationMessageEventLimit)
    : allEvents;
  return {
    ok: state.status === "completed",
    runId: state.runId,
    agentId: state.agentId,
    agentProvider: state.agentProvider,
    connectionMode: state.connectionMode,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    pid: state.pid,
    command: state.command,
    output: state.outputParts.join("\n").trim(),
    error: state.error,
    events,
    // Running polling keeps the user prompt, cumulative assistant text, and a
    // recent structured-event tail. Terminal/direct snapshots still receive
    // the complete durable transcript exactly once.
    conversationMessages: deps.runEventsToConversationMessages(messageEvents),
    logPath: state.logPath,
    conversationId: state.conversationId ?? null,
    providerSessionId: state.providerSessionId,
    resumeKey: state.resumeKey,
    metadata: state.metadata,
    workdir: state.workdir,
    debugSummary: state.debugSummary,
    errorInfo: state.errorInfo,
    approvalMode: state.approvalMode,
    pendingApprovals: [...(state.pendingApprovals ?? [])],
    artifacts: deps.visibleArtifacts(state.artifacts),
    fileChanges: [...(state.fileChanges ?? [])],
  };
}

/**
 * @param {object} state
 * @param {object} request
 * @param {{ now?: () => number, randomId?: () => string }} [clock]
 */
export function buildApprovalRecord(state, request = {}, clock = {}) {
  const now = typeof clock.now === "function" ? clock.now() : Date.now();
  const randomId =
    typeof clock.randomId === "function"
      ? clock.randomId()
      : Math.random().toString(16).slice(2);
  const approvalId = String(
    request.id ?? `${state.runId}-approval-${now}-${randomId}`,
  ).trim();
  return {
    id: approvalId,
    runId: state.runId,
    provider: state.agentProvider,
    method: String(request.method ?? "unknown"),
    kind: request.kind ?? "unknown",
    title: String(request.title ?? "需要用户审批"),
    summary: String(request.summary ?? "本地 Agent 请求执行受限操作。"),
    command: request.command ? String(request.command) : null,
    cwd: request.cwd ? String(request.cwd) : state.workspaceRoot,
    readonly: Boolean(request.readonly),
    params: sanitizeApprovalParams(request.params),
    createdAt: now,
  };
}

/**
 * @param {string} raw
 * @returns {{ meta: object | null, events: object[] }}
 */
export function parseRunLogContent(raw) {
  let meta = null;
  const events = [];
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === "run_meta") meta = parsed;
      else events.push(parsed);
    } catch {
      // Ignore corrupt log lines; keep the rest of the run inspectable.
    }
  }
  return { meta, events };
}

/**
 * @param {object[]} events
 */
export function assistantTextFromEvents(events) {
  return (events ?? [])
    .filter((event) => event.type === "assistant")
    .map((event) => String(event.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Whether a restored log should be invisible to the UI (orphaned / still running).
 * @param {object | null} meta
 * @returns {"orphaned" | "stale_running" | null}
 */
export function classifyRestoredRunMeta(meta) {
  if (!meta) return null;
  if (meta.status === "failed" && meta.errorInfo?.code === "orphaned") return "orphaned";
  if (meta.status === "running") return "stale_running";
  return null;
}

/**
 * @param {object} meta
 * @param {object[]} events
 * @param {string} id
 * @param {string} logPath
 * @param {{
 *   visibleArtifacts: (entries: unknown) => unknown,
 *   runEventsToConversationMessages: (events: unknown[]) => unknown,
 * }} deps
 */
export function buildRestoredRunSnapshot(meta, events, id, logPath, deps) {
  const assistantText = assistantTextFromEvents(events);
  const status = meta.status;
  const errorInfo = meta.errorInfo ?? null;
  const error = errorInfo?.message ?? null;
  return {
    ok: status === "completed",
    runId: meta.runId ?? id,
    agentId: meta.agentId ?? "unknown",
    agentProvider: meta.agentProvider ?? "custom",
    connectionMode: meta.connectionMode ?? "本地 Agent harness session",
    status,
    startedAt: meta.startedAt ?? null,
    finishedAt: meta.finishedAt ?? null,
    pid: meta.pid ?? null,
    command: meta.command ?? "",
    output: assistantText,
    error,
    events,
    conversationMessages: deps.runEventsToConversationMessages(events),
    logPath,
    providerSessionId: meta.providerSessionId ?? null,
    resumeKey: meta.resumeKey ?? null,
    metadata: meta.metadata ?? null,
    workdir: meta.workdir ?? null,
    conversationId: meta.conversationId ?? null,
    debugSummary: meta.debugSummary ?? null,
    errorInfo,
    approvalMode: meta.approvalMode ?? "ask",
    pendingApprovals: Array.isArray(meta.pendingApprovals) ? meta.pendingApprovals : [],
    artifacts: deps.visibleArtifacts(meta.artifacts),
    fileChanges: Array.isArray(meta.fileChanges) ? [...meta.fileChanges] : [],
  };
}

/**
 * @param {object} meta
 * @param {{ now?: () => number }} [clock]
 */
export function buildFinalizedOrphanMeta(meta, clock = {}) {
  const now = typeof clock.now === "function" ? clock.now() : Date.now();
  return {
    ...meta,
    status: "failed",
    finishedAt: now,
    debugSummary:
      "orphaned run: persisted log still 'running' but no active runtime record after process restart (patched by reconcile)",
    errorInfo: {
      code: "orphaned",
      message:
        "该 run 因主进程重启/崩溃而中断：恢复时已无对应的活跃执行记录，属历史残留（孤儿 run），并未真正执行失败。",
      debug: "run existed only in persisted log; active runtime state was missing after process restart",
    },
  };
}

/**
 * Rewrite run_meta lines in a jsonl log and append an error event.
 * @param {string} content
 * @param {object} finalizedMeta
 * @param {{ now?: () => number }} [clock]
 * @returns {{ content: string, changed: boolean } | null}
 */
export function rewriteOrphanRunLogContent(content, finalizedMeta, clock = {}) {
  const now = typeof clock.now === "function" ? clock.now() : Date.now();
  const lines = String(content ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  let changed = false;
  const outLines = lines.map((line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === "run_meta") {
        changed = true;
        return JSON.stringify(finalizedMeta);
      }
    } catch {
      // Keep non-JSON / corrupt lines as-is.
    }
    return line;
  });
  if (!changed) return null;
  outLines.push(
    JSON.stringify({
      type: "error",
      text: finalizedMeta.errorInfo?.message ?? "orphaned run",
      at: now,
    }),
  );
  return { content: `${outLines.join("\n")}\n`, changed: true };
}

/**
 * Filter out harness/ACP startup noise for stall detection.
 * @param {object[]} events
 */
export function meaningfulRunEvents(events) {
  return (events ?? []).filter((event) => {
    const text = String(event.text ?? "");
    return !(event.type === "status" && /(?:harness|ACP) flow started/.test(text));
  });
}

/**
 * @param {object} state
 * @param {number} now
 * @param {number} [stallMs]
 */
export function isStartupStalled(state, now = Date.now(), stallMs = 30_000) {
  if (state.status !== "running") return false;
  const meaningful = meaningfulRunEvents(state.events);
  return meaningful.length === 0 && now - state.startedAt > stallMs;
}

export function buildStartupStalledErrorInfo() {
  return {
    code: "timeout",
    message: "本地 Agent 启动阶段已中断：没有产生进程 PID 或可追踪输出。",
    debug: "runtime startup stalled before adapter reported pid",
  };
}

/**
 * @param {object} state
 */
export function buildStartupStalledDebugSummary(state) {
  return [
    `provider=${state.agentProvider}`,
    `connection=${state.connectionMode}`,
    `runId=${state.runId}`,
    "startupStalled=true",
  ].join("\n");
}

/**
 * Map probeAcpCommand 4-state result to the 3-state connection test contract.
 * @param {string} step
 * @returns {"success" | "fail_cli" | "fail_acp"}
 */
export function mapProbeStepToTestStep(step) {
  if (step === "online") return "success";
  if (step === "needs_auth") return "fail_acp";
  if (step === "fail_cli" || step === "fail_acp") return step;
  return "fail_acp";
}

/**
 * @param {string} message
 * @returns {"fail_cli" | "fail_acp"}
 */
export function classifySpawnErrorStep(message) {
  return /ENOENT|spawn|command not found|not found/i.test(String(message ?? ""))
    ? "fail_cli"
    : "fail_acp";
}

/**
 * Merge config-file MCP servers with live tool-call observations.
 * Config wins on transport; live wins on toolCount + connected.
 * @param {Array<{ name?: string, transport?: string, type?: string, source?: string, sourceFile?: string }>} nativeServers
 * @param {Array<{ name?: string, transport?: string, toolCount?: number }>} liveServers
 */
export function mergeMcpServers(nativeServers = [], liveServers = []) {
  const mergedByName = new Map();
  for (const s of nativeServers) {
    const key = String(s.name || "").toLowerCase();
    if (!key) continue;
    mergedByName.set(key, {
      name: s.name,
      transport: s.transport || s.type || null,
      connected: false,
      toolCount: 0,
      source: s.source,
      sourceFile: s.sourceFile,
    });
  }
  for (const s of liveServers) {
    const key = String(s.name || "").toLowerCase();
    if (!key) continue;
    const prev = mergedByName.get(key) || {
      name: s.name,
      transport: null,
      connected: true,
      toolCount: 0,
    };
    mergedByName.set(key, {
      ...prev,
      transport: prev.transport || s.transport || null,
      connected: true,
      toolCount: (prev.toolCount || 0) + (s.toolCount || 0),
    });
  }
  return [...mergedByName.values()];
}

/**
 * Collect additional skill roots from agent metadata + caller input.
 * @param {string[] | undefined} nativeSkillsDirs
 * @param {unknown} additionalSkillRoots
 */
export function collectSkillRootOverrides(nativeSkillsDirs, additionalSkillRoots) {
  const overrides = [];
  if (Array.isArray(nativeSkillsDirs)) overrides.push(...nativeSkillsDirs);
  if (Array.isArray(additionalSkillRoots)) {
    for (const root of additionalSkillRoots) {
      if (typeof root === "string" && root.trim().length) overrides.push(root);
    }
  }
  return overrides;
}
