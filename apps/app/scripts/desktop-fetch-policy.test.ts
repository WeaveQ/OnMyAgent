import assert from "node:assert/strict";

const {
  classifyDesktopFetchDestination,
  hostMatchesAllowlist,
  isLoopbackHostname,
  isHttpProtocol,
  DesktopFetchPolicyError,
} = await import("../src/app/lib/desktop-fetch-policy.ts");

const results = {
  ok: true,
  steps: [] as Array<Record<string, unknown>>,
};

function step(name: string, fn: () => void) {
  results.steps.push({ name, status: "running" });
  const index = results.steps.length - 1;
  try {
    fn();
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

try {
  step("loopback hostnames are recognized", () => {
    assert.equal(isLoopbackHostname("127.0.0.1"), true);
    assert.equal(isLoopbackHostname("localhost"), true);
    assert.equal(isLoopbackHostname("[::1]"), true);
    assert.equal(isLoopbackHostname("example.com"), false);
  });

  step("only http(s) protocols are network-eligible", () => {
    assert.equal(isHttpProtocol("https:"), true);
    assert.equal(isHttpProtocol("http:"), true);
    assert.equal(isHttpProtocol("file:"), false);
    assert.equal(isHttpProtocol("javascript:"), false);
  });

  step("loopback http(s) routes direct", () => {
    const decision = classifyDesktopFetchDestination("http://127.0.0.1:4096/health");
    assert.equal(decision.route, "direct");
    assert.equal(decision.reason, "loopback");
  });

  step("public https is forced through main-process proxy", () => {
    const decision = classifyDesktopFetchDestination("https://api.example.com/v1");
    assert.equal(decision.route, "via-main");
    assert.match(decision.reason, /via-main-proxy/);
    assert.equal(decision.hostname, "api.example.com");
  });

  step("non-http schemes are rejected", () => {
    const file = classifyDesktopFetchDestination("file:///etc/passwd");
    assert.equal(file.route, "reject");
    assert.match(file.reason, /blocked-scheme/);

    const js = classifyDesktopFetchDestination("javascript:alert(1)");
    assert.equal(js.route, "reject");
  });

  step("strict host allowlist rejects unknown hosts", () => {
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

  step("wildcard allowlist matches suffixes", () => {
    assert.equal(hostMatchesAllowlist("a.b.onmyagent.local", ["*.onmyagent.local"]), true);
    assert.equal(hostMatchesAllowlist("other.com", ["*.onmyagent.local"]), false);
  });

  step("relative URLs stay direct (same-origin)", () => {
    const decision = classifyDesktopFetchDestination("/api/session");
    assert.equal(decision.route, "direct");
  });

  step("protocol-relative //host must NOT bypass main proxy", () => {
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

  step("policy error carries the decision", () => {
    const decision = classifyDesktopFetchDestination("file:///tmp/x");
    const err = new DesktopFetchPolicyError(decision);
    assert.equal(err.code, "desktop_fetch_policy_rejected");
    assert.equal(err.decision.route, "reject");
    assert.match(err.message, /desktopFetch blocked/);
  });

  // Structural: shipped desktopFetchWithTimeout must consult the policy.
  step("desktop.ts wires classifyDesktopFetchDestination into desktopFetchWithTimeout", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const path = fileURLToPath(new URL("../src/app/lib/desktop.ts", import.meta.url));
    const source = await readFile(path, "utf8");
    assert.match(source, /classifyDesktopFetchDestination/);
    assert.match(source, /DesktopFetchPolicyError/);
    assert.match(source, /desktopFetchWithTimeout/);
    assert.match(source, /decision\.route === "reject"/);
    assert.match(source, /decision\.route === "direct"/);
    assert.match(source, /desktopFetchViaMain/);
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
