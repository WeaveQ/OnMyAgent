import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  chooseOpencodeBinary,
  chooseProductRuntimeBinary,
  compareVersions,
  isVersionAtLeast,
  parseVersionTokens,
} from "./opencode-binary-policy.mjs";

describe("parseVersionTokens", () => {
  it("parses pinned and CLI-style versions", () => {
    assert.deepEqual(parseVersionTokens("v1.17.20"), [1, 17, 20]);
    assert.deepEqual(parseVersionTokens("1.17.20"), [1, 17, 20]);
    assert.deepEqual(parseVersionTokens("opencode 1.16.0"), [1, 16, 0]);
    assert.equal(parseVersionTokens(""), null);
    assert.equal(parseVersionTokens("not-a-version"), null);
  });
});

describe("compareVersions / isVersionAtLeast", () => {
  it("compares major.minor.patch numerically", () => {
    assert.equal(compareVersions("v1.17.20", "1.17.20"), 0);
    assert.equal(compareVersions("1.18.0", "1.17.20"), 1);
    assert.equal(compareVersions("1.16.9", "1.17.20"), -1);
    assert.equal(isVersionAtLeast("1.17.20", "v1.17.20"), true);
    assert.equal(isVersionAtLeast("1.17.7", "1.17.20"), false);
    assert.equal(isVersionAtLeast("unknown", "1.17.20"), false);
  });
});

describe("chooseOpencodeBinary", () => {
  it("honors explicit path overrides", () => {
    const decision = chooseOpencodeBinary({
      explicitPath: "/custom/opencode",
      localPath: "/usr/local/bin/opencode",
      localVersion: "1.0.0",
      bundledPath: "/app/sidecars/opencode",
      bundledVersion: "v1.17.20",
    });
    assert.equal(decision.path, "/custom/opencode");
    assert.equal(decision.source, "custom");
    assert.equal(decision.reason, "explicit");
    assert.equal(decision.notice, null);
  });

  it("honors env-forced local path without version gating", () => {
    const decision = chooseOpencodeBinary({
      envForcedPath: "/opt/old/opencode",
      localPath: "/opt/old/opencode",
      localVersion: "1.0.0",
      bundledPath: "/app/sidecars/opencode",
      bundledVersion: "v1.17.20",
    });
    assert.equal(decision.path, "/opt/old/opencode");
    assert.equal(decision.source, "local");
    assert.equal(decision.reason, "explicit-env");
    assert.equal(decision.notice, null);
  });

  it("uses local only when version is strictly newer than the bundled pin", () => {
    const decision = chooseOpencodeBinary({
      localPath: "/usr/local/bin/opencode",
      localVersion: "1.18.0",
      bundledPath: "/app/sidecars/opencode",
      bundledVersion: "v1.17.20",
    });
    assert.equal(decision.path, "/usr/local/bin/opencode");
    assert.equal(decision.source, "local");
    assert.equal(decision.reason, "local-compatible");
    assert.equal(decision.notice, null);
  });

  it("prefers bundled when local version equals the pin", () => {
    const decision = chooseOpencodeBinary({
      localPath: "/usr/local/bin/opencode",
      localVersion: "1.17.20",
      bundledPath: "/app/sidecars/opencode",
      bundledVersion: "v1.17.20",
    });
    assert.equal(decision.path, "/app/sidecars/opencode");
    assert.equal(decision.source, "bundled");
    assert.equal(decision.reason, "bundled-only");
    assert.equal(decision.notice, null);
  });

  it("falls back to bundled when local is too old", () => {
    const decision = chooseOpencodeBinary({
      localPath: "/usr/local/bin/opencode",
      localVersion: "1.10.0",
      bundledPath: "/app/sidecars/opencode",
      bundledVersion: "v1.17.20",
    });
    assert.equal(decision.path, "/app/sidecars/opencode");
    assert.equal(decision.source, "bundled");
    assert.equal(decision.reason, "local-too-old");
    assert.match(decision.notice, /低于产品要求/);
    assert.match(decision.notice, /1\.10\.0/);
    assert.match(decision.notice, /1\.17\.20/);
  });

  it("falls back to bundled when local version is unknown", () => {
    const decision = chooseOpencodeBinary({
      localPath: "/usr/local/bin/opencode",
      localVersion: null,
      bundledPath: "/app/sidecars/opencode",
      bundledVersion: "v1.17.20",
    });
    assert.equal(decision.path, "/app/sidecars/opencode");
    assert.equal(decision.source, "bundled");
    assert.equal(decision.reason, "local-version-unknown");
    assert.match(decision.notice, /无法确认本机 OpenCode 版本/);
  });

  it("uses bundled when only bundled exists", () => {
    const decision = chooseOpencodeBinary({
      bundledPath: "/app/sidecars/opencode",
      bundledVersion: "v1.17.20",
    });
    assert.equal(decision.path, "/app/sidecars/opencode");
    assert.equal(decision.source, "bundled");
    assert.equal(decision.reason, "bundled-only");
    assert.equal(decision.notice, null);
  });

  it("uses local when only local exists", () => {
    const decision = chooseOpencodeBinary({
      localPath: "/usr/local/bin/opencode",
      localVersion: "1.2.3",
    });
    assert.equal(decision.path, "/usr/local/bin/opencode");
    assert.equal(decision.source, "local");
    assert.equal(decision.reason, "local-only");
    assert.equal(decision.notice, null);
  });

  it("returns missing when neither path exists", () => {
    const decision = chooseOpencodeBinary({});
    assert.equal(decision.path, null);
    assert.equal(decision.source, null);
    assert.equal(decision.reason, "missing");
  });
});

describe("chooseProductRuntimeBinary", () => {
  it("always prefers bundled over local when both exist", () => {
    const decision = chooseProductRuntimeBinary({
      toolLabel: "Node",
      localPath: "/usr/local/bin/node",
      localVersion: "v22.0.0",
      bundledPath: "/app/runtimes/node",
      bundledVersion: "v24.16.0",
    });
    assert.equal(decision.path, "/app/runtimes/node");
    assert.equal(decision.source, "bundled");
    assert.equal(decision.reason, "bundled-only");
    assert.equal(decision.notice, null);
  });

  it("falls back to local with notice when bundled is missing", () => {
    const decision = chooseProductRuntimeBinary({
      toolLabel: "Python",
      localPath: "/usr/bin/python3",
      localVersion: "3.11.0",
    });
    assert.equal(decision.path, "/usr/bin/python3");
    assert.equal(decision.source, "local");
    assert.equal(decision.reason, "local-only");
    assert.match(decision.notice, /Python/);
  });

  it("honors explicit and env overrides", () => {
    assert.equal(
      chooseProductRuntimeBinary({
        explicitPath: "/custom/node",
        bundledPath: "/app/node",
      }).reason,
      "explicit",
    );
    assert.equal(
      chooseProductRuntimeBinary({
        envForcedPath: "/env/node",
        bundledPath: "/app/node",
      }).reason,
      "explicit-env",
    );
  });
});
