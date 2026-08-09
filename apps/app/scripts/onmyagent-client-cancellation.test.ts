import { afterEach, describe, expect, test } from "bun:test";

import { requestJson } from "../src/app/lib/onmyagent-server/client-shared";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installPendingFetch() {
  let observedSignal: AbortSignal | null = null;
  globalThis.fetch = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      observedSignal = signal;
      signal.addEventListener(
        "abort",
        () => {
          const reason = signal.reason;
          reject(
            reason instanceof Error
              ? reason
              : new DOMException("Request cancelled.", "AbortError"),
          );
        },
        { once: true },
      );
    });
  return () => observedSignal;
}

describe("OnMyAgent client cancellation", () => {
  test("caller abort cancels the underlying fetch", async () => {
    const readObservedSignal = installPendingFetch();
    const caller = new AbortController();
    const request = requestJson("http://127.0.0.1:1", "/snapshot", {
      signal: caller.signal,
      timeoutMs: 1_000,
    });

    await Promise.resolve();
    caller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(readObservedSignal()?.aborted).toBe(true);
  });

  test("deadline aborts the underlying fetch before reporting timeout", async () => {
    const readObservedSignal = installPendingFetch();
    const request = requestJson("http://127.0.0.1:1", "/snapshot", {
      timeoutMs: 10,
    });

    await expect(request).rejects.toThrow("Request timed out.");
    expect(readObservedSignal()?.aborted).toBe(true);
  });
});
