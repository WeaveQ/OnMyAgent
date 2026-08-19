import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVersionMatchesLine,
  bumpBranchName,
  githubRepoFromRemote,
  isProtectedLine,
  isReleaseTag,
  nextSemver,
  parseRemoteLineNames,
  parsePrepareArgs,
  parseShipArgs,
  releasePrBody,
  resolveReleaseBase,
} from "./policy.mjs";

test("parseRemoteLineNames keeps protected lines only", () => {
  assert.deepEqual(
    parseRemoteLineNames("origin/dev\norigin/main\norigin/release/0.5\norigin/feat/foo\n"),
    ["dev", "main", "release/0.5"],
  );
});

test("isProtectedLine covers daily, stable, and release lines", () => {
  assert.equal(isProtectedLine("dev"), true);
  assert.equal(isProtectedLine("main"), true);
  assert.equal(isProtectedLine("release/0.5"), true);
  assert.equal(isProtectedLine("feat/foo"), false);
});

test("nextSemver bumps from the current line version", () => {
  assert.equal(nextSemver("1.0.0", "patch"), "1.0.1");
  assert.equal(nextSemver("1.0.0", "minor"), "1.1.0");
  assert.equal(nextSemver("0.5.22", "patch"), "0.5.23");
  assert.equal(nextSemver("0.5.22", "major"), "1.0.0");
});

test("assertVersionMatchesLine keeps release/0.5 on 0.5.x", () => {
  assert.doesNotThrow(() => assertVersionMatchesLine("release/0.5", "0.5.23"));
  assert.doesNotThrow(() => assertVersionMatchesLine("dev", "1.0.1"));
  assert.throws(
    () => assertVersionMatchesLine("release/0.5", "1.0.1"),
    /must stay on 0\.5\.x/,
  );
});

test("resolveReleaseBase uses the current protected line", () => {
  assert.deepEqual(
    resolveReleaseBase({ currentBranch: "dev" }),
    { base: "dev", checkoutBumpBranch: true },
  );
  assert.deepEqual(
    resolveReleaseBase({ currentBranch: "release/0.5" }),
    { base: "release/0.5", checkoutBumpBranch: true },
  );
});

test("resolveReleaseBase infers a topic branch from ancestors", () => {
  assert.deepEqual(
    resolveReleaseBase({
      currentBranch: "feat/foo",
      lines: [
        { name: "dev", behind: 0 },
        { name: "main", behind: 0 },
      ],
    }),
    { base: "dev", checkoutBumpBranch: false },
  );
  assert.deepEqual(
    resolveReleaseBase({
      currentBranch: "fix/0.5-scroll",
      lines: [
        { name: "release/0.5", behind: 0 },
        { name: "dev", behind: 12 },
      ],
    }),
    { base: "release/0.5", checkoutBumpBranch: false },
  );
});

test("resolveReleaseBase rejects a topic branch not based on a line", () => {
  assert.throws(
    () =>
      resolveReleaseBase({
        currentBranch: "wip",
        lines: [
          { name: "dev", behind: 3 },
          { name: "main", behind: 3 },
        ],
      }),
    /Pass --base/,
  );
});

test("resolveReleaseBase rejects --base that disagrees with a protected line", () => {
  assert.throws(
    () =>
      resolveReleaseBase({
        currentBranch: "main",
        explicitBase: "dev",
      }),
    /Switch to dev first/,
  );
});

test("parsePrepareArgs accepts set, bump type, and flags", () => {
  assert.deepEqual(parsePrepareArgs(["--set", "0.5.23", "--base", "release/0.5"]), {
    dryRun: false,
    ci: false,
    noPr: false,
    noPush: false,
    bumpType: "set",
    setVersion: "0.5.23",
    base: "release/0.5",
  });
  assert.equal(parsePrepareArgs(["minor"]).bumpType, "minor");
  assert.equal(parsePrepareArgs(["--no-push"]).noPr, true);
  assert.throws(() => parsePrepareArgs(["--set"]), /requires a version/);
  assert.throws(() => parsePrepareArgs(["--set", "1.0.1", "patch"]), /not both/);
});

test("parseShipArgs and tag helpers", () => {
  assert.deepEqual(parseShipArgs(["--dry-run", "--tag", "v1.0.1"]), {
    dryRun: true,
    watch: false,
    tag: "v1.0.1",
  });
  assert.equal(isReleaseTag("v1.0.1"), true);
  assert.equal(isReleaseTag("v1.0.1-beta"), false);
  assert.equal(githubRepoFromRemote("git@github.com:WeaveQ/OnMyAgent.git"), "WeaveQ/OnMyAgent");
  assert.equal(
    githubRepoFromRemote("https://github.com/WeaveQ/OnMyAgent.git"),
    "WeaveQ/OnMyAgent",
  );
  assert.equal(bumpBranchName("1.0.1"), "chore/bump-1.0.1");
  assert.match(releasePrBody({ version: "1.0.1", base: "dev", tag: "v1.0.1" }), /merge commit/);
});
