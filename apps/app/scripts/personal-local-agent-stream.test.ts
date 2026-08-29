import { describe, expect, test } from "bun:test";

import { createRuntimeEventPublisher } from "../../desktop/electron/personal-agent-runtime/runtime-events.mjs";
import {
  applyPersonalLocalAgentRuntimeDelta,
  createRunRefreshGate,
  deltaNeedsAuthoritativeSnapshot,
  shouldApplyRunSnapshot,
  shouldPollSilentRun,
} from "../src/react-app/domains/local-agents/host/personal-local-agent-stream-coordinator";
import type {
  PersonalLocalAgentRunResult,
  PersonalLocalAgentRuntimeEvent,
} from "@onmyagent/types/desktop-ipc";

function run(overrides: Partial<PersonalLocalAgentRunResult> = {}): PersonalLocalAgentRunResult {
  return {
    ok: false,
    runId: "run-1",
    agentId: "codex",
    agentProvider: "codex",
    status: "running",
    startedAt: 1,
    finishedAt: null,
    pid: null,
    command: "codex",
    output: "",
    error: null,
    events: [],
    eventRevision: 0,
    conversationMessages: [],
    logPath: null,
    pendingApprovals: [],
    ...overrides,
  };
}

function delta(revision: number, revisionStart: number, text: string): PersonalLocalAgentRuntimeEvent {
  return {
    type: "run.delta",
    runId: "run-1",
    workspaceRoot: "/workspace",
    conversationId: "chat-1",
    status: "running",
    updatedAt: revision,
    revision,
    revisionStart,
    events: [{ type: "assistant_chunk", text, at: revision, eventId: `run-1:${revision}` }],
  };
}

describe("personal Local Agent stream coordination", () => {
  test("coalesces in-flight nudges and preserves a terminal follow-up", () => {
    const gate = createRunRefreshGate();
    expect(gate.begin("run-1")).toBe(true);
    expect(gate.begin("run-1")).toBe(false);
    expect(gate.begin("run-1", { terminal: true })).toBe(false);
    expect(gate.settle("run-1")).toEqual({ retry: true, terminalPending: true });
    expect(gate.begin("run-1", { terminal: true })).toBe(true);
    expect(gate.settle("run-1")).toEqual({ retry: false, terminalPending: false });
  });

  test("applies contiguous text deltas without inventing whitespace", () => {
    let current = run();
    for (const [revision, text] of [[1, "Hello"], [2, " "], [3, "world"]] as const) {
      current = applyPersonalLocalAgentRuntimeDelta(current, delta(revision, revision, text))!;
    }
    expect(current.eventRevision).toBe(3);
    expect(current.events.map((event) => event.text)).toEqual(["Hello", " ", "world"]);
    expect(current.conversationMessages?.at(-1)?.text).toBe("Hello world");
  });

  test("rejects revision gaps and stale snapshots", () => {
    const current = applyPersonalLocalAgentRuntimeDelta(run(), delta(1, 1, "a"))!;
    expect(applyPersonalLocalAgentRuntimeDelta(current, delta(3, 3, "c"))).toBeNull();
    expect(shouldApplyRunSnapshot(current, run({ eventRevision: 0 }))).toBe(false);
    expect(shouldApplyRunSnapshot(current, run({ eventRevision: 1 }))).toBe(true);
    expect(shouldApplyRunSnapshot(current, run({ eventRevision: 0, status: "completed" }))).toBe(true);
  });

  test("requests snapshots for structured deltas but not plain text", () => {
    expect(deltaNeedsAuthoritativeSnapshot(delta(1, 1, "a"))).toBe(false);
    expect(deltaNeedsAuthoritativeSnapshot({
      ...delta(1, 1, ""),
      events: [{ type: "tool", text: "read", at: 1 }],
    })).toBe(true);
    expect(deltaNeedsAuthoritativeSnapshot({ ...delta(1, 1, ""), snapshotRequired: true })).toBe(true);
    for (const telemetry of [
      'acp_available_commands> [{"name":"/help"}]',
      'acp_context_usage> {"used":10,"total":100}',
      'acp_usage_update> {"used":11}',
    ]) {
      expect(deltaNeedsAuthoritativeSnapshot({
        ...delta(1, 1, ""),
        events: [{ type: "status", text: telemetry, at: 1 }],
      })).toBe(true);
    }
    expect(deltaNeedsAuthoritativeSnapshot({
      ...delta(1, 1, ""),
      events: [{ type: "status", text: "generic status", at: 1 }],
    })).toBe(false);
  });

  test("watchdog only polls a visible run after real silence", () => {
    expect(shouldPollSilentRun({ hidden: false, now: 2_000, lastPresentationAt: 1_900 })).toBe(false);
    expect(shouldPollSilentRun({ hidden: false, now: 4_000, lastPresentationAt: 1_000 })).toBe(true);
    expect(shouldPollSilentRun({ hidden: true, now: 4_000, lastPresentationAt: 1_000 })).toBe(false);
    expect(shouldPollSilentRun({ hidden: false, now: 4_000, lastPresentationAt: null })).toBe(false);
  });

  test("100 fake chunks stream monotonically and finish in the terminal push", () => {
    const emitted: PersonalLocalAgentRuntimeEvent[] = [];
    const timers: Array<{ callback: () => void }> = [];
    const publisher = createRuntimeEventPublisher({
      onEvent: (event: PersonalLocalAgentRuntimeEvent) => emitted.push(event),
      setTimer: (callback: () => void) => {
        const timer = { callback };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer: { callback: () => void }) => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      },
    });
    const state = { runId: "run-1", workspaceRoot: "/workspace", conversationId: "chat-1", status: "running" };
    const stored: Array<Record<string, unknown>> = [];
    publisher.register(stored, state);
    for (let index = 1; index <= 100; index += 1) {
      publisher.append((target: Array<Record<string, unknown>>, event: Record<string, unknown>) => {
        target.push({ ...event });
        return event;
      }, stored, { type: "assistant_chunk", text: String(index % 10), at: index });
      if (index % 4 === 0) timers.shift()?.callback();
    }
    let current = run();
    for (const event of emitted) current = applyPersonalLocalAgentRuntimeDelta(current, event)!;
    expect(current.events).toHaveLength(100);
    expect(current.conversationMessages?.at(-1)?.text).toHaveLength(100);
    publisher.append((target: Array<Record<string, unknown>>, event: Record<string, unknown>) => {
      target.push({ ...event });
      return event;
    }, stored, { type: "finish", text: "done", at: 101 });
    state.status = "completed";
    publisher.publish(state, "run.finished");
    const terminal = emitted.at(-1)!;
    current = applyPersonalLocalAgentRuntimeDelta(current, terminal)!;
    expect(terminal.type).toBe("run.finished");
    expect(current.status).toBe("completed");
    expect(current.output).toBe("done");
  });
});
