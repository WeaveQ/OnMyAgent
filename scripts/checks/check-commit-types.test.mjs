import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  CommitRangeError,
  resolveCommitRange,
  runTypeChecksForCommits,
} from "./check-commit-types.mjs";

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "onmyagent-type-gate-fixture-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "type-gate@example.test"]);
  git(root, ["config", "user.name", "Type Gate Fixture"]);
  writeFileSync(join(root, "tracked.txt"), "base\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "tracked.txt"), "first\n");
  git(root, ["commit", "-qam", "first"]);
  const first = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "tracked.txt"), "second\n");
  git(root, ["commit", "-qam", "second"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  return { root, base, first, head };
}

function writeEvent(root, event) {
  const path = join(root, "event.json");
  writeFileSync(path, `${JSON.stringify(event)}\n`);
  return path;
}

test("resolves PR SHA range after the base branch ref was deleted", () => {
  const fixture = fixtureRepo();
  try {
    git(fixture.root, ["branch", "base-ref", fixture.base]);
    git(fixture.root, ["branch", "-D", "base-ref"]);
    const eventPath = writeEvent(fixture.root, {
      pull_request: {
        base: { sha: fixture.base },
        head: { sha: fixture.head, repo: { fork: true } },
      },
    });
    const result = resolveCommitRange({
      repoRoot: fixture.root,
      eventPath,
      env: { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventPath },
    });
    assert.deepEqual(result.commits, [fixture.first, fixture.head]);
    assert.equal(result.base, fixture.base);
    assert.equal(result.head, fixture.head);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolves push before/after SHAs without requiring a branch ref", () => {
  const fixture = fixtureRepo();
  try {
    const eventPath = writeEvent(fixture.root, { before: fixture.base, after: fixture.head });
    const result = resolveCommitRange({
      repoRoot: fixture.root,
      eventPath,
      env: { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventPath },
    });
    assert.equal(result.count, 2);
    assert.deepEqual(result.commits, [fixture.first, fixture.head]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("push with missing event.before checks the tip instead of failing closed", () => {
  const fixture = fixtureRepo();
  try {
    const eventPath = writeEvent(fixture.root, {
      before: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      after: fixture.head,
    });
    const result = resolveCommitRange({
      repoRoot: fixture.root,
      eventPath,
      env: { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventPath },
    });
    assert.equal(result.fallback, "push-before-unavailable");
    assert.equal(result.count, 1);
    assert.deepEqual(result.commits, [fixture.head]);
    assert.equal(result.base, fixture.head);
    assert.equal(result.head, fixture.head);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("returns a typed BASE_UNAVAILABLE error instead of guessing a shallow/deleted base", () => {
  const fixture = fixtureRepo();
  try {
    const eventPath = writeEvent(fixture.root, {
      pull_request: {
        base: { sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
        head: { sha: fixture.head },
      },
    });
    assert.throws(
      () => resolveCommitRange({ repoRoot: fixture.root, eventPath }),
      (error) => {
        assert.ok(error instanceof CommitRangeError);
        assert.equal(error.code, "BASE_UNAVAILABLE");
        assert.match(error.message, /never fetches automatically/);
        return true;
      },
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a range above the bounded maximum before worktrees are created", () => {
  const fixture = fixtureRepo();
  try {
    assert.throws(
      () => resolveCommitRange({
        repoRoot: fixture.root,
        base: fixture.base,
        head: fixture.head,
        maxCommits: 1,
      }),
      (error) => {
        assert.ok(error instanceof CommitRangeError);
        assert.equal(error.code, "RANGE_TOO_LARGE");
        assert.match(error.message, /bounded maximum of 1/);
        return true;
      },
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("isolated integration: dirty current worktree is byte/status unchanged", () => {
  const fixture = fixtureRepo();
  try {
    writeFileSync(join(fixture.root, "tracked.txt"), "dirty but must survive\n");
    writeFileSync(join(fixture.root, "untracked.txt"), "untracked must survive\n");
    const beforeStatus = git(fixture.root, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const beforeHead = git(fixture.root, ["rev-parse", "HEAD"]);
    const beforeTracked = readFileSync(join(fixture.root, "tracked.txt"));
    const beforeUntracked = readFileSync(join(fixture.root, "untracked.txt"));
    const seen = [];

    const result = runTypeChecksForCommits({
      repoRoot: fixture.root,
      commits: [fixture.first, fixture.head],
      runCheck: ({ cwd, commit }) => {
        // Simulate pnpm/turbo writing caches or diagnostics. The write must
        // land in the detached worktree, never in the dirty checkout.
        writeFileSync(join(cwd, "worktree-only.txt"), `${commit}\n`);
        seen.push(git(cwd, ["rev-parse", "HEAD"]));
        return { status: 0 };
      },
    });

    assert.deepEqual(result.checked, [fixture.first, fixture.head]);
    assert.deepEqual(seen, [fixture.first, fixture.head]);
    assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), beforeHead);
    assert.equal(git(fixture.root, ["status", "--porcelain=v1", "--untracked-files=all"]), beforeStatus);
    assert.deepEqual(readFileSync(join(fixture.root, "tracked.txt")), beforeTracked);
    assert.deepEqual(readFileSync(join(fixture.root, "untracked.txt")), beforeUntracked);
    assert.equal(existsSync(join(fixture.root, "worktree-only.txt")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
