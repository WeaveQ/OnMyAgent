#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCommand } from "../lib/run-command.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "../..");
export const DEFAULT_MAX_COMMITS = 20;
const ZERO_SHA = /^0+$/;

/**
 * A typed, actionable error from the per-commit type gate.
 *
 * The gate deliberately does not fetch or mutate the current checkout. A
 * caller that sees BASE_UNAVAILABLE must make the base object available (or
 * pass an explicit existing ref) before retrying.
 */
export class CommitRangeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CommitRangeError";
    this.code = code;
    this.details = details;
  }
}

export class TypeCheckGateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TypeCheckGateError";
    this.code = code;
    this.details = details;
  }
}

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new TypeCheckGateError(
      "GIT_UNAVAILABLE",
      `Unable to execute git: ${result.error.message}`,
      { args },
    );
  }
  if (result.status !== 0 && !allowFailure) {
    throw new TypeCheckGateError(
      "GIT_COMMAND_FAILED",
      `git ${args.join(" ")} failed (${result.status ?? "unknown"}): ${(result.stderr ?? "").trim()}`,
      { args, status: result.status, stderr: result.stderr ?? "" },
    );
  }
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
  };
}

function readJsonFile(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function valueAt(object, path) {
  let current = object;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function addCandidate(list, value, label) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || ZERO_SHA.test(trimmed)) return;
  if (list.some((entry) => entry.value === trimmed)) return;
  list.push({ value: trimmed, label });
}

function addBranchCandidates(list, branch, label) {
  if (typeof branch !== "string") return;
  const trimmed = branch.trim();
  if (!trimmed || ZERO_SHA.test(trimmed)) return;
  if (trimmed.startsWith("refs/")) {
    addCandidate(list, trimmed, label);
    return;
  }
  // Prefer refs that are already present. No fetch is attempted here.
  addCandidate(list, `refs/remotes/origin/${trimmed}`, `${label} (origin ref)`);
  addCandidate(list, `refs/heads/${trimmed}`, `${label} (local ref)`);
  addCandidate(list, trimmed, `${label} (existing ref)`);
}

function resolveObject(repoRoot, candidate) {
  if (!candidate || candidate.startsWith("-")) return null;
  const result = runGit(
    repoRoot,
    ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
    { allowFailure: true },
  );
  if (result.status !== 0 || !result.stdout) return null;
  const sha = result.stdout.split(/\s+/)[0]?.trim();
  return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : null;
}

function resolveFirst(repoRoot, candidates) {
  const attempted = [];
  for (const candidate of candidates) {
    attempted.push(candidate.label);
    const sha = resolveObject(repoRoot, candidate.value);
    if (sha) return { sha, candidate, attempted };
  }
  return { sha: null, attempted };
}

function eventCandidates({ env, event }) {
  const base = [];
  const head = [];
  const pullRequestBase = valueAt(event, ["pull_request", "base", "sha"]);
  const pullRequestHead = valueAt(event, ["pull_request", "head", "sha"]);
  addCandidate(base, env.TYPE_GATE_BASE, "TYPE_GATE_BASE");
  addCandidate(base, env.BASE_SHA, "BASE_SHA");
  addCandidate(base, env.GITHUB_BASE_SHA, "GITHUB_BASE_SHA");
  addCandidate(base, env.GITHUB_PR_BASE_SHA, "GITHUB_PR_BASE_SHA");
  addCandidate(base, env.CI_MERGE_REQUEST_DIFF_BASE_SHA, "CI_MERGE_REQUEST_DIFF_BASE_SHA");
  addCandidate(base, env.CI_COMMIT_BEFORE_SHA, "CI_COMMIT_BEFORE_SHA");
  addCandidate(base, pullRequestBase, "event pull_request.base.sha");
  addCandidate(base, event?.before, "event before");
  addCandidate(base, env.GITHUB_EVENT_BEFORE, "GITHUB_EVENT_BEFORE");
  addCandidate(base, env.GITHUB_BEFORE, "GITHUB_BEFORE");
  addBranchCandidates(base, env.GITHUB_BASE_REF, "GITHUB_BASE_REF");

  addCandidate(head, env.TYPE_GATE_HEAD, "TYPE_GATE_HEAD");
  addCandidate(head, env.HEAD_SHA, "HEAD_SHA");
  // A fork PR's source SHA is preferred to GITHUB_SHA (which may be a merge
  // commit), but the latter is a useful existing-object fallback.
  addCandidate(head, pullRequestHead, "event pull_request.head.sha");
  addCandidate(head, event?.after, "event after");
  addCandidate(head, env.GITHUB_HEAD_SHA, "GITHUB_HEAD_SHA");
  addCandidate(head, env.GITHUB_PR_HEAD_SHA, "GITHUB_PR_HEAD_SHA");
  addCandidate(head, env.GITHUB_SHA, "GITHUB_SHA");
  addCandidate(head, env.CI_COMMIT_SHA, "CI_COMMIT_SHA");
  addCandidate(head, env.GITHUB_COMMIT, "GITHUB_COMMIT");
  addCandidate(head, "HEAD", "local HEAD");
  return { base, head };
}

function parseMaxCommits(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_MAX_COMMITS;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new CommitRangeError(
      "MAX_COMMITS_INVALID",
      `max commits must be a positive integer; received ${String(value)}`,
      { value },
    );
  }
  return parsed;
}

/**
 * Resolve the commits introduced by a push/PR without relying on a branch
 * ref being present. Existing SHA objects and local refs are accepted; no
 * network operation is performed.
 */
export function resolveCommitRange({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  base,
  head,
  baseSha,
  headSha,
  maxCommits,
  eventPath,
} = {}) {
  const root = resolve(repoRoot);
  const eventFile = eventPath ?? env.GITHUB_EVENT_PATH;
  const event = readJsonFile(eventFile) ?? {};
  const candidates = eventCandidates({
    env: {
      ...env,
      ...((base ?? baseSha) ? { TYPE_GATE_BASE: base ?? baseSha } : {}),
      ...((head ?? headSha) ? { TYPE_GATE_HEAD: head ?? headSha } : {}),
    },
    event,
  });
  const resolvedBase = resolveFirst(root, candidates.base);
  if (!resolvedBase.sha) {
    throw new CommitRangeError(
      "BASE_UNAVAILABLE",
      `No usable base commit is available. Tried ${resolvedBase.attempted.join(", ") || "no candidates"}. Make the base object available locally or pass --base/TYPE_GATE_BASE; this gate never fetches automatically.`,
      { attempted: resolvedBase.attempted, eventPath: eventFile ?? null },
    );
  }
  const resolvedHead = resolveFirst(root, candidates.head);
  if (!resolvedHead.sha) {
    throw new CommitRangeError(
      "HEAD_UNAVAILABLE",
      `No usable head commit is available. Tried ${resolvedHead.attempted.join(", ") || "no candidates"}. Pass --head/TYPE_GATE_HEAD or check out a commit.`,
      { attempted: resolvedHead.attempted, eventPath: eventFile ?? null },
    );
  }

  const limit = parseMaxCommits(maxCommits ?? env.TYPE_GATE_MAX_COMMITS ?? env.MAX_COMMITS);
  const range = `${resolvedBase.sha}..${resolvedHead.sha}`;
  const countResult = runGit(root, ["rev-list", "--count", range], { allowFailure: true });
  if (countResult.status !== 0 || !/^\d+$/.test(countResult.stdout)) {
    throw new CommitRangeError(
      "RANGE_UNAVAILABLE",
      `Unable to enumerate ${range}. The base/head objects may be outside a shallow clone; deepen the existing checkout or pass an available base/head ref. No fetch was attempted.`,
      { base: resolvedBase.sha, head: resolvedHead.sha, stderr: countResult.stderr },
    );
  }
  const count = Number(countResult.stdout);
  if (!Number.isSafeInteger(count)) {
    throw new CommitRangeError("RANGE_UNAVAILABLE", `Commit count is not safe to represent: ${countResult.stdout}`);
  }
  if (count > limit) {
    throw new CommitRangeError(
      "RANGE_TOO_LARGE",
      `Commit range ${range} contains ${count} commits, exceeding the bounded maximum of ${limit}. Pass a smaller explicit range or raise the limit deliberately.`,
      { base: resolvedBase.sha, head: resolvedHead.sha, count, maxCommits: limit },
    );
  }
  const commitsResult = runGit(root, ["rev-list", "--reverse", "--topo-order", range], { allowFailure: true });
  if (commitsResult.status !== 0) {
    throw new CommitRangeError(
      "RANGE_UNAVAILABLE",
      `Unable to list commits for ${range}: ${commitsResult.stderr || "unknown git error"}`,
      { base: resolvedBase.sha, head: resolvedHead.sha },
    );
  }
  const commits = commitsResult.stdout ? commitsResult.stdout.split(/\r?\n/).filter(Boolean) : [];
  if (commits.length !== count) {
    throw new CommitRangeError(
      "RANGE_UNAVAILABLE",
      `Git returned an inconsistent commit range count (${count} expected, ${commits.length} listed).`,
      { base: resolvedBase.sha, head: resolvedHead.sha },
    );
  }
  return {
    repoRoot: root,
    base: resolvedBase.sha,
    head: resolvedHead.sha,
    commits,
    count,
    maxCommits: limit,
    eventPath: eventFile ?? null,
  };
}

function linkExistingDependencies(repoRoot, worktreeRoot) {
  const packageRoots = [
    ".",
    "apps/app",
    "apps/server",
    "apps/desktop",
    "apps/orchestrator",
    "packages/types",
    "packages/ui",
    "packages/handsfree",
    "packages/onmyagent-ui-mcp",
  ];
  for (const packageRoot of packageRoots) {
    const source = join(repoRoot, packageRoot, "node_modules");
    const target = join(worktreeRoot, packageRoot, "node_modules");
    if (!existsSync(source) || existsSync(target)) continue;
    const parent = dirname(target);
    if (!existsSync(parent)) continue;
    try {
      symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Dependencies are an optimization. A normal checkout may still have
      // its own install, and the type command will report an actionable error.
    }
  }
}

function createWorktreeManager(repoRoot) {
  const root = mkdtempSync(join(tmpdir(), "onmyagent-type-gate-"));
  const paths = [];
  return {
    root,
    add(commit, index) {
      const worktreePath = join(root, `${String(index).padStart(3, "0")}-${commit.slice(0, 12)}`);
      const result = runGit(repoRoot, ["worktree", "add", "--detach", "--quiet", worktreePath, commit], { allowFailure: true });
      if (result.status !== 0) {
        throw new TypeCheckGateError(
          "WORKTREE_CREATE_FAILED",
          `Unable to create an isolated worktree for ${commit}: ${result.stderr || "unknown git error"}`,
          { commit, worktreePath },
        );
      }
      linkExistingDependencies(repoRoot, worktreePath);
      paths.push(worktreePath);
      return worktreePath;
    },
    cleanup() {
      for (const worktreePath of [...paths].reverse()) {
        runGit(repoRoot, ["worktree", "remove", "--force", worktreePath], { allowFailure: true });
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runPnpmTypeCheck({ cwd, env = process.env, command = "pnpm", args = ["task", "check", "types"] }) {
  const resolved = resolveCommand(command);
  const result = spawnSync(resolved, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved),
  });
  if (result.error) {
    throw new TypeCheckGateError("TYPE_CHECK_SPAWN_FAILED", `Unable to run ${command}: ${result.error.message}`, { cwd, command, args });
  }
  return { status: result.status ?? 1, signal: result.signal ?? null };
}

/**
 * Run the required type command once per commit in detached worktrees.
 * `runCheck` is injectable so tests can exercise the isolation contract
 * without pretending a fixture repository has the monorepo dependencies.
 */
export function runTypeChecksForCommits({
  repoRoot = DEFAULT_REPO_ROOT,
  commits,
  maxCommits = DEFAULT_MAX_COMMITS,
  runCheck = runPnpmTypeCheck,
  command = "pnpm",
  args = ["task", "check", "types"],
  env = process.env,
} = {}) {
  const root = resolve(repoRoot);
  if (!Array.isArray(commits) || commits.some((commit) => typeof commit !== "string" || !commit.trim())) {
    throw new TypeCheckGateError("COMMITS_INVALID", "commits must be a non-empty-or-empty array of commit SHAs");
  }
  if (commits.length > maxCommits) {
    throw new TypeCheckGateError("RANGE_TOO_LARGE", `Refusing to check ${commits.length} commits; maximum is ${maxCommits}`, { maxCommits });
  }
  const manager = createWorktreeManager(root);
  const checked = [];
  try {
    for (const [index, commit] of commits.entries()) {
      const worktree = manager.add(commit, index + 1);
      let result;
      try {
        result = runCheck({ cwd: worktree, commit, index, command, args, env });
      } catch (error) {
        if (error instanceof TypeCheckGateError) throw error;
        throw new TypeCheckGateError("TYPE_CHECK_FAILED", `Type check threw for ${commit}: ${error instanceof Error ? error.message : String(error)}`, { commit, worktree });
      }
      const status = typeof result === "number" ? result : result?.status ?? 1;
      if (status !== 0) {
        throw new TypeCheckGateError(
          "TYPE_CHECK_FAILED",
          `pnpm task check types failed for ${commit} (exit ${status})`,
          { commit, worktree, status, signal: result?.signal ?? null },
        );
      }
      checked.push(commit);
      console.log(`✓ type check passed: ${commit}`);
    }
  } finally {
    manager.cleanup();
  }
  return { checked, count: checked.length };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--base" || arg === "--head" || arg === "--max-commits" || arg === "--repo" || arg === "--event" || arg === "--event-path") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CommitRangeError("ARGUMENT_INVALID", `${arg} requires a value`);
      index += 1;
      if (arg === "--base") options.base = value;
      else if (arg === "--head") options.head = value;
      else if (arg === "--max-commits") options.maxCommits = value;
      else if (arg === "--repo") options.repoRoot = value;
      else options.eventPath = value;
      continue;
    }
    throw new CommitRangeError("ARGUMENT_INVALID", `Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/checks/check-commit-types.mjs [options]

Checks every commit in a local push/PR range with an isolated worktree.
Options:
  --base <sha|ref>       Existing base commit/ref (or TYPE_GATE_BASE)
  --head <sha|ref>       Existing head commit/ref (or TYPE_GATE_HEAD)
  --max-commits <n>      Bounded range maximum (default ${DEFAULT_MAX_COMMITS})
  --repo <path>          Repository root (default current project)
  --event <path>         GitHub event JSON path (default GITHUB_EVENT_PATH)

No fetch, checkout, reset, or mutation of the current worktree is performed.`);
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return 0;
  }
  const range = resolveCommitRange({ ...options, env });
  console.log(`Checking ${range.count} commit(s): ${range.base}..${range.head} (max ${range.maxCommits})`);
  runTypeChecksForCommits({ repoRoot: range.repoRoot, commits: range.commits, maxCommits: range.maxCommits, env });
  console.log(`Per-commit type gate passed (${range.count} commit(s)).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    const code = error?.code ?? "TYPE_GATE_FAILED";
    console.error(`[per-commit-type-gate:${code}] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
