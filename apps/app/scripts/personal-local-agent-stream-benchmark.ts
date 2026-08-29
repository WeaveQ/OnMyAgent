import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";

import { createRuntimeEventPublisher } from "../../desktop/electron/personal-agent-runtime/runtime-events.mjs";
import {
  applyPersonalLocalAgentRuntimeDelta,
  createRunRefreshGate,
} from "../src/react-app/domains/local-agents/host/personal-local-agent-stream-coordinator";
import type {
  PersonalLocalAgentRunResult,
  PersonalLocalAgentRuntimeEvent,
} from "../src/app/lib/desktop";

type RuntimeEvent = {
  type: string;
  events?: unknown[];
  revision?: number;
};

const CONTINUOUS_GAP_P95_BUDGET_MS = 150;
const CONTINUOUS_GAP_MAX_BUDGET_MS = 250;
const FIRST_VISIBLE_BUDGET_MS = 120;
const TERMINAL_SETTLE_BUDGET_MS = 250;

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

async function runtimePublisherCadence() {
  const emitted: Array<{ at: number; event: RuntimeEvent }> = [];
  const visibleAt: number[] = [];
  const deliveryToVisibleMs: number[] = [];
  const startedAt = performance.now();
  let run: PersonalLocalAgentRunResult = {
    ok: false,
    runId: "benchmark-run",
    agentId: "codex",
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    pid: null,
    command: "benchmark",
    output: "",
    error: null,
    events: [],
    eventRevision: 0,
    conversationMessages: [],
    logPath: null,
    pendingApprovals: [],
  };
  const publisher = createRuntimeEventPublisher({
    onEvent: (event: PersonalLocalAgentRuntimeEvent) => {
      const deliveredAt = performance.now();
      emitted.push({ at: deliveredAt, event });
      const merged = event.events?.length
        ? applyPersonalLocalAgentRuntimeDelta(run, event)
        : null;
      if (merged) run = merged;
      else if (event.type === "run.finished") {
        run = {
          ...run,
          ok: event.status === "completed",
          status: event.status === "failed" || event.status === "cancelled" ? event.status : "completed",
          finishedAt: event.updatedAt,
        };
      } else {
        return;
      }
      const presentedAt = performance.now();
      visibleAt.push(presentedAt);
      deliveryToVisibleMs.push(presentedAt - deliveredAt);
    },
  });
  const state = {
    runId: "benchmark-run",
    workspaceRoot: "/benchmark",
    conversationId: "benchmark-conversation",
    status: "running",
    updatedAt: Date.now(),
  };
  const stored: unknown[] = [];
  publisher.register(stored, state);
  for (let index = 0; index < 100; index += 1) {
    publisher.append(
      (events: unknown[], event: unknown) => {
        events.push(event);
        return event;
      },
      stored,
      { type: "assistant_chunk", text: `chunk-${index}`, at: Date.now() },
    );
    await Bun.sleep(10);
  }
  await Bun.sleep(100);
  const gaps = emitted.slice(1).map((entry, index) => entry.at - (emitted[index]?.at ?? entry.at));
  const visibleGaps = visibleAt.slice(1).map((at, index) => at - (visibleAt[index] ?? at));
  const beforeTerminal = performance.now();
  state.status = "completed";
  state.updatedAt = Date.now();
  publisher.publish(state, "run.finished");
  const terminal = emitted.findLast((entry) => entry.event.type === "run.finished");
  return {
    sourceEvents: stored.length,
    deliveredDeltas: emitted.filter((entry) => entry.event.type === "run.delta").length,
    firstDeliveredMs: rounded((emitted[0]?.at ?? startedAt) - startedAt),
    gapP50Ms: rounded(percentile(gaps, 0.5)),
    gapP95Ms: rounded(percentile(gaps, 0.95)),
    gapMaxMs: rounded(Math.max(0, ...gaps)),
    terminalEmitMs: rounded((terminal?.at ?? beforeTerminal) - beforeTerminal),
    carriesDeltaEvents: emitted.some((entry) => (entry.event.events?.length ?? 0) > 0),
    carriesRevision: emitted.some((entry) => Number.isInteger(entry.event.revision)),
    renderer: {
      firstVisibleFromSourceMs: rounded((visibleAt[0] ?? startedAt) - startedAt),
      deliveredToVisibleP95Ms: rounded(percentile(deliveryToVisibleMs, 0.95)),
      deliveredToVisibleMaxMs: rounded(Math.max(0, ...deliveryToVisibleMs)),
      visibleGapP50Ms: rounded(percentile(visibleGaps, 0.5)),
      visibleGapP95Ms: rounded(percentile(visibleGaps, 0.95)),
      visibleGapMaxMs: rounded(Math.max(0, ...visibleGaps)),
      terminalVisibleMs: rounded((visibleAt.at(-1) ?? beforeTerminal) - beforeTerminal),
      terminalStatus: run.status,
      eventRevision: run.eventRevision ?? 0,
    },
  };
}

function legacyRendererModel(statusLatencyMs = 90) {
  const deltaTimes = Array.from({ length: 13 }, (_, index) => 75 * (index + 1));
  // Land the terminal notification inside the request that started at 900 ms;
  // the current renderer Set gate drops it and relies on the 10 s watchdog.
  const terminalAt = 950;
  const requestStarts = [0, ...deltaTimes];
  let inFlightUntil = -1;
  const visibleAt: number[] = [];
  let terminalDropped = false;
  for (const at of requestStarts) {
    if (at < inFlightUntil) continue;
    inFlightUntil = at + statusLatencyMs;
    visibleAt.push(inFlightUntil);
  }
  if (terminalAt < inFlightUntil) terminalDropped = true;
  const terminalVisibleAt = terminalDropped
    ? terminalAt + 10_000 + statusLatencyMs
    : terminalAt + statusLatencyMs;
  const gaps = visibleAt.slice(1).map((at, index) => at - (visibleAt[index] ?? at));
  return {
    statusLatencyMs,
    visibleGapP50Ms: percentile(gaps, 0.5),
    visibleGapP95Ms: percentile(gaps, 0.95),
    visibleGapMaxMs: Math.max(0, ...gaps),
    terminalDropped,
    terminalSettleMs: terminalVisibleAt - terminalAt,
    maxConcurrentStatusRequests: 1,
  };
}

async function optimizedTerminalSingleFlight(statusLatencyMs = 90) {
  const gate = createRunRefreshGate();
  const startedAt = performance.now();
  let concurrent = 0;
  let maxConcurrent = 0;
  let requestCount = 0;
  let terminalAt = 0;
  let terminalSettledAt = 0;
  let terminalObserved = false;

  const poll = (terminal = false) => {
    if (!gate.begin("benchmark-run", { terminal })) return;
    requestCount += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    const requestSawTerminal = terminalObserved;
    void Bun.sleep(statusLatencyMs).then(() => {
      concurrent -= 1;
      if (requestSawTerminal) terminalSettledAt = performance.now();
      const settled = gate.settle("benchmark-run");
      if (settled.retry) queueMicrotask(() => poll(settled.terminalPending));
    });
  };

  poll();
  await Bun.sleep(20);
  terminalObserved = true;
  terminalAt = performance.now();
  poll(true);
  const deadline = performance.now() + statusLatencyMs * 4;
  while ((!terminalSettledAt || concurrent > 0) && performance.now() < deadline) {
    await Bun.sleep(5);
  }
  return {
    statusLatencyMs,
    terminalVisibleMs: 0,
    terminalAuthoritativeSettleMs: rounded((terminalSettledAt || performance.now()) - terminalAt),
    totalElapsedMs: rounded(performance.now() - startedAt),
    requestCount,
    maxConcurrentStatusRequests: maxConcurrent,
    dirtyFollowups: Math.max(0, requestCount - 1),
  };
}

async function readBaseline(path: string | undefined) {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as {
      runtimePublisher?: { firstDeliveredMs?: number; gapP95Ms?: number };
    };
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const baselinePath = args[args.indexOf("--baseline") + 1];
const outputPath = args[args.indexOf("--output") + 1];
const baseline = await readBaseline(args.includes("--baseline") ? baselinePath : undefined);
const runtimePublisher = await runtimePublisherCadence();
const optimizedRenderer = await optimizedTerminalSingleFlight();
const baselineFirstMs = baseline?.runtimePublisher?.firstDeliveredMs;
const baselineP95Ms = baseline?.runtimePublisher?.gapP95Ms;
const firstRegressionLimitMs = typeof baselineFirstMs === "number"
  ? Math.max(baselineFirstMs * 1.1, baselineFirstMs + 16)
  : FIRST_VISIBLE_BUDGET_MS;
const p95RegressionLimitMs = typeof baselineP95Ms === "number"
  ? Math.max(CONTINUOUS_GAP_P95_BUDGET_MS, baselineP95Ms * 1.1)
  : CONTINUOUS_GAP_P95_BUDGET_MS;
const violations = [
  runtimePublisher.renderer.deliveredToVisibleMaxMs > FIRST_VISIBLE_BUDGET_MS
    ? `delivered-to-visible ${runtimePublisher.renderer.deliveredToVisibleMaxMs}ms > ${FIRST_VISIBLE_BUDGET_MS}ms`
    : null,
  runtimePublisher.renderer.firstVisibleFromSourceMs > firstRegressionLimitMs
    ? `first visible ${runtimePublisher.renderer.firstVisibleFromSourceMs}ms > regression limit ${rounded(firstRegressionLimitMs)}ms`
    : null,
  runtimePublisher.renderer.visibleGapP95Ms > p95RegressionLimitMs
    ? `visible gap p95 ${runtimePublisher.renderer.visibleGapP95Ms}ms > ${rounded(p95RegressionLimitMs)}ms`
    : null,
  runtimePublisher.renderer.visibleGapMaxMs > CONTINUOUS_GAP_MAX_BUDGET_MS
    ? `visible gap max ${runtimePublisher.renderer.visibleGapMaxMs}ms > ${CONTINUOUS_GAP_MAX_BUDGET_MS}ms`
    : null,
  optimizedRenderer.terminalAuthoritativeSettleMs > TERMINAL_SETTLE_BUDGET_MS
    ? `terminal settle ${optimizedRenderer.terminalAuthoritativeSettleMs}ms > ${TERMINAL_SETTLE_BUDGET_MS}ms`
    : null,
  optimizedRenderer.maxConcurrentStatusRequests > 1
    ? `status concurrency ${optimizedRenderer.maxConcurrentStatusRequests} > 1`
    : null,
  optimizedRenderer.dirtyFollowups !== 1
    ? `dirty followups ${optimizedRenderer.dirtyFollowups} !== 1`
    : null,
].filter((value): value is string => Boolean(value));

const result = {
  recordedAt: new Date().toISOString(),
  baselinePath: args.includes("--baseline") ? baselinePath : null,
  budgets: {
    continuousGapP95Ms: CONTINUOUS_GAP_P95_BUDGET_MS,
    continuousGapMaxMs: CONTINUOUS_GAP_MAX_BUDGET_MS,
    firstVisibleMs: FIRST_VISIBLE_BUDGET_MS,
    terminalSettleMs: TERMINAL_SETTLE_BUDGET_MS,
    firstRegressionLimitMs: rounded(firstRegressionLimitMs),
    p95RegressionLimitMs: rounded(p95RegressionLimitMs),
  },
  runtimePublisher,
  optimizedRenderer,
  legacyRendererModel: legacyRendererModel(),
  pass: violations.length === 0,
  violations,
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (args.includes("--output") && outputPath) await writeFile(outputPath, serialized, "utf8");
process.stdout.write(serialized);
if (violations.length) process.exitCode = 1;
