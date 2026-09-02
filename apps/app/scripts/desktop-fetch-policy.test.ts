import assert from "node:assert/strict";

const {
  classifyDesktopFetchDestination,
  hostMatchesAllowlist,
  isLoopbackHostname,
  isHttpProtocol,
  DesktopFetchPolicyError,
  fetchDirectWithTimeout,
} = await import("../src/app/lib/desktop-fetch-policy.ts");

const results = {
  ok: true,
  steps: [] as Array<Record<string, unknown>>,
};

async function step(name: string, fn: () => void | Promise<void>) {
  results.steps.push({ name, status: "running" });
  const index = results.steps.length - 1;
  try {
    await fn();
    results.steps[index] = { name, status: "ok" };
  } catch (error) {
    results.ok = false;
    results.steps[index] = {
      name,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
}

const originalFetch = globalThis.fetch;

function installHangingFetch() {
  let observedSignal: AbortSignal | null = null;
  globalThis.fetch = (input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal =
        init?.signal ??
        (typeof Request !== "undefined" && input instanceof Request
          ? input.signal
          : undefined);
      observedSignal = signal ?? null;
      if (!signal) return;
      const fail = () => {
        const reason = signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new DOMException("Request cancelled.", "AbortError"),
        );
      };
      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener("abort", fail, { once: true });
    });
  return () => observedSignal;
}

try {
  await step("loopback hostnames are recognized", () => {
    assert.equal(isLoopbackHostname("127.0.0.1"), true);
    assert.equal(isLoopbackHostname("localhost"), true);
    assert.equal(isLoopbackHostname("[::1]"), true);
    assert.equal(isLoopbackHostname("example.com"), false);
  });

  await step("only http(s) protocols are network-eligible", () => {
    assert.equal(isHttpProtocol("https:"), true);
    assert.equal(isHttpProtocol("http:"), true);
    assert.equal(isHttpProtocol("file:"), false);
    assert.equal(isHttpProtocol("javascript:"), false);
  });

  await step("loopback http(s) routes direct", () => {
    const decision = classifyDesktopFetchDestination("http://127.0.0.1:4096/health");
    assert.equal(decision.route, "direct");
    assert.equal(decision.reason, "loopback");
  });

  await step("public https is forced through main-process proxy", () => {
    const decision = classifyDesktopFetchDestination("https://api.example.com/v1");
    assert.equal(decision.route, "via-main");
    assert.match(decision.reason, /via-main-proxy/);
    assert.equal(decision.hostname, "api.example.com");
  });

  await step("non-http schemes are rejected", () => {
    const file = classifyDesktopFetchDestination("file:///etc/passwd");
    assert.equal(file.route, "reject");
    assert.match(file.reason, /blocked-scheme/);

    const js = classifyDesktopFetchDestination("javascript:alert(1)");
    assert.equal(js.route, "reject");
  });

  await step("strict host allowlist rejects unknown hosts", () => {
    const allowed = classifyDesktopFetchDestination("https://cdn.example.com/x", {
      hostAllowlist: ["cdn.example.com", "*.onmyagent.local"],
    });
    assert.equal(allowed.route, "via-main");

    const denied = classifyDesktopFetchDestination("https://evil.example/x", {
      hostAllowlist: ["cdn.example.com"],
    });
    assert.equal(denied.route, "reject");
    assert.equal(denied.reason, "host-not-allowlisted");
  });

  await step("wildcard allowlist matches suffixes", () => {
    assert.equal(hostMatchesAllowlist("a.b.onmyagent.local", ["*.onmyagent.local"]), true);
    assert.equal(hostMatchesAllowlist("other.com", ["*.onmyagent.local"]), false);
  });

  await step("relative URLs stay direct (same-origin)", () => {
    const decision = classifyDesktopFetchDestination("/api/session");
    assert.equal(decision.route, "direct");
  });

  await step("protocol-relative //host must NOT bypass main proxy", () => {
    // Regression: old path treated //evil.com as relative → globalThis.fetch.
    const evil = classifyDesktopFetchDestination("//evil.com/exfiltrate");
    assert.equal(evil.route, "via-main");
    assert.equal(evil.hostname, "evil.com");
    assert.match(evil.reason, /protocol-relative|via-main-proxy/);

    const loopback = classifyDesktopFetchDestination("//127.0.0.1:4096/health");
    assert.equal(loopback.route, "direct");
    assert.equal(loopback.reason, "loopback");

    const denied = classifyDesktopFetchDestination("//evil.example/x", {
      hostAllowlist: ["cdn.example.com"],
    });
    assert.equal(denied.route, "reject");
    assert.equal(denied.reason, "host-not-allowlisted");
  });

  await step("policy error carries the decision", () => {
    const decision = classifyDesktopFetchDestination("file:///tmp/x");
    const err = new DesktopFetchPolicyError(decision);
    assert.equal(err.code, "desktop_fetch_policy_rejected");
    assert.equal(err.decision.route, "reject");
    assert.match(err.message, /desktopFetch blocked/);
  });

  // Structural: shipped desktopFetchWithTimeout must consult the policy.
  await step("desktop.ts wires classifyDesktopFetchDestination into desktopFetchWithTimeout", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const path = fileURLToPath(new URL("../src/app/lib/desktop.ts", import.meta.url));
    const policyPath = fileURLToPath(
      new URL("../src/app/lib/desktop-fetch-policy.ts", import.meta.url),
    );
    const source = await readFile(path, "utf8");
    const policy = await readFile(policyPath, "utf8");
    assert.match(source, /classifyDesktopFetchDestination/);
    assert.match(source, /DesktopFetchPolicyError/);
    assert.match(source, /desktopFetchWithTimeout/);
    assert.match(source, /decision\.route === "reject"/);
    assert.match(source, /decision\.route === "direct"/);
    assert.match(source, /desktopFetchViaMain/);
    assert.match(source, /fetchDirectWithTimeout/);
    assert.match(policy, /export function fetchDirectWithTimeout/);
    assert.match(policy, /controller.abort\(new Error\("Request timed out\."\)\)/);
  });

  await step("timeoutMs aborts hanging loopback fetch", async () => {
    const readSignal = installHangingFetch();
    try {
      await assert.rejects(
        fetchDirectWithTimeout("http://127.0.0.1/health", undefined, 15),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Request timed out.");
          return true;
        },
      );
      assert.equal(readSignal()?.aborted, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await step("init.signal abort is forwarded while timeout is armed", async () => {
    const readSignal = installHangingFetch();
    const caller = new AbortController();
    try {
      const pending = fetchDirectWithTimeout(
        "http://127.0.0.1/health",
        { signal: caller.signal },
        5_000,
      );
      await Promise.resolve();
      caller.abort();
      await assert.rejects(pending);
      assert.equal(readSignal()?.aborted, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await step("Request.signal abort is combined with timeoutMs", async () => {
    const readSignal = installHangingFetch();
    const caller = new AbortController();
    try {
      const request = new Request("http://127.0.0.1/health", { signal: caller.signal });
      const pending = fetchDirectWithTimeout(request, undefined, 5_000);
      await Promise.resolve();
      caller.abort();
      await assert.rejects(pending);
      assert.equal(readSignal()?.aborted, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await step("timeoutMs 0/undefined/NaN does not install a timer", async () => {
    let fetchCalls = 0;
    let timeoutCalls = 0;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response("ok");
    };
    globalThis.setTimeout = ((...args: Parameters<typeof realSetTimeout>) => {
      timeoutCalls += 1;
      return realSetTimeout(...args);
    }) as typeof setTimeout;
    try {
      await fetchDirectWithTimeout("http://127.0.0.1/health", undefined, 0);
      await fetchDirectWithTimeout("http://127.0.0.1/health", undefined, undefined);
      await fetchDirectWithTimeout("http://127.0.0.1/health", undefined, Number.NaN);
      assert.equal(fetchCalls, 3);
      assert.equal(timeoutCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = realSetTimeout;
    }
  });

  await step("already-aborted init.signal rejects without fetch", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response("ok");
    };
    const caller = new AbortController();
    caller.abort(new Error("already cancelled"));
    try {
      await assert.rejects(
        fetchDirectWithTimeout(
          "http://127.0.0.1/health",
          { signal: caller.signal },
          1_000,
        ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "already cancelled");
          return true;
        },
      );
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  results.ok = false;
  console.error(
    JSON.stringify(
      {
        ...results,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
