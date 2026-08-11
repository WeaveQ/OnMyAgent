#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "../..");

const LEGACY_RENDERER_SYMBOLS = [
  { name: "deleteSessionOrigin", pattern: /\bdeleteSessionOrigin\s*\(/ },
  { name: "uninstallExpertPackage", pattern: /\buninstallExpertPackage\s*\(/ },
  { name: "preserveExpertSessions", pattern: /\bpreserveExpertSessions\b/ },
  { name: "expertSessionIds membership key", pattern: /onmyagent:expertSessionIds|expertSessionIds/ },
  { name: "expert-origin-reconciliation", pattern: /expert-origin-reconciliation|reconcileExpertSessionOrigins/ },
  { name: "infer-expert-agent-id", pattern: /infer-expert-agent-id|inferExpertAgentId/ },
  { name: "Expert origin event bus", pattern: /expertSessionOrigin(?:Changed|Change|Event)|expert-origin-(?:change|event)-bus/ },
];

const REMOVED_RENDERER_PATHS = [
  "apps/app/src/react-app/domains/agents/infer-expert-agent-id.ts",
  "apps/app/src/react-app/domains/agents/session-origin-hydration.ts",
  "apps/app/src/react-app/domains/agents/session-origin-reconciliation.ts",
  "apps/app/src/react-app/domains/session/pages/expert-origin-hydration.ts",
  "apps/app/src/react-app/domains/session/pages/expert-origin-recovery-notice.tsx",
  "apps/app/src/react-app/domains/session/sync/expert-session-directory.ts",
];

const EXPERT_INVENTORY_CONSUMER_ROOTS = [
  {
    path: "apps/app/src/react-app/capabilities/session-identity",
    reason: "Expert Directory identity/query/cache consumers",
  },
  {
    path: "apps/app/src/react-app/shell/session-route",
    reason: "session-route aggregate loading and Expert session consumers",
  },
  {
    path: "apps/app/src/react-app/domains/session/pages",
    reason: "Expert/session page consumers of the authoritative directory",
  },
];

const CUSTOM_AGENT_IDENTITY_OWNER_PATHS = new Set([
  "apps/app/src/react-app/domains/agents/agent-registry-store.ts",
  "apps/app/src/react-app/domains/agents/index.ts",
]);

function sourceFiles(root) {
  const output = [];
  if (!existsSync(root)) return output;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "graphify-out") continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.(?:[cm]?js|tsx?)$/.test(entry.name)) continue;
      if (/\.test\.(?:[cm]?js|tsx?)$/.test(entry.name)) continue;
      output.push(fullPath);
    }
  };
  walk(root);
  return output.sort();
}

function readSources(repoRoot) {
  const appRoot = join(repoRoot, "apps/app/src/react-app");
  const serverRoot = join(repoRoot, "apps/server/src");
  const files = [...sourceFiles(appRoot), ...sourceFiles(serverRoot)];
  return files.map((path) => {
    try {
      return { path, relativePath: relative(repoRoot, path), text: readFileSync(path, "utf8") };
    } catch (error) {
      return { path, relativePath: relative(repoRoot, path), text: "", readError: error };
    }
  });
}

function addFailure(failures, code, message, details = {}) {
  failures.push({ code, message, details });
}

function readJsonFile(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function expertManifestMetadata(value) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const strings = (field) => Array.isArray(record[field])
    ? record[field].filter((item) => typeof item === "string")
    : [];
  return {
    skills: strings("skills"),
    introStyle: typeof record.introStyle === "string" ? record.introStyle : "default",
    approvedAgentIds: strings("approvedAgentIds"),
  };
}

function evaluateManifestMetadataParity(repoRoot, failures, checks) {
  const pluginsRoot = join(repoRoot, "apps/desktop/resources/marketplace/experts/plugins");
  const generatedPath = join(
    repoRoot,
    "apps/app/src/react-app/domains/plugins/expert-marketplace/builtin-experts.manifest.json",
  );
  if (!existsSync(pluginsRoot) || !existsSync(generatedPath)) {
    checks.push({ name: "Expert manifest metadata parity", ok: true, skipped: true });
    return;
  }
  const generated = readJsonFile(generatedPath);
  const generatedByPackage = new Map(
    (Array.isArray(generated?.experts) ? generated.experts : [])
      .filter((entry) => entry && typeof entry === "object" && typeof entry.packageName === "string")
      .map((entry) => [entry.packageName, expertManifestMetadata(entry.manifest)]),
  );
  let mismatches = 0;
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = join(pluginsRoot, entry.name);
    const source = readJsonFile(join(packageRoot, ".expert-plugin/plugin.json"));
    if (!source) continue;
    const sourceMetadata = expertManifestMetadata(source);
    const generatedMetadata = generatedByPackage.get(entry.name);
    const runtimePath = join(packageRoot, ".onmyagent-plugin/plugin.json");
    const runtime = existsSync(runtimePath) ? readJsonFile(runtimePath) : null;
    const generatedMatches = generatedMetadata &&
      JSON.stringify(generatedMetadata) === JSON.stringify(sourceMetadata);
    const runtimeMatches = !runtime ||
      JSON.stringify(expertManifestMetadata(runtime)) === JSON.stringify(sourceMetadata);
    if (generatedMatches && runtimeMatches) continue;
    mismatches += 1;
    addFailure(
      failures,
      "expert-manifest-metadata-drift",
      `${entry.name} skills/introStyle/approvedAgentIds drift across source, runtime, or generated manifest.`,
      { packageName: entry.name, generatedMatches: Boolean(generatedMatches), runtimeMatches },
    );
  }
  checks.push({ name: "Expert manifest metadata parity", ok: mismatches === 0, mismatches });
}

function evaluateLegacyResidue(repoRoot, sources, failures, checks) {
  let hits = 0;
  for (const relativePath of REMOVED_RENDERER_PATHS) {
    const fullPath = join(repoRoot, relativePath);
    if (existsSync(fullPath)) {
      addFailure(failures, "legacy-path-present", `${relativePath} must be removed from the renderer source tree.`);
      hits += 1;
    }
  }
  const appSources = sources.filter((source) => source.relativePath.startsWith("apps/app/src/react-app/") && !source.readError);
  for (const source of appSources) {
    for (const symbol of LEGACY_RENDERER_SYMBOLS) {
      if (!symbol.pattern.test(source.text)) continue;
      addFailure(failures, "legacy-renderer-symbol", `${symbol.name} remains in ${source.relativePath}.`, { path: source.relativePath, symbol: symbol.name });
      hits += 1;
    }
  }
  checks.push({ name: "no legacy Expert renderer recovery/delete/event-bus symbols", ok: hits === 0, hits });
}

function evaluateCacheWriter(repoRoot, sources, failures, checks) {
  const cacheOwner = "apps/app/src/react-app/capabilities/session-identity/expert-directory-cache.ts";
  const queryOwner = "apps/app/src/react-app/capabilities/session-identity/expert-directory-query.ts";
  const cacheSource = sources.find((source) => source.relativePath === cacheOwner);
  const writerSources = sources.filter((source) => /\bwriteExpertDirectoryCache\s*\(/.test(source.text));
  const definitions = cacheSource?.text.match(/export\s+function\s+writeExpertDirectoryCache\s*\(/g)?.length ?? 0;
  const writerPaths = writerSources.map((source) => source.relativePath);
  const expectedPaths = [cacheOwner, queryOwner];
  const pathsMatch = writerPaths.length === expectedPaths.length && expectedPaths.every((path) => writerPaths.includes(path));
  const ok = definitions === 1 && pathsMatch;
  if (!ok) {
    addFailure(
      failures,
      "expert-directory-cache-writer-count",
      `Expert Directory cache must have one writer definition and one query call; found definition=${definitions}, files=${writerPaths.join(", ") || "none"}.`,
      { cacheOwner, queryOwner, writerPaths },
    );
  }
  checks.push({ name: "one Expert Directory cache writer", ok, definitions, writerPaths });
}

function isExpertInventoryConsumer(relativePath) {
  return EXPERT_INVENTORY_CONSUMER_ROOTS.some(({ path }) =>
    relativePath === path || relativePath.startsWith(`${path}/`),
  );
}

function evaluateNo404DeletionInference(sources, failures, checks) {
  const inferencePattern = /(?:status|code)\s*(?:===?|!==?)\s*404|session_not_found|HTTP\s*404/i;
  const hits = sources.filter(
    (source) => isExpertInventoryConsumer(source.relativePath) && inferencePattern.test(source.text),
  );
  for (const source of hits) {
    addFailure(
      failures,
      "expert-404-deletion-inference",
      `${source.relativePath} must not infer Expert/session deletion from HTTP 404 or session_not_found.`,
      { path: source.relativePath },
    );
  }
  checks.push({
    name: "no 404-derived Expert/session deletion",
    ok: hits.length === 0,
    hits: hits.map((source) => source.relativePath),
    consumerRoots: EXPERT_INVENTORY_CONSUMER_ROOTS,
  });
}

function evaluateNoRenderIdentityReads(sources, failures, checks) {
  const identityReadPattern = /\b(?:readCustomAgentIdForSession|readCustomAgentSessionEntries|inferExpertAgentId|recoverOriginDirectory)\s*\(/;
  const hits = sources.filter(
    (source) =>
      source.relativePath.startsWith("apps/app/src/react-app/") &&
      !CUSTOM_AGENT_IDENTITY_OWNER_PATHS.has(source.relativePath) &&
      identityReadPattern.test(source.text),
  );
  for (const source of hits) {
    addFailure(
      failures,
      "renderer-sync-expert-identity-read",
      `${source.relativePath} performs a synchronous renderer-owned Expert identity read.`,
      { path: source.relativePath },
    );
  }
  checks.push({
    name: "no synchronous Expert identity reads in renderer consumers",
    ok: hits.length === 0,
    hits: hits.map((source) => source.relativePath),
  });
}

function evaluateExpertStorageOwnership(sources, failures, checks) {
  const cacheOwner = "apps/app/src/react-app/capabilities/session-identity/expert-directory-cache.ts";
  const legacyMembershipPattern = /onmyagent:expertSessionIds/;
  const directoryCacheKeyPattern = /onmyagent:expert-directory:/;
  const legacyHits = sources.filter((source) => legacyMembershipPattern.test(source.text));
  const directoryKeyHits = sources.filter((source) => directoryCacheKeyPattern.test(source.text));
  const wrongDirectoryOwners = directoryKeyHits.filter((source) => source.relativePath !== cacheOwner);
  for (const source of [...legacyHits, ...wrongDirectoryOwners]) {
    addFailure(
      failures,
      "expert-storage-owner",
      `${source.relativePath} owns a forbidden or duplicate Expert identity/cache storage key.`,
      { path: source.relativePath },
    );
  }
  const ok = legacyHits.length === 0 && directoryKeyHits.length === 1 && wrongDirectoryOwners.length === 0;
  if (directoryKeyHits.length !== 1) {
    addFailure(
      failures,
      "expert-storage-owner",
      `Expert Directory cache key must have exactly one owner; found ${directoryKeyHits.length}.`,
      { owners: directoryKeyHits.map((source) => source.relativePath) },
    );
  }
  checks.push({
    name: "one Expert identity/cache storage owner",
    ok,
    legacyHits: legacyHits.map((source) => source.relativePath),
    directoryKeyOwners: directoryKeyHits.map((source) => source.relativePath),
  });
}

function evaluateAggregateWorkspaceList(repoRoot, sources, failures, checks) {
  const required = [
    ["apps/server/src/services/workspace-sessions.ts", /export\s+async\s+function\s+aggregateWorkspaceSessionLists\s*\(/],
    ["apps/server/src/routes/workspace-session-routes.ts", /scope\s*===\s*["']workspace["']|parseOptionalSessionScope/],
    ["apps/app/src/react-app/shell/session-route/sessions.ts", /listSessions\s*\(|scope\s*:\s*["']workspace["']/],
  ];
  let missing = 0;
  for (const [relativePath, pattern] of required) {
    const source = sources.find((entry) => entry.relativePath === relativePath);
    if (!source || !pattern.test(source.text)) {
      addFailure(failures, "workspace-aggregate-missing", `${relativePath} must expose the canonical workspace aggregate contract.`);
      missing += 1;
    }
  }
  const loader = sources.find((entry) => entry.relativePath === required[2][0]);
  const workspaceScopes = loader?.text.match(/scope\s*:\s*["']workspace["']/g)?.length ?? 0;
  if (workspaceScopes !== 1) {
    addFailure(failures, "workspace-aggregate-call-count", `Expert/session refresh must issue exactly one scope: "workspace" request; found ${workspaceScopes}.`);
    missing += 1;
  }
  checks.push({ name: "one aggregate workspace session list", ok: missing === 0, missing, workspaceScopes });
}

function evaluateOptionalPromptContract(sources, failures, checks) {
  const contractHookPattern = /\b(?:assertExpertRuntimeContract|ensureAndAssertExpertRuntimeContract)\b/;
  const contractCallPattern = /\b(?:assertExpertRuntimeContract|ensureAndAssertExpertRuntimeContract)\s*\(/;
  const p9Sources = sources.filter((source) => contractHookPattern.test(source.text));
  if (p9Sources.length === 0) {
    checks.push({ name: "prompt proxy contract hook (when P9 exists)", ok: true, skipped: true, reason: "assertExpertRuntimeContract is not present; P9 remains outside this gate." });
    return;
  }
  const promptSources = sources.filter((source) => /prompt_async/.test(source.text));
  const callSources = p9Sources.filter((source) => !/function\s+(?:assertExpertRuntimeContract|ensureAndAssertExpertRuntimeContract)\s*\(/.test(source.text) && contractCallPattern.test(source.text));
  const promptCoverage = promptSources.some((source) => contractCallPattern.test(source.text));
  const normalizedMountCoverage = promptSources.some((source) => /normalizeOpencodeProxyPath|isExpertPromptProxyRequest/.test(source.text));
  const ok = promptSources.length > 0 && callSources.length > 0 && promptCoverage && normalizedMountCoverage;
  if (!ok) {
    addFailure(failures, "prompt-contract-uncovered", "P9 assertExpertRuntimeContract exists but no prompt_async proxy call is statically covered by it.");
  }
  checks.push({ name: "prompt proxy contract hook (when P9 exists)", ok, skipped: false, promptSources: promptSources.map((source) => source.relativePath), callSources: callSources.map((source) => source.relativePath) });
}

/**
 * Evaluate source contracts from a single read snapshot. The checker does not
 * watch files or run concurrently with edits; this makes a CI invocation a
 * deterministic point-in-time contract check.
 */
export function evaluateExpertArchitectureContracts(repoRoot = DEFAULT_REPO_ROOT) {
  const root = resolve(repoRoot);
  const failures = [];
  const checks = [];
  const sources = readSources(root);
  const readErrors = sources.filter((source) => source.readError);
  for (const source of readErrors) {
    addFailure(failures, "source-read-failed", `Unable to read ${source.relativePath} while evaluating architecture contracts.`);
  }
  evaluateLegacyResidue(root, sources, failures, checks);
  evaluateCacheWriter(root, sources, failures, checks);
  evaluateNo404DeletionInference(sources, failures, checks);
  evaluateNoRenderIdentityReads(sources, failures, checks);
  evaluateExpertStorageOwnership(sources, failures, checks);
  evaluateAggregateWorkspaceList(root, sources, failures, checks);
  evaluateOptionalPromptContract(sources, failures, checks);
  evaluateManifestMetadataParity(root, failures, checks);
  return { ok: failures.length === 0, failures, checks };
}

export function main(repoRoot = process.argv[2] ?? DEFAULT_REPO_ROOT) {
  const result = evaluateExpertArchitectureContracts(repoRoot);
  for (const check of result.checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}${check.skipped ? " (skipped: P9 symbol absent)" : ""}`);
  }
  if (!result.ok) {
    for (const failure of result.failures) console.error(`[${failure.code}] ${failure.message}`);
    return 1;
  }
  console.log("Expert architecture contract check passed.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
