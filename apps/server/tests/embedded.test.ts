import { describe, expect, test } from "bun:test";

import { scheduleDeferredWorkspaceSync } from "../src/embedded.js";

describe("scheduleDeferredWorkspaceSync", () => {
  test("does not start maintenance after stop cancels its grace timer", async () => {
    let started = false;
    const stop = scheduleDeferredWorkspaceSync({
      delayMs: 10,
      run: async () => {
        started = true;
      },
      onError: () => undefined,
    });

    await stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(started).toBe(false);
  });

  test("waits for started maintenance to settle after stop closes the latch", async () => {
    let releaseRun: (() => void) | null = null;
    let shouldContinue: (() => boolean) | null = null;
    const runFinished = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const stop = scheduleDeferredWorkspaceSync({
      delayMs: 0,
      run: async (currentShouldContinue) => {
        shouldContinue = currentShouldContinue;
        await runFinished;
      },
      onError: () => undefined,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(shouldContinue?.()).toBe(true);

    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(shouldContinue?.()).toBe(false);
    expect(stopped).toBe(false);

    releaseRun?.();
    await stopping;
    expect(stopped).toBe(true);
  });
});
