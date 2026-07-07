import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSemver,
  compareSemver,
  pickLatestVersion,
  fetchLatestForProvider,
  fetchNpmDistTags,
  buildLifecycleCommand,
  _clearVersionCacheForTests,
} from "../agent-update.mjs";

test("parseSemver handles core, prerelease and build metadata", () => {
  assert.deepEqual(parseSemver("2.1.156"), { core: [2, 1, 156], pre: [] });
  assert.deepEqual(parseSemver("2.1.156-beta.1"), { core: [2, 1, 156], pre: ["beta", "1"] });
  assert.deepEqual(parseSemver("0.1.2505172116"), { core: [0, 1, 2505172116], pre: [] });
  assert.equal(parseSemver("v2.0"), null);
  assert.equal(parseSemver(""), null);
});

test("compareSemver semver rules with prerelease precedence", () => {
  assert.equal(compareSemver("2.1.155", "2.1.156"), -1);
  assert.equal(compareSemver("2.1.156", "2.1.156"), 0);
  assert.equal(compareSemver("2.1.157", "2.1.156"), 1);
  assert.equal(compareSemver("2.1.156-beta.1", "2.1.156"), -1);
  assert.equal(compareSemver("2.1.156", "2.1.156-beta.1"), 1);
  assert.equal(compareSemver("2.1.156-beta.2", "2.1.156-beta.1"), 1);
  assert.equal(compareSemver("garbage", "2.1.156"), null);
});

test("pickLatestVersion returns latest when local not ahead", () => {
  const tags = { latest: "2.1.156", next: "2.1.157-beta.1" };
  assert.equal(pickLatestVersion(tags, ["next"], "2.1.156"), "2.1.156");
  assert.equal(pickLatestVersion(tags, ["next"], "2.1.155"), "2.1.156");
  assert.equal(pickLatestVersion(tags, [], "9.9.9"), "2.1.156");
});

test("pickLatestVersion falls back to prerelease when local strictly leads latest", () => {
  const tags = { latest: "2.1.156", next: "2.1.157-beta.1" };
  assert.equal(pickLatestVersion(tags, ["next"], "2.1.157"), "2.1.157-beta.1");
});

function mockRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("fetchLatestForProvider claude uses npm dist-tags with next channel logic", async () => {
  _clearVersionCacheForTests();
  const fetchImpl = async (url) => {
    if (url.startsWith("https://registry.npmjs.org/@anthropic-ai/claude-code")) {
      return mockRes(200, { "dist-tags": { latest: "2.1.156", next: "2.1.157-beta.1" } });
    }
    return mockRes(404, null);
  };
  const r1 = await fetchLatestForProvider("claude", "2.1.155", { fetchImpl, bypassCache: true });
  assert.equal(r1.latestVersion, "2.1.156");
  assert.equal(r1.latestChannel, "latest");
  const r2 = await fetchLatestForProvider("claude", "2.1.157", { fetchImpl, bypassCache: true });
  assert.equal(r2.latestVersion, "2.1.157-beta.1");
  assert.equal(r2.latestChannel, "next");
});

test("fetchLatestForProvider opencode falls back to GitHub when npm is missing", async () => {
  _clearVersionCacheForTests();
  const fetchImpl = async (url) => {
    if (url.startsWith("https://registry.npmjs.org/opencode-ai")) return mockRes(404, null);
    if (url.includes("api.github.com/repos/anomalyco/opencode/releases/latest")) {
      return mockRes(200, { tag_name: "v0.3.4" });
    }
    return mockRes(404, null);
  };
  const r = await fetchLatestForProvider("opencode", "0.3.3", { fetchImpl, bypassCache: true });
  assert.equal(r.latestVersion, "0.3.4");
  assert.equal(r.latestChannel, "github");
});

test("fetchLatestForProvider hermes goes to PyPI", async () => {
  _clearVersionCacheForTests();
  const fetchImpl = async (url) => {
    if (url.startsWith("https://pypi.org/pypi/hermes-agent/json")) {
      return mockRes(200, { info: { version: "1.4.0" } });
    }
    return mockRes(404, null);
  };
  const r = await fetchLatestForProvider("hermes", "1.3.9", { fetchImpl, bypassCache: true });
  assert.equal(r.latestVersion, "1.4.0");
  assert.equal(r.latestChannel, "pypi");
});

test("fetchLatestForProvider offline path returns error but does not throw", async () => {
  _clearVersionCacheForTests();
  const fetchImpl = async () => { throw new Error("ENOTFOUND"); };
  const r = await fetchLatestForProvider("codex", "0.1.0", { fetchImpl, bypassCache: true });
  assert.equal(r.latestVersion, null);
  assert.equal(r.latestChannel, null);
  assert.ok(r.error);
});

test("buildLifecycleCommand npm anchor + bundled opencode refusal", () => {
  const anchored = buildLifecycleCommand("codex", "update", {
    path: "/Users/me/.npm-global/bin/codex",
    isPathDefault: false,
    source: "npm-global",
    bundled: false,
  });
  assert.equal(anchored.anchored, true);
  assert.match(anchored.command, /npm i -g @openai\/codex@latest --prefix=/);

  const bundled = buildLifecycleCommand("opencode", "update", {
    path: "/Users/me/.opencode/bin/opencode",
    isPathDefault: true,
    source: "bundled",
    bundled: true,
  });
  assert.equal(bundled.command, "");
});

test("buildLifecycleCommand hermes uses install-script fallback", () => {
  const r = buildLifecycleCommand("hermes", "update");
  assert.match(r.command, /hermes update/);
});
