import test from "node:test";
import assert from "node:assert/strict";

import { runEventsToConversationMessages } from "./contract.mjs";

import {
  assistantTextFromEvents,
  buildApprovalRecord,
  buildFinalizedOrphanMeta,
  buildRestoredRunSnapshot,
  buildRunMeta,
  buildRunSnapshot,
  buildStartupStalledDebugSummary,
  buildStartupStalledErrorInfo,
  classifyRestoredRunMeta,
  classifySpawnErrorStep,
  collectSkillRootOverrides,
  defaultConnectionMode,
  isStartupStalled,
  mapProbeStepToTestStep,
  meaningfulRunEvents,
  mergeMcpServers,
  normalizeApprovalMode,
  normalizeApprovalExpiry,
  approvalRequestExpired,
  parseRunLogContent,
  parseStatusInput,
  providerDiagnosticsFromResult,
  providerUsageFromResult,
  resolveAdapterFactoryForProvider,
  rewriteOrphanRunLogContent,
  sanitizeApprovalParams,
} from "./run-helpers.mjs";

test("provider diagnostics project bounded session/model/transport facts", () => {
  assert.deepEqual(providerDiagnosticsFromResult({
    providerSessionId: "session-1",
    metadata: {
      currentModelId: "canonical-model",
      transport: "stdio",
      connectionMode: "Codex ACP session",
      apiKey: "sk-live-secret",
      executablePath: "/private/provider/bin/codex",
    },
  }), {
    providerSessionId: "session-1",
    effectiveModel: "canonical-model",
    transport: "stdio",
    connectionMode: "Codex ACP session",
    requestId: null,
    transportFallbackCount: 0,
  });
  assert.deepEqual(providerDiagnosticsFromResult({
    metadata: {
      sessionMetadata: { sessionId: "../secret", modelId: "gpt-5" },
      transport: "https://provider.invalid",
      token: "bearer secret",
    },
  }), {
    providerSessionId: null,
    effectiveModel: "gpt-5",
    transport: null,
    connectionMode: null,
    requestId: null,
    transportFallbackCount: 0,
  });
  assert.equal(providerDiagnosticsFromResult({ metadata: { apiKey: "sk-live-secret" } }), null);
});

test("provider diagnostics accept only explicit bounded request id and fallback count", () => {
  assert.deepEqual(providerDiagnosticsFromResult({
    metadata: {
      requestId: "req-123",
      transport_fallback_count: 2,
      secretRequestId: "bearer secret",
    },
  }), {
    providerSessionId: null,
    effectiveModel: null,
    transport: null,
    connectionMode: null,
    requestId: "req-123",
    transportFallbackCount: 2,
  });
  assert.equal(providerDiagnosticsFromResult({ metadata: { requestId: "../private", transportFallbackCount: -1 } }), null);
});

test("provider diagnostics count each fallback warning occurrence once across envelopes", () => {
  assert.equal(providerDiagnosticsFromResult({
    metadata: { warning: "Falling back from WebSockets to HTTPS transport." },
    promptResult: { text: "Falling back from WebSockets to HTTPS transport." },
  }).transportFallbackCount, 2);
});

test("provider usage projects numeric accounting without raw metadata", () => {
  const result = providerUsageFromResult({
    metadata: {
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        cost_usd: 0.000125,
        apiKey: "sk-live-secret",
      },
      endpoint: "https://provider.invalid/private",
    },
  });
  assert.deepEqual(result, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    costMicros: 125,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|provider\.invalid|apiKey/i);
});

test("normalizeApprovalMode accepts known modes and defaults to ask", () => {
  assert.equal(normalizeApprovalMode("auto"), "auto");
  assert.equal(normalizeApprovalMode("ask"), "ask");
  assert.equal(normalizeApprovalMode("read-only-auto"), "read-only-auto");
  assert.equal(normalizeApprovalMode("nope"), "ask");
  assert.equal(normalizeApprovalMode(null), "ask");
});

test("parseStatusInput accepts string or object forms", () => {
  assert.deepEqual(parseStatusInput("run-1"), { runId: "run-1", workspaceRoot: "" });
  assert.deepEqual(parseStatusInput({ id: "r2", workspaceRoot: "/ws" }), {
    runId: "r2",
    workspaceRoot: "/ws",
  });
  assert.deepEqual(parseStatusInput({ runId: "r3" }), {
    runId: "r3",
    workspaceRoot: "",
  });
});

test("sanitizeApprovalParams deep-clones objects and rejects non-objects", () => {
  assert.equal(sanitizeApprovalParams(null), null);
  assert.equal(sanitizeApprovalParams("x"), null);
  const params = { a: 1, nested: { b: 2 } };
  const next = sanitizeApprovalParams(params);
  assert.deepEqual(next, params);
  assert.notEqual(next, params);
});

test("defaultConnectionMode covers providers and custom ACP agents", () => {
  assert.equal(defaultConnectionMode("opencode"), "OpenCode ACP session");
  assert.equal(defaultConnectionMode("remote"), "Remote ACP WebSocket session");
  assert.equal(
    defaultConnectionMode("custom", { connectionType: "cli", name: "My CLI", supportsAcp: true }),
    "My CLI ACP session",
  );
  assert.equal(defaultConnectionMode("custom", { connectionType: "http" }), "本地 Agent harness session");
});

test("resolveAdapterFactoryForProvider prefers injected then generic ACP", () => {
  const factories = { codex: "codex-factory" };
  const injected = { fake: "injected" };
  assert.equal(
    resolveAdapterFactoryForProvider("fake", null, injected, { ...factories, fake: "injected" }, "generic", "remote"),
    "injected",
  );
  assert.equal(
    resolveAdapterFactoryForProvider("claude", null, {}, factories, "generic", "remote"),
    "generic",
  );
  assert.equal(
    resolveAdapterFactoryForProvider("remote", null, {}, factories, "generic", "remote"),
    "remote",
  );
  assert.equal(
    resolveAdapterFactoryForProvider("codex", null, {}, factories, "generic", "remote"),
    "generic",
  );
  assert.equal(
    resolveAdapterFactoryForProvider(
      "custom",
      { connectionType: "cli", supportsAcp: true },
      {},
      factories,
      "generic",
      "remote",
    ),
    "generic",
  );
});

test("buildRunSnapshot and buildRunMeta project state fields", () => {
  const state = {
    status: "completed",
    runId: "r1",
    agentId: "a1",
    agentProvider: "codex",
    connectionMode: "Codex ACP session",
    startedAt: 1,
    finishedAt: 2,
    pid: 9,
    processStartToken: "posix:test-start|pgid:9",
    terminationConfirmed: true,
    exitConfirmed: true,
    childExitConfirmed: true,
    childState: "exited",
    exitCode: 0,
    command: "codex",
    outputParts: ["hello", "world"],
    error: null,
    events: [{ type: "assistant", text: "hi" }],
    logPath: "/tmp/r1.jsonl",
    conversationId: "c1",
    providerSessionId: "ps",
    resumeKey: "rk",
    metadata: { x: 1 },
    workdir: "/ws",
    debugSummary: "dbg",
    errorInfo: null,
    approvalMode: "ask",
    pendingApprovals: [{ id: "p1" }],
    artifacts: [{ path: "a.txt" }],
    fileChanges: [{ path: "b.txt" }],
  };
  const deps = {
    visibleArtifacts: (entries) => entries,
    runEventsToConversationMessages: (events) => events.map((e) => ({ role: "assistant", text: e.text })),
  };
  const snap = buildRunSnapshot(state, deps);
  assert.equal(snap.ok, true);
  assert.equal(snap.terminationConfirmed, true);
  assert.equal(snap.processStartToken, "posix:test-start|pgid:9");
  assert.equal(snap.childState, "exited");
  assert.equal(snap.exitCode, 0);
  assert.equal(snap.output, "hello\nworld");
  assert.deepEqual(snap.pendingApprovals, [{ id: "p1" }]);
  assert.notEqual(snap.pendingApprovals, state.pendingApprovals);
  assert.deepEqual(snap.conversationMessages, [{ role: "assistant", text: "hi" }]);

  const compact = buildRunSnapshot({ ...state, status: "running", events: [
    { type: "user", text: "prompt" },
    { type: "assistant", text: "one" },
    { type: "assistant", text: "two" },
    { type: "assistant", text: "three" },
  ] }, deps, { eventLimit: 2, conversationMessageEventLimit: 2 });
  assert.deepEqual(compact.events.map((event) => event.text), ["two", "three"]);
  assert.deepEqual(compact.conversationMessages.map((message) => message.text), ["prompt", "two", "three"]);

  const terminal = buildRunSnapshot({ ...state, status: "completed", events: [
    { type: "assistant", text: "one" },
    { type: "assistant", text: "two" },
    { type: "assistant", text: "three" },
  ] }, deps, { eventLimit: 2, conversationMessageEventLimit: 2 });
  assert.deepEqual(terminal.conversationMessages.map((message) => message.text), ["one", "two", "three"]);

  const meta = buildRunMeta(state, { visibleArtifacts: (e) => e });
  assert.equal(meta.type, "run_meta");
  assert.equal(meta.runId, "r1");
  assert.equal(meta.terminationConfirmed, true);
  assert.equal(meta.processStartToken, "posix:test-start|pgid:9");
  assert.deepEqual(meta.fileChanges, [{ path: "b.txt" }]);
});

function runningBaseState() {
  return {
    status: "running",
    runId: "long-run",
    agentId: "codex",
    agentProvider: "codex",
    connectionMode: "Codex ACP session",
    startedAt: 1,
    finishedAt: null,
    pid: 9,
    command: "codex",
    outputParts: [],
    error: null,
    logPath: "/tmp/long-run.jsonl",
    conversationId: "conversation-1",
    providerSessionId: "provider-session-1",
    resumeKey: "provider-session-1",
    metadata: null,
    workdir: "/ws",
    debugSummary: null,
    errorInfo: null,
    approvalMode: "ask",
    pendingApprovals: [],
    artifacts: [],
    fileChanges: [],
  };
}

test("running snapshot compaction preserves cumulative assistant text outside the event tail", () => {
  const baseState = runningBaseState();
  const events = [
    { type: "user", text: "prompt", at: 1 },
    { type: "assistant_chunk", text: "prefix-", at: 2 },
    { type: "assistant_chunk", text: "already-visible", at: 3 },
    ...Array.from({ length: 201 }, (_, index) => ({
      type: "status",
      text: `noise-${index}`,
      at: 4 + index,
    })),
  ];
  const deps = {
    visibleArtifacts: (entries) => entries,
    runEventsToConversationMessages,
  };
  const compact = buildRunSnapshot(
    { ...baseState, events },
    deps,
    { eventLimit: 200, conversationMessageEventLimit: 200 },
  );
  assert.equal(compact.events.length, 200);
  assert.equal(compact.events[0].text, "noise-1");
  assert.equal(compact.conversationMessages.find((message) => message.role === "user")?.text, "prompt");
  const assistant = compact.conversationMessages.find((message) => message.role === "assistant");
  assert.equal(assistant?.id, "msg-2");
  assert.equal(assistant?.text, "prefix-already-visible");

  const next = buildRunSnapshot(
    { ...baseState, events: [...events, { type: "assistant_chunk", text: "-continued", at: 205 }] },
    deps,
    { eventLimit: 200, conversationMessageEventLimit: 200 },
  );
  const nextAssistant = next.conversationMessages.find((message) => message.role === "assistant");
  assert.equal(nextAssistant?.id, "msg-2");
  assert.equal(nextAssistant?.text, "prefix-already-visible-continued");

  const terminal = buildRunSnapshot(
    {
      ...baseState,
      status: "completed",
      events: [...events, { type: "finish", text: "prefix-already-visible", at: 205 }],
    },
    deps,
    { eventLimit: 200, conversationMessageEventLimit: 200 },
  );
  // Raw IPC events stay bounded, while the durable terminal transcript is not
  // rebuilt from the tail and therefore still contains the earliest status.
  assert.equal(terminal.events.length, 200);
  assert.equal(terminal.conversationMessages[0]?.text, "prompt");
  assert.equal(terminal.conversationMessages.some((message) => message.text === "noise-0"), true);
  assert.equal(terminal.conversationMessages.at(-1)?.type, "finish");
  assert.equal(terminal.conversationMessages.at(-1)?.text, "prefix-already-visible");
});

test("running snapshot compaction preserves spaces between streamed assistant chunks", () => {
  const state = runningBaseState();
  state.events = [
    { type: "user", text: "prompt", at: 1 },
    { type: "assistant_chunk", text: "Hello", at: 2 },
    { type: "assistant_chunk", text: " ", at: 3 },
    { type: "assistant_chunk", text: "world", at: 4 },
    ...Array.from({ length: 201 }, (_, index) => ({
      type: "status",
      text: `noise-${index}`,
      at: index + 5,
    })),
  ];
  const compact = buildRunSnapshot(
    state,
    { visibleArtifacts: (entries) => entries, runEventsToConversationMessages },
    { eventLimit: 200, conversationMessageEventLimit: 200 },
  );
  assert.equal(
    compact.conversationMessages.find((message) => message.role === "assistant")?.text,
    "Hello world",
  );
});

test("running snapshot compaction carries ACP tool start metadata into a completion-only tail", () => {
  const state = runningBaseState();
  state.status = "running";
  state.events = [
    { type: "user", text: "prompt", at: 1 },
    {
      type: "acp_tool_call",
      text: "PowerShell",
      msgId: "tool-message-long-run",
      at: 2,
      update: {
        tool_call_id: "tool-long-run",
        title: "PowerShell",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "Get-ChildItem" },
      },
    },
    ...Array.from({ length: 205 }, (_, index) => ({
      type: "status",
      text: `noise-${index}`,
      at: index + 3,
    })),
    {
      type: "acp_tool_call",
      text: "",
      at: 208,
      update: {
        tool_call_id: "tool-long-run",
        status: "completed",
        rawOutput: "done",
      },
    },
  ];

  const direct = buildRunSnapshot(
    state,
    { visibleArtifacts: (value) => value, runEventsToConversationMessages },
    { eventLimit: 500, conversationMessageEventLimit: 500 },
  );
  const directGroup = direct.conversationMessages.find((message) => message.type === "tool_group");
  assert.equal(directGroup.id, "tool-group-turn-1-message-tool-message-long-run");

  const compact = buildRunSnapshot(
    state,
    { visibleArtifacts: (value) => value, runEventsToConversationMessages },
    { eventLimit: 200, conversationMessageEventLimit: 200 },
  );
  const group = compact.conversationMessages.find((message) => message.type === "tool_group");
  assert.ok(group);
  assert.equal(group.id, directGroup.id);
  assert.equal(group.msgId, "tool-message-long-run");
  assert.equal(group.toolCalls.length, 1);
  assert.equal(group.toolCalls[0].update.title, "PowerShell");
  assert.equal(group.toolCalls[0].update.rawInput.command, "Get-ChildItem");
  assert.equal(group.toolCalls[0].update.rawOutput, "done");
  assert.equal(group.toolCalls[0].status, "completed");
});

test("running snapshot compaction keeps an active ACP tool after it leaves the raw tail", () => {
  const state = runningBaseState();
  state.events = [
    { type: "user", text: "prompt", at: 1 },
    {
      type: "acp_tool_call",
      text: "PowerShell",
      msgId: "active-tool-message",
      at: 2,
      update: {
        tool_call_id: "active-tool",
        title: "PowerShell",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "Get-ChildItem" },
      },
    },
    ...Array.from({ length: 205 }, (_, index) => ({
      type: "status",
      text: `noise-${index}`,
      at: index + 3,
    })),
  ];
  const compact = buildRunSnapshot(
    state,
    { visibleArtifacts: (entries) => entries, runEventsToConversationMessages },
    { eventLimit: 200, conversationMessageEventLimit: 200 },
  );
  const toolGroup = compact.conversationMessages.find((message) => message.type === "tool_group");
  assert.equal(toolGroup?.id, "tool-group-turn-1-message-active-tool-message");
  assert.equal(toolGroup?.toolCalls?.[0]?.update?.status, "in_progress");
  assert.equal(toolGroup?.toolCalls?.[0]?.update?.rawInput?.command, "Get-ChildItem");
});

test("running snapshot compaction bounds active ACP tools outside the raw tail", () => {
  const state = runningBaseState();
  state.events = [
    { type: "user", text: "prompt", at: 1 },
    ...Array.from({ length: 5_000 }, (_, index) => ({
      type: "acp_tool_call",
      text: `Tool ${index}`,
      at: index + 2,
      update: {
        tool_call_id: `active-tool-${index}`,
        title: `Tool ${index}`,
        status: "in_progress",
      },
    })),
    ...Array.from({ length: 201 }, (_, index) => ({
      type: "status",
      text: `noise-${index}`,
      at: index + 5_002,
    })),
  ];
  const compact = buildRunSnapshot(
    state,
    { visibleArtifacts: (entries) => entries, runEventsToConversationMessages },
    { eventLimit: 200, conversationMessageEventLimit: 200 },
  );
  const toolGroups = compact.conversationMessages.filter((message) => message.type === "tool_group");
  assert.equal(toolGroups.length, 50);
  assert.equal(compact.events.length, 200);
  assert.equal(JSON.stringify(compact).length < 100_000, true);
});

test("conversation tool identifiers do not merge across user turns", () => {
  const messages = runEventsToConversationMessages([
    { type: "user", text: "first", at: 1 },
    {
      type: "acp_tool_call",
      text: "First tool",
      at: 2,
      update: { tool_call_id: "tool-1", title: "First tool", status: "completed", rawOutput: "one" },
    },
    { type: "finish", text: "first answer", at: 3 },
    { type: "user", text: "second", at: 4 },
    {
      type: "acp_tool_call",
      text: "Second tool",
      at: 5,
      update: { tool_call_id: "tool-1", title: "Second tool", status: "completed", rawOutput: "two" },
    },
    { type: "finish", text: "second answer", at: 6 },
  ]);
  const toolGroups = messages.filter((message) => message.type === "tool_group");
  assert.equal(toolGroups.length, 2);
  assert.equal(toolGroups[0].toolCalls[0].update.title, "First tool");
  assert.equal(toolGroups[1].toolCalls[0].update.title, "Second tool");
  assert.notEqual(toolGroups[0].id, toolGroups[1].id);
  assert.notEqual(toolGroups[0].toolCalls[0].id, toolGroups[1].toolCalls[0].id);
  assert.equal(toolGroups[0].id, "tool-group-turn-1-call-tool-1");
  assert.equal(toolGroups[1].id, "tool-group-turn-4-call-tool-1");
  assert.equal(toolGroups[0].toolCalls[0].id, "acp-tool-turn-1-call-tool-1");
  assert.equal(toolGroups[1].toolCalls[0].id, "acp-tool-turn-4-call-tool-1");
});

test("buildApprovalRecord uses defaults and clock hooks", () => {
  const approval = buildApprovalRecord(
    { runId: "r1", agentProvider: "codex", workspaceRoot: "/ws" },
    { method: "fs.write", kind: "write", title: "Write file", summary: "Write", command: "echo", cwd: "/tmp", readonly: false, params: { path: "a" }, toolCallId: "tool-write-1" },
    { now: () => 42, randomId: () => "abc" },
  );
  assert.equal(approval.id, "r1-approval-42-abc");
  assert.equal(approval.provider, "codex");
  assert.equal(approval.cwd, "/tmp");
  assert.deepEqual(approval.params, { path: "a" });
  assert.equal(approval.createdAt, 42);
  assert.equal(approval.toolCallId, "tool-write-1");
  assert.equal(approval.expiresAt, null);
  assert.equal(buildApprovalRecord(
    { runId: "r1", agentProvider: "codex", workspaceRoot: "/ws" },
    { expiresAt: 99 },
    { now: () => 42, randomId: () => "abc" },
  ).expiresAt, 99);
  assert.equal(normalizeApprovalExpiry({ expiresAt: null }), null);
  assert.equal(normalizeApprovalExpiry({ expiresAt: null, params: { expires_at: 123 } }), 123);
  assert.equal(normalizeApprovalExpiry({ params: { input: { expiresAt: 456 } } }), 456);
  assert.equal(normalizeApprovalExpiry({ expiresAt: 99, params: { input: { expires_at: 7 } } }), 7);
  assert.equal(buildApprovalRecord(
    { runId: "r1", agentProvider: "codex", workspaceRoot: "/ws" },
    { expiresAt: null, params: { input: { expires_at: 777 } } },
  ).expiresAt, 777);
});

test("approval fast-path expiry helper honors earliest nested TTL and AbortSignal", () => {
  assert.equal(approvalRequestExpired({ expiresAt: 99, params: { input: { expires_at: 7 } } }, { now: () => 7 }), true);
  assert.equal(approvalRequestExpired({ expiresAt: 99, params: { input: { expires_at: 7 } } }, { now: () => 6 }), false);
  const controller = new AbortController();
  controller.abort();
  assert.equal(approvalRequestExpired({ expiresAt: 99 }, { signal: controller.signal, now: () => 0 }), true);
});

test("parseRunLogContent and assistantTextFromEvents restore runs", () => {
  const raw = [
    JSON.stringify({ type: "run_meta", runId: "r1", status: "completed", agentId: "a" }),
    "not-json",
    JSON.stringify({ type: "assistant", text: "line1" }),
    JSON.stringify({ type: "assistant", text: "line2" }),
    "",
  ].join("\n");
  const { meta, events } = parseRunLogContent(raw);
  assert.equal(meta.runId, "r1");
  assert.equal(events.length, 2);
  assert.equal(assistantTextFromEvents(events), "line1\nline2");
});

test("classifyRestoredRunMeta hides orphaned and stale running logs", () => {
  assert.equal(classifyRestoredRunMeta(null), null);
  assert.equal(
    classifyRestoredRunMeta({ status: "failed", errorInfo: { code: "orphaned" } }),
    "orphaned",
  );
  assert.equal(classifyRestoredRunMeta({ status: "running" }), "stale_running");
  assert.equal(classifyRestoredRunMeta({ status: "completed" }), null);
});

test("buildRestoredRunSnapshot maps meta + events", () => {
  const snap = buildRestoredRunSnapshot(
    {
      runId: "r1",
      agentId: "a1",
      agentProvider: "claude",
      status: "completed",
      artifacts: [],
      fileChanges: [{ path: "x" }],
    },
    [{ type: "assistant", text: "done" }],
    "fallback-id",
    "/tmp/r1.jsonl",
    {
      visibleArtifacts: () => [],
      runEventsToConversationMessages: () => [{ role: "assistant", text: "done" }],
    },
  );
  assert.equal(snap.ok, true);
  assert.equal(snap.output, "done");
  assert.equal(snap.logPath, "/tmp/r1.jsonl");
  assert.deepEqual(snap.fileChanges, [{ path: "x" }]);
});

test("rewriteOrphanRunLogContent finalizes run_meta and appends error", () => {
  const meta = { type: "run_meta", runId: "r1", status: "running" };
  const finalized = buildFinalizedOrphanMeta(meta, { now: () => 99 });
  assert.equal(finalized.status, "failed");
  assert.equal(finalized.errorInfo.code, "orphaned");
  assert.equal(finalized.finishedAt, 99);

  const content = [
    JSON.stringify(meta),
    JSON.stringify({ type: "status", text: "hi" }),
  ].join("\n");
  const rewritten = rewriteOrphanRunLogContent(content, finalized, { now: () => 100 });
  assert.ok(rewritten);
  assert.match(rewritten.content, /"status":"failed"/);
  assert.match(rewritten.content, /"type":"error"/);
  assert.equal(rewriteOrphanRunLogContent("{}", finalized), null);
});

test("startup stall helpers", () => {
  const running = {
    status: "running",
    startedAt: 0,
    events: [{ type: "status", text: "ACP flow started" }],
    agentProvider: "codex",
    connectionMode: "x",
    runId: "r1",
  };
  assert.deepEqual(meaningfulRunEvents(running.events), []);
  assert.equal(isStartupStalled(running, 31_000), true);
  assert.equal(isStartupStalled(running, 10_000), false);
  assert.equal(buildStartupStalledErrorInfo().code, "timeout");
  assert.match(buildStartupStalledDebugSummary(running), /startupStalled=true/);
});

test("probe/spawn step mappers", () => {
  assert.equal(mapProbeStepToTestStep("online"), "success");
  assert.equal(mapProbeStepToTestStep("needs_auth"), "fail_acp");
  assert.equal(mapProbeStepToTestStep("fail_cli"), "fail_cli");
  assert.equal(classifySpawnErrorStep("spawn ENOENT"), "fail_cli");
  assert.equal(classifySpawnErrorStep("rpc timeout"), "fail_acp");
});

test("mergeMcpServers merges native config with live observations", () => {
  const merged = mergeMcpServers(
    [{ name: "filesystem", transport: "stdio", source: "config", sourceFile: "mcp.json" }],
    [{ name: "filesystem", toolCount: 3 }, { name: "browser", toolCount: 1 }],
  );
  assert.equal(merged.length, 2);
  const fs = merged.find((s) => s.name === "filesystem");
  assert.equal(fs.connected, true);
  assert.equal(fs.toolCount, 3);
  assert.equal(fs.transport, "stdio");
  const browser = merged.find((s) => s.name === "browser");
  assert.equal(browser.connected, true);
  assert.equal(browser.toolCount, 1);
});

test("collectSkillRootOverrides merges metadata dirs and additional roots", () => {
  assert.deepEqual(
    collectSkillRootOverrides(["/a"], ["/b", "  ", 3, "/c"]),
    ["/a", "/b", "/c"],
  );
  assert.deepEqual(collectSkillRootOverrides(undefined, null), []);
});
