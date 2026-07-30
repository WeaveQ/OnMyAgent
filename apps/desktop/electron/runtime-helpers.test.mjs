import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  BUNDLED_SKILLS_RESOURCE_DIR,
  OPENCODE_BIN_ENV_KEYS,
  buildBundledResourceCandidates,
  buildLocalOpencodeBinaryCandidates,
  buildSoftwareEnvironmentInfo,
  collectDockerCandidatePaths,
  deriveOrchestratorContainerName,
  desiredOpencodePluginVersion,
  envForcedBinaryPath,
  filterExisting,
  firstExisting,
  interpretDockerInfoFailure,
  normalizeWorkspaceKey,
  parseDockerClientVersion,
  parseDockerServerVersion,
  parseManagedContainerNames,
  productRuntimeBinaryEnvKeys,
  productRuntimeBinaryNames,
  productRuntimeBinaryRelativePath,
  prioritizeWorkspacePaths,
  selectBestLocalOpencodeFromProbed,
  shouldAlignOpencodePluginPin,
  shouldSkipLocalOpencodeCandidate,
  softwareToolDetail,
  validateStoppableSandboxContainerName,
} from "./runtime-helpers.mjs";

test("normalizeWorkspaceKey trims, resolves, and lowercases", () => {
  assert.equal(normalizeWorkspaceKey(""), "");
  assert.equal(normalizeWorkspaceKey("  "), "");
  const key = normalizeWorkspaceKey("/tmp/Foo/../Bar");
  assert.equal(key, path.resolve("/tmp/Bar").replace(/\\/g, "/").toLowerCase());
});

test("prioritizeWorkspacePaths prefers active and dedupes by key", () => {
  assert.deepEqual(
    prioritizeWorkspacePaths("/workspace/current", ["/workspace/other", "/workspace/current"]),
    ["/workspace/current", "/workspace/other"],
  );
  assert.deepEqual(
    prioritizeWorkspacePaths("/workspace/current/../current", ["/workspace/current"]),
    ["/workspace/current/../current"],
  );
});

test("buildBundledResourceCandidates includes prod and dev roots", () => {
  const candidates = buildBundledResourceCandidates(
    "/repo/apps/desktop/electron",
    BUNDLED_SKILLS_RESOURCE_DIR,
    "/app/Resources",
  );
  assert.deepEqual(candidates, [
    path.resolve("/app/Resources", BUNDLED_SKILLS_RESOURCE_DIR),
    path.resolve("/repo/apps/desktop/electron", "..", "resources", BUNDLED_SKILLS_RESOURCE_DIR),
  ]);
  assert.deepEqual(
    buildBundledResourceCandidates("/repo/apps/desktop/electron", BUNDLED_SKILLS_RESOURCE_DIR, null),
    [path.resolve("/repo/apps/desktop/electron", "..", "resources", BUNDLED_SKILLS_RESOURCE_DIR)],
  );
});

test("firstExisting and filterExisting respect the predicate", () => {
  const exists = new Set(["b", "c"]);
  assert.equal(firstExisting(["a", "b", "c"], (x) => exists.has(x)), "b");
  assert.equal(firstExisting(["a"], (x) => exists.has(x)), null);
  assert.deepEqual(filterExisting(["a", "b", "c"], (x) => exists.has(x)), ["b", "c"]);
});

test("desiredOpencodePluginVersion strips leading v", () => {
  assert.equal(desiredOpencodePluginVersion("v1.17.8"), "1.17.8");
  assert.equal(desiredOpencodePluginVersion("1.17.8"), "1.17.8");
  assert.equal(desiredOpencodePluginVersion("  "), "");
});

test("shouldAlignOpencodePluginPin allows equal and newer pins", () => {
  assert.equal(shouldAlignOpencodePluginPin("", "1.17.8"), true);
  assert.equal(shouldAlignOpencodePluginPin("1.14.0", "1.17.8"), true);
  assert.equal(shouldAlignOpencodePluginPin("1.17.8", "1.17.8"), false);
  assert.equal(shouldAlignOpencodePluginPin("1.18.0", "1.17.8"), false);
  assert.equal(shouldAlignOpencodePluginPin("1.17.8", ""), false);
});

test("envForcedBinaryPath returns first existing env path", () => {
  const env = {
    OPENCODE_BIN: "/missing/opencode",
    ONMYAGENT_OPENCODE_BIN: "/real/opencode",
  };
  assert.equal(
    envForcedBinaryPath(env, OPENCODE_BIN_ENV_KEYS, (p) => p === "/real/opencode"),
    "/real/opencode",
  );
  assert.equal(envForcedBinaryPath(env, OPENCODE_BIN_ENV_KEYS, () => false), null);
});

test("product runtime binary helpers", () => {
  assert.deepEqual(productRuntimeBinaryEnvKeys("node"), ["ONMYAGENT_NODE_BIN", "NODE_BINARY"]);
  assert.deepEqual(productRuntimeBinaryEnvKeys("python"), ["ONMYAGENT_PYTHON_BIN", "PYTHON_BINARY"]);
  assert.deepEqual(productRuntimeBinaryEnvKeys("other"), []);
  assert.equal(
    productRuntimeBinaryRelativePath("node", "darwin"),
    path.join("node", "bin", "node"),
  );
  assert.equal(
    productRuntimeBinaryRelativePath("python", "win32"),
    path.join("python", "python.exe"),
  );
  assert.deepEqual(productRuntimeBinaryNames("node", "win32"), ["node.exe"]);
  assert.deepEqual(productRuntimeBinaryNames("python", "linux"), ["python3", "python"]);
});

test("parseDockerClientVersion and parseDockerServerVersion", () => {
  assert.equal(
    parseDockerClientVersion("Docker version 27.0.3, build abc\nmore"),
    "Docker version 27.0.3, build abc",
  );
  assert.equal(parseDockerClientVersion("not docker"), null);
  assert.equal(
    parseDockerServerVersion("Client:\n Server Version: 27.0.3\n"),
    "27.0.3",
  );
  assert.equal(parseDockerServerVersion("no server"), null);
});

test("deriveOrchestratorContainerName sanitizes run ids", () => {
  assert.equal(
    deriveOrchestratorContainerName("probe run/1"),
    "onmyagent-orchestrator-probe-run-1",
  );
  assert.ok(deriveOrchestratorContainerName("x".repeat(100)).length < 60);
});

test("parseManagedContainerNames filters managed prefixes", () => {
  assert.deepEqual(
    parseManagedContainerNames(
      "onmyagent-orchestrator-a\nother\nonmyagent-dev-b\nopenwrk-legacy\n",
    ),
    ["onmyagent-dev-b", "onmyagent-orchestrator-a", "openwrk-legacy"],
  );
});

test("interpretDockerInfoFailure maps permission and daemon signals", () => {
  assert.deepEqual(
    interpretDockerInfoFailure("Cannot connect to the Docker daemon"),
    { permissionOk: true, daemonRunning: false, ready: false },
  );
  assert.deepEqual(
    interpretDockerInfoFailure("permission denied while trying to connect"),
    { permissionOk: false, daemonRunning: true, ready: false },
  );
  assert.deepEqual(interpretDockerInfoFailure("unexpected error"), {
    permissionOk: true,
    daemonRunning: true,
    ready: false,
  });
});

test("validateStoppableSandboxContainerName enforces prefix and charset", () => {
  assert.deepEqual(validateStoppableSandboxContainerName(""), {
    ok: false,
    error: "containerName is required",
  });
  const nginx = validateStoppableSandboxContainerName("nginx");
  assert.equal(nginx.ok, false);
  if (!nginx.ok) assert.match(nginx.error, /onmyagent-orchestrator-/);
  const badName = validateStoppableSandboxContainerName("onmyagent-orchestrator-bad name");
  assert.equal(badName.ok, false);
  if (!badName.ok) assert.match(badName.error, /invalid characters/);
  assert.deepEqual(
    validateStoppableSandboxContainerName("onmyagent-orchestrator-probe-1"),
    { ok: true, name: "onmyagent-orchestrator-probe-1" },
  );
});

test("collectDockerCandidatePaths de-dupes env PATH and defaults", () => {
  const candidates = collectDockerCandidatePaths({
    platform: "darwin",
    env: {
      ONMYAGENT_DOCKER_BIN: "/custom/docker",
      PATH: "/usr/bin:/opt/homebrew/bin",
    },
    pathDelimiter: ":",
  });
  assert.equal(candidates[0], "/custom/docker");
  assert.ok(candidates.includes(path.join("/usr/bin", "docker")));
  assert.ok(candidates.includes("/opt/homebrew/bin/docker"));
  assert.equal(new Set(candidates).size, candidates.length);
});

test("buildSoftwareEnvironmentInfo maps binary decisions", () => {
  const probe = (p) => (p === "/node" ? "v20.0.0" : null);
  const info = buildSoftwareEnvironmentInfo(
    {
      path: "/node",
      source: "bundled",
      reason: "bundled-only",
      notice: null,
      bundledVersion: "v20.0.0",
      localVersion: null,
    },
    null,
    {
      path: "/oc",
      source: "local",
      reason: "local-compatible",
      notice: "note",
      bundledVersion: "1.17.0",
      localVersion: "1.18.0",
    },
    probe,
  );
  assert.equal(info.node, true);
  assert.equal(info.python, false);
  assert.equal(info.opencode, true);
  assert.equal(info.details.node.bundled, true);
  assert.equal(info.details.opencode.version, "1.17.0");
  assert.equal(info.details.opencode.notice, "note");
  assert.equal(softwareToolDetail(null, probe).installed, false);
});

test("shouldSkipLocalOpencodeCandidate skips bundled and sidecar copies", () => {
  const bundled = path.resolve("/app/resources/sidecars/opencode");
  assert.equal(shouldSkipLocalOpencodeCandidate(bundled, bundled), true);
  assert.equal(
    shouldSkipLocalOpencodeCandidate(
      `/app/resources/sidecars/opencode-extra`,
      "/other",
    ),
    true,
  );
  assert.equal(shouldSkipLocalOpencodeCandidate("/usr/local/bin/opencode", bundled), false);
});

test("selectBestLocalOpencodeFromProbed prefers newest compatible", () => {
  const { bestCompatible, firstExisting } = selectBestLocalOpencodeFromProbed(
    [
      { path: "/old", version: "1.14.0" },
      { path: "/new", version: "1.18.0" },
      { path: "/mid", version: "1.17.0" },
    ],
    "1.17.0",
  );
  assert.equal(firstExisting?.path, "/old");
  assert.equal(bestCompatible?.path, "/new");
  assert.equal(bestCompatible?.version, "1.18.0");
});

test("buildLocalOpencodeBinaryCandidates includes PATH and platform extras", () => {
  const unix = buildLocalOpencodeBinaryCandidates({
    platform: "darwin",
    homeDir: "/Users/me",
    pathEnv: "/opt/homebrew/bin:/usr/bin",
    pathDelimiter: ":",
  });
  assert.ok(unix.includes(path.join("/opt/homebrew/bin", "opencode")));
  assert.ok(unix.includes(path.join("/Users/me", ".opencode", "bin", "opencode")));

  const win = buildLocalOpencodeBinaryCandidates({
    platform: "win32",
    homeDir: "C:\\\\Users\\\\me",
    pathEnv: "C:\\\\bin",
    pathDelimiter: ";",
    env: { LOCALAPPDATA: "C:\\\\Users\\\\me\\\\AppData\\\\Local" },
  });
  assert.ok(win.some((p) => p.endsWith("opencode.exe")));
});
