// @ts-expect-error -- this package intentionally omits Node.js runtime types.
import test from "node:test";
// @ts-expect-error -- this package intentionally omits Node.js runtime types.
import assert from "node:assert/strict";
import {
  officeCliAssetKeySchema,
  officeCliLatestManifestSchema,
  officeCliReleaseManifestSchema,
  officeCliStateSchema,
} from "@onmyagent/types/officecli";

const digest = "a".repeat(64);

const releaseManifest = {
  schemaVersion: 1,
  pluginId: "officecli",
  version: "1.0.103",
  skill: { path: "SKILL.md", sha256: digest, size: 1200 },
  assets: {
    "darwin-arm64": {
      path: "officecli-darwin-arm64",
      sha256: digest,
      size: 1200,
    },
  },
};

test("accepts a stable OfficeCLI release manifest", () => {
  const parsed = officeCliReleaseManifestSchema.parse(releaseManifest);

  assert.equal(parsed.pluginId, "officecli");
  assert.equal(parsed.assets["darwin-arm64"]?.size, 1200);
});

test("rejects unsafe release paths and invalid versions", () => {
  assert.throws(() =>
    officeCliReleaseManifestSchema.parse({
      ...releaseManifest,
      version: "latest",
    }),
  );
  assert.throws(() =>
    officeCliReleaseManifestSchema.parse({
      ...releaseManifest,
      skill: { ...releaseManifest.skill, path: "../SKILL.md" },
    }),
  );
});

test("accepts the remote pointer and local installation state", () => {
  const latest = officeCliLatestManifestSchema.parse({
    schemaVersion: 1,
    pluginId: "officecli",
    channel: "stable",
    latestVersion: "1.0.103",
    releaseManifest: {
      path: "releases/1.0.103/manifest.json",
      sha256: digest,
      size: 500,
    },
  });
  const state = officeCliStateSchema.parse({
    schemaVersion: 1,
    pluginId: "officecli",
    activeVersion: "1.0.103",
    previousVersion: "1.0.102",
    platform: "darwin-arm64",
    installedSkillPath: "/tmp/skills/officecli",
    installedAt: 1,
    updatedAt: 2,
    releases: {
      "1.0.103": { binarySha256: digest, skillSha256: digest },
    },
  });

  assert.equal(latest.releaseManifest.path, "releases/1.0.103/manifest.json");
  assert.equal(state.previousVersion, "1.0.102");
});

test("keeps the platform key vocabulary explicit", () => {
  assert.deepEqual(
    officeCliAssetKeySchema.options,
    [
      "darwin-arm64",
      "darwin-x64",
      "win32-arm64",
      "win32-x64",
      "linux-arm64",
      "linux-x64",
    ],
  );
});
