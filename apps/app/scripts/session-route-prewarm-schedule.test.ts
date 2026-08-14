import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SESSION_PREWARM_FALLBACK_DELAY_MS,
  SESSION_PREWARM_IDLE_TIMEOUT_MS,
  scheduleIdleWork,
} from "../src/react-app/shell/session-route/prewarm-schedule";

const appRoot = path.join(import.meta.dir, "..");

describe("session-route prewarm scheduleIdleWork", () => {
  test("uses requestIdleCallback when available and does not run synchronously", () => {
    let ran = false;
    let capturedTimeout: number | undefined;
    let idleId = 0;
    const cancelled: number[] = [];

    const scheduled = scheduleIdleWork({
      run: () => {
        ran = true;
      },
      host: {
        requestIdleCallback: (cb, opts) => {
          capturedTimeout = opts?.timeout;
          idleId = 42;
          // Do not invoke cb here — scheduling only.
          return idleId;
        },
        cancelIdleCallback: (id) => {
          cancelled.push(id);
        },
        setTimeout: () => {
          throw new Error("setTimeout must not be used when idle API exists");
        },
        clearTimeout: () => undefined,
      },
    });

    expect(ran).toBe(false);
    expect(scheduled.usedIdleCallback).toBe(true);
    expect(capturedTimeout).toBe(SESSION_PREWARM_IDLE_TIMEOUT_MS);

    scheduled.cancel();
    expect(cancelled).toEqual([42]);
  });

  test("falls back to delayed setTimeout when idle API is missing", () => {
    let ran = false;
    let delay: number | undefined;
    let timerId = 0;
    const cleared: number[] = [];

    const scheduled = scheduleIdleWork({
      run: () => {
        ran = true;
      },
      host: {
        setTimeout: (handler, timeout) => {
          delay = timeout;
          timerId = 7;
          // Store handler but do not run — proves no sync fire.
          void handler;
          return timerId;
        },
        clearTimeout: (id) => {
          cleared.push(id);
        },
      },
    });

    expect(ran).toBe(false);
    expect(scheduled.usedIdleCallback).toBe(false);
    expect(delay).toBe(SESSION_PREWARM_FALLBACK_DELAY_MS);

    scheduled.cancel();
    expect(cleared).toEqual([7]);
  });

  test("invokes run only when the scheduled callback fires", () => {
    let runCount = 0;
    let pending: (() => void) | null = null;

    scheduleIdleWork({
      run: () => {
        runCount += 1;
      },
      host: {
        requestIdleCallback: (cb) => {
          pending = cb;
          return 1;
        },
        cancelIdleCallback: () => undefined,
        setTimeout: () => 0,
        clearTimeout: () => undefined,
      },
    });

    expect(runCount).toBe(0);
    expect(typeof pending).toBe("function");
    pending?.();
    expect(runCount).toBe(1);
  });

  test("respects custom idle timeout and fallback delay", () => {
    let idleTimeout: number | undefined;
    scheduleIdleWork({
      run: () => undefined,
      idleTimeoutMs: 1_200,
      host: {
        requestIdleCallback: (_cb, opts) => {
          idleTimeout = opts?.timeout;
          return 1;
        },
        cancelIdleCallback: () => undefined,
        setTimeout: () => 0,
        clearTimeout: () => undefined,
      },
    });
    expect(idleTimeout).toBe(1_200);

    let fallback: number | undefined;
    scheduleIdleWork({
      run: () => undefined,
      fallbackDelayMs: 900,
      host: {
        setTimeout: (_h, timeout) => {
          fallback = timeout;
          return 2;
        },
        clearTimeout: () => undefined,
      },
    });
    expect(fallback).toBe(900);
  });
});

describe("session-route prewarm wiring contract", () => {
  test("provider and agent-management prewarm both go through scheduleIdleWork", () => {
    const prewarmHook = readFileSync(
      path.join(
        appRoot,
        "src/react-app/shell/session-route/prewarm-hook.ts",
      ),
      "utf8",
    );
    expect(prewarmHook).toContain("scheduleIdleWork");
    expect(prewarmHook).toContain("prewarmWorkspaceProviders");
    expect(prewarmHook).not.toContain("inventoryOnly: true");
    expect(prewarmHook).toContain("prewarmAgentManagementCore");
    // Must not call prewarmWorkspaceProviders synchronously inside the effect
    // body without scheduling first.
    const withoutImports = prewarmHook.replace(
      /import[\s\S]*?from\s+["'][^"']+["'];?\n/g,
      "",
    );
    // Both prewarm calls live inside scheduleIdleWork run callbacks only.
    const providerIdx = withoutImports.indexOf("prewarmWorkspaceProviders");
    const agentIdx = withoutImports.indexOf("prewarmAgentManagementCore");
    const scheduleIdx = withoutImports.indexOf("scheduleIdleWork");
    expect(scheduleIdx).toBeGreaterThanOrEqual(0);
    expect(providerIdx).toBeGreaterThan(scheduleIdx);
    expect(agentIdx).toBeGreaterThan(scheduleIdx);
  });
});
