const SEMVER = /^\d+\.\d+\.\d+$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

export const REMOTE_LINE_FOR_EACH_REF =
  "git for-each-ref --format='%(refname:short)' refs/remotes/origin/dev refs/remotes/origin/main 'refs/remotes/origin/release/*'";

export function isProtectedLine(branch) {
  return branch === "dev" || branch === "main" || branch.startsWith("release/");
}

export function parseRemoteLineNames(stdout) {
  return String(stdout ?? "")
    .split("\n")
    .map((name) => name.trim().replace(/^origin\//, ""))
    .filter((name) => name && isProtectedLine(name));
}

export function nextSemver(current, bumpType) {
  if (!SEMVER.test(current)) {
    throw new Error(`Invalid version: ${current}`);
  }
  const [major, minor, patch] = current.split(".").map(Number);
  if (bumpType === "major") return `${major + 1}.0.0`;
  if (bumpType === "minor") return `${major}.${minor + 1}.0`;
  if (bumpType === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump type: ${bumpType}`);
}

export function assertVersionMatchesLine(base, version) {
  const match = /^release\/(\d+\.\d+)$/.exec(base);
  if (!match) return;
  const prefix = match[1];
  if (!version.startsWith(`${prefix}.`)) {
    throw new Error(
      `Line ${base} must stay on ${prefix}.x (got ${version})`,
    );
  }
}

export function resolveReleaseBase({
  currentBranch,
  explicitBase = null,
  lines = [],
}) {
  if (explicitBase) {
    if (!isProtectedLine(explicitBase)) {
      throw new Error(
        `--base must be dev, main, or release/* (got '${explicitBase}')`,
      );
    }
    if (
      isProtectedLine(currentBranch) &&
      currentBranch !== explicitBase
    ) {
      throw new Error(
        `On '${currentBranch}' but --base is '${explicitBase}'. Switch to ${explicitBase} first.`,
      );
    }
    return {
      base: explicitBase,
      checkoutBumpBranch: isProtectedLine(currentBranch),
    };
  }

  if (isProtectedLine(currentBranch)) {
    return { base: currentBranch, checkoutBumpBranch: true };
  }

  const basedOn = lines.filter(
    (line) => line.behind === 0 && isProtectedLine(line.name),
  );
  if (basedOn.length === 0) {
    throw new Error(
      "Current branch is not based on origin/dev, origin/main, or origin/release/*. Pass --base.",
    );
  }

  const releases = basedOn.filter((line) => line.name.startsWith("release/"));
  if (releases.length === 1) {
    return { base: releases[0].name, checkoutBumpBranch: false };
  }
  if (releases.length > 1) {
    throw new Error("Ambiguous release/* ancestors. Pass --base.");
  }
  if (basedOn.some((line) => line.name === "dev")) {
    return { base: "dev", checkoutBumpBranch: false };
  }
  return { base: basedOn[0].name, checkoutBumpBranch: false };
}

export function githubRepoFromRemote(url) {
  const trimmed = String(url ?? "")
    .trim()
    .replace(/\.git$/, "");
  const match = trimmed.match(/github\.com[:/](.+)$/i);
  return match ? match[1] : null;
}

export function isReleaseTag(tag) {
  return RELEASE_TAG.test(String(tag ?? "").trim());
}

export function parsePrepareArgs(argv) {
  const result = {
    dryRun: false,
    ci: false,
    noPr: false,
    noPush: false,
    bumpType: "patch",
    setVersion: null,
    base: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--ci") {
      result.ci = true;
      continue;
    }
    if (arg === "--no-pr") {
      result.noPr = true;
      continue;
    }
    if (arg === "--no-push") {
      result.noPush = true;
      result.noPr = true;
      continue;
    }
    if (arg === "--set") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--set requires a version like 0.5.23");
      }
      if (!SEMVER.test(value)) {
        throw new Error(`Invalid --set version: ${value}`);
      }
      result.setVersion = value;
      result.bumpType = "set";
      i += 1;
      continue;
    }
    if (arg === "--base") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--base requires a branch name");
      }
      result.base = value;
      i += 1;
      continue;
    }
    if (arg === "patch" || arg === "minor" || arg === "major") {
      if (result.setVersion) {
        throw new Error("Use either --set X.Y.Z or patch|minor|major, not both");
      }
      result.bumpType = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

export function parseShipArgs(argv) {
  const result = {
    dryRun: false,
    watch: false,
    tag: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--watch") {
      result.watch = true;
      continue;
    }
    if (arg === "--tag") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--tag requires a tag like v1.0.1");
      }
      result.tag = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

export function bumpBranchName(version) {
  return `chore/bump-${version}`;
}

export function releasePrBody({ version, base, tag }) {
  return [
    `Bump workspace versions to ${version} on \`${base}\`.`,
    "",
    "Merge with a **merge commit** (do not squash) so the local tag still points at the version commit.",
    "",
    `After merge: \`pnpm release:ship\` (pushes \`${tag}\` only).`,
    "",
  ].join("\n");
}
