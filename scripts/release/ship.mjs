#!/usr/bin/env node
/**
 * release:ship
 *
 * Pushes the local version tag after the bump PR has landed on
 * origin/dev, origin/main, or origin/release/*. Does not push any branch.
 *
 * Flags:
 *   --dry-run   Print what would happen without pushing.
 *   --watch     Tail the GHA workflow run after push.
 *   --tag vX.Y.Z
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  githubRepoFromRemote,
  isReleaseTag,
  parseRemoteLineNames,
  parseShipArgs,
  REMOTE_LINE_FOR_EACH_REF,
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

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseShipArgs(argv);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const dryRun = options.dryRun;
  const watch = options.watch;

  const run = (cmd, opts = {}) => {
    if (dryRun && !opts.readOnly) {
      log(`[dry-run] ${cmd}`);
      return "";
    }
    try {
      return execSync(cmd, {
        cwd: root,
        encoding: "utf8",
        stdio: opts.inherit ? "inherit" : "pipe",
      }).trim();
    } catch (err) {
      if (opts.allowFail) return "";
      fail(`Command failed: ${cmd}\n${err.stderr || err.message}`);
    }
  };

  heading("Resolving tag");

  const tag =
    options.tag ||
    run("git describe --tags --exact-match HEAD", {
      readOnly: true,
      allowFail: true,
    });

  if (!tag) {
    fail(
      "HEAD is not tagged. Run 'pnpm release:prepare' first, merge the bump PR, then ship.\n" +
        "  (Expected a vX.Y.Z tag on HEAD, or pass --tag)",
    );
  }

  if (!isReleaseTag(tag)) {
    fail(`Tag '${tag}' does not look like a release tag (expected vX.Y.Z)`);
  }

  success(`Found tag: ${tag}`);

  heading("Checking tag is on a release line");
  run("git fetch origin --tags", { readOnly: true });

  const remoteLines = parseRemoteLineNames(
    run(REMOTE_LINE_FOR_EACH_REF, { readOnly: true }),
  );

  const onLines = remoteLines.filter((name) => {
    try {
      execSync(`git merge-base --is-ancestor ${tag}^{} origin/${name}`, {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  });

  if (onLines.length === 0) {
    fail(
      `${tag} is not on origin/dev, origin/main, or origin/release/*.\n` +
        "  Merge the bump PR first (merge commit, not squash).\n" +
        "  If the PR was squashed, retag the merge commit:\n" +
        `    git fetch origin && git tag -d ${tag} && git tag -a ${tag} -m "OnMyAgent ${tag}" origin/<line>\n` +
        "    pnpm release:ship",
    );
  }
  success(`Tag is on ${onLines.map((name) => `origin/${name}`).join(", ")}`);

  const remoteTag = run(`git ls-remote --tags origin refs/tags/${tag}`, {
    readOnly: true,
    allowFail: true,
  });

  heading("Pushing tag to origin");
  if (remoteTag) {
    success(`${tag} already exists on origin`);
  } else {
    run(`git push origin ${tag}`);
    success(`Pushed ${tag}`);
  }

  heading("GitHub Actions");

  const remoteUrl = run("git remote get-url origin", {
    readOnly: true,
    allowFail: true,
  });
  const repo = githubRepoFromRemote(remoteUrl) ?? "WeaveQ/OnMyAgent";
  const url = `https://github.com/${repo}/actions/workflows/release-macos-aarch64.yml`;
  log(`Workflow: ${url}`);
  log(`Release:  https://github.com/${repo}/releases/tag/${tag}`);

  if (watch && !dryRun) {
    heading("Watching workflow run");
    log("Waiting for workflow to appear…");
    execSync("sleep 10", { cwd: root });

    try {
      const runs = run(
        `gh run list --repo ${repo} --workflow "Release App" --limit 1 --json databaseId,headBranch,event -q ".[0].databaseId"`,
        { readOnly: true },
      );
      if (runs) {
        log(`Run ID: ${runs}`);
        run(`gh run watch ${runs} --repo ${repo} --exit-status`, {
          inherit: true,
        });
      } else {
        log("Could not find the workflow run. Check the Actions tab manually.");
      }
    } catch {
      log("Workflow watch exited (check status on GitHub).");
    }
  }

  console.log("\n" + "─".repeat(50));
  console.log(`  Shipped: ${tag}`);
  if (dryRun) {
    console.log("  Mode:    DRY RUN (nothing was pushed)");
  }
  console.log("─".repeat(50) + "\n");
}

if (isMainModule()) {
  main();
}
