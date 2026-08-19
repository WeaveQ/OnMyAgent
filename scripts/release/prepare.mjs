#!/usr/bin/env node
/**
 * release:prepare [patch|minor|major] [--set X.Y.Z] [--base LINE]
 *
 * Bumps workspace versions on the current line, commits, tags locally,
 * and opens a PR into that line. Does not push the tag.
 *
 * Flags:
 *   --dry-run   Print what would happen without mutating anything.
 *   --ci        Skip dirty-tree / fast-forward checks.
 *   --no-push   Commit and tag locally only.
 *   --no-pr     Push the topic branch but do not open a PR.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertVersionMatchesLine,
  bumpBranchName,
  githubRepoFromRemote,
  isProtectedLine,
  nextSemver,
  parsePrepareArgs,
  parseRemoteLineNames,
  releasePrBody,
  REMOTE_LINE_FOR_EACH_REF,
  resolveReleaseBase,
} from "./policy.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const log = (msg) => console.log(`  ${msg}`);
const heading = (msg) => console.log(`\n▸ ${msg}`);
const success = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
};

const isMainModule = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
};

export function readAppVersion() {
  const appPkg = JSON.parse(
    readFileSync(resolve(root, "apps/app/package.json"), "utf8"),
  );
  return appPkg.version;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parsePrepareArgs(argv);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const dryRun = options.dryRun;
  const ci = options.ci;

  const run = (cmd, opts = {}) => {
    if (dryRun && !opts.readOnly) {
      log(`[dry-run] ${cmd}`);
      return "";
    }
    try {
      return execSync(cmd, {
        cwd: root,
        encoding: "utf8",
        stdio: opts.stdio ?? "pipe",
        input: opts.input,
      }).trim();
    } catch (err) {
      if (opts.allowFail) return "";
      fail(`Command failed: ${cmd}\n${err.stderr || err.message}`);
    }
  };

  heading("Checking git state");

  const branch = run("git rev-parse --abbrev-ref HEAD", { readOnly: true });
  success(`On branch ${branch}`);

  const dirty = run("git status --porcelain", { readOnly: true });
  if (dirty && !ci) fail(`Working tree is dirty:\n${dirty}`);
  if (dirty) log("Working tree dirty (--ci, continuing)");
  else success("Working tree clean");

  heading("Resolving release line");
  run("git fetch origin", { readOnly: true });

  const remoteLines = parseRemoteLineNames(
    run(REMOTE_LINE_FOR_EACH_REF, { readOnly: true }),
  );

  const lines = remoteLines.map((name) => {
    const behind = run(`git rev-list --count HEAD..origin/${name}`, {
      readOnly: true,
      allowFail: true,
    });
    return { name, behind: Number(behind || "0") };
  });

  let resolved;
  try {
    resolved = resolveReleaseBase({
      currentBranch: branch,
      explicitBase: options.base,
      lines,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const { base, checkoutBumpBranch } = resolved;
  success(`Target line: ${base}`);

  if (!ci) {
    const behind = run(`git rev-list --count HEAD..origin/${base}`, {
      readOnly: true,
      allowFail: true,
    });
    if (behind && behind !== "0") {
      if (isProtectedLine(branch) && branch === base) {
        log(`Behind origin/${base} by ${behind} commits — pulling…`);
        run(`git pull --ff-only origin ${base}`);
      } else {
        fail(
          `Branch is behind origin/${base} by ${behind} commits. Rebase onto origin/${base} first.`,
        );
      }
    }
    success(`Up to date with origin/${base}`);
  }

  const currentVersion = readAppVersion();
  const version =
    options.setVersion ?? nextSemver(currentVersion, options.bumpType);
  try {
    assertVersionMatchesLine(base, version);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const tag = `v${version}`;
  const topic = checkoutBumpBranch ? bumpBranchName(version) : branch;

  const localTag = run(`git rev-parse -q --verify refs/tags/${tag}`, {
    readOnly: true,
    allowFail: true,
  });
  if (localTag) fail(`Local tag ${tag} already exists`);
  const remoteTag = run(`git ls-remote --tags origin refs/tags/${tag}`, {
    readOnly: true,
    allowFail: true,
  });
  if (remoteTag) fail(`Remote tag ${tag} already exists`);

  if (checkoutBumpBranch) {
    const topicExists = run(
      `git rev-parse --verify --quiet refs/heads/${topic}`,
      { readOnly: true, allowFail: true },
    );
    const remoteTopic = run(`git ls-remote --heads origin ${topic}`, {
      readOnly: true,
      allowFail: true,
    });
    if (topicExists) fail(`Branch ${topic} already exists locally`);
    if (remoteTopic) fail(`Branch ${topic} already exists on origin`);
  }

  heading(`Bumping versions (${options.setVersion ? `--set ${version}` : options.bumpType})`);
  if (checkoutBumpBranch) {
    run(`git switch -c ${topic}`);
    success(`Created branch ${topic}`);
  }

  const bumpOutput = run(
    `pnpm --filter @onmyagent/app bump:set -- ${version}`,
    { stdio: "pipe" },
  );
  if (!dryRun) log(bumpOutput);
  success(`Version is now ${version}`);

  heading("Checking lockfile");
  run("pnpm install --lockfile-only");
  const lockfileChanged = run("git diff --name-only -- pnpm-lock.yaml", {
    readOnly: true,
  });
  if (lockfileChanged) success("Lockfile updated");
  else success("Lockfile unchanged");

  heading("Running release review");
  const reviewOutput = run("node scripts/release/review.mjs --strict", {
    readOnly: true,
  });
  log(reviewOutput);
  success("Release review passed");

  heading("Committing version bump");
  run(
    "git add package.json apps/app/package.json apps/desktop/package.json apps/server/package.json apps/orchestrator/package.json pnpm-lock.yaml",
  );
  run(`git commit -m "chore: bump version to ${version}"`);
  success(`Committed: chore: bump version to ${version}`);

  heading("Creating tag");
  run(`git tag -a ${tag} -m "OnMyAgent ${tag}"`);
  success(`Tagged ${tag}`);

  const remoteUrl = run("git remote get-url origin", {
    readOnly: true,
    allowFail: true,
  });
  const repo = githubRepoFromRemote(remoteUrl) ?? "WeaveQ/OnMyAgent";

  if (!options.noPush) {
    heading("Pushing topic branch");
    run(`git push -u origin HEAD`);
    success(`Pushed ${topic}`);

    if (!options.noPr) {
      heading("Opening pull request");
      const existing = run(
        `gh pr list --repo ${repo} --head ${topic} --base ${base} --json url --jq '.[0].url'`,
        { readOnly: true, allowFail: true },
      );
      if (existing) {
        success(`PR already open: ${existing}`);
      } else {
        const created = run(
          `gh pr create --repo ${repo} --base ${base} --head ${topic} --title "chore: bump version to ${version}" --body-file -`,
          { allowFail: true, input: releasePrBody({ version, base, tag }) },
        );
        if (created) success(`Opened ${created}`);
        else {
          log(
            `Open: https://github.com/${repo}/compare/${base}...${topic}?expand=1`,
          );
        }
      }
    }
  }

  console.log("\n" + "─".repeat(50));
  console.log(`  Release prepared: ${tag}`);
  console.log(`  Version:          ${version}`);
  console.log(`  Line:             ${base}`);
  console.log(`  Branch:           ${topic}`);
  if (dryRun) {
    console.log("  Mode:             DRY RUN (nothing was changed)");
  }
  console.log("");
  console.log("  Next step:");
  console.log("    Merge the bump PR (merge commit, not squash)");
  console.log("    pnpm release:ship");
  console.log("─".repeat(50) + "\n");
}

if (isMainModule()) {
  main();
}
