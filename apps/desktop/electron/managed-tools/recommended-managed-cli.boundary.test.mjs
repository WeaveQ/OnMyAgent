/**
 * Boundary / ownership contract for recommended managed CLIs (OfficeCLI + Feishu CLI).
 * Fails when mounts, IPC surface, or launcher template escapes regress — so drive-by
 * refactors elsewhere do not silently break recommended-install connectors.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { desktopCommandNames } from "../../../../packages/types/src/desktop-ipc-commands.mjs";
import { HANDLER_COMMAND_NAMES } from "../desktop-handlers/managed-tools.mjs";
import { LARK_CLI_LAUNCHER_SOURCE } from "./lark-cli-manager.mjs";
import { OFFICECLI_LAUNCHER_SOURCE } from "./officecli-manager.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const REQUIRED_IPC = Object.freeze([
  "officeCliGetStatus",
  "officeCliInstallLatest",
  "officeCliUninstall",
  "larkCliGetStatus",
  "larkCliInstallLatest",
  "larkCliUninstall",
  "larkCliGetConnectionStatus",
  "larkCliGetRecommendedScopesJson",
  "larkCliSubmitManualCredentials",
  "larkCliStartUserLogin",
  "larkCliCompleteUserLogin",
  "larkCliStartConfigInit",
  "larkCliCancelConfigInit",
  "larkCliDisconnect",
]);

/** Owned surface: files that must remain for the feature to exist. */
const REQUIRED_PATHS = Object.freeze([
  "apps/desktop/electron/managed-tools/officecli-manager.mjs",
  "apps/desktop/electron/managed-tools/lark-cli-manager.mjs",
  "apps/desktop/electron/managed-tools/lark-cli-auth.mjs",
  "apps/desktop/electron/managed-tools/lark-cli-recommended-scopes.json",
  "apps/desktop/electron/managed-tools/managed-cli-registry.json",
  "apps/desktop/electron/managed-tools/AGENTS.md",
  "apps/desktop/electron/desktop-handlers/managed-tools.mjs",
  "apps/app/src/react-app/domains/plugins/officecli-plugin.tsx",
  "apps/app/src/react-app/domains/plugins/larkcli-plugin.tsx",
  "apps/app/src/react-app/domains/plugins/larkcli-connect-modal.tsx",
  "packages/types/src/officecli.ts",
  "packages/types/src/lark-cli-auth.ts",
]);

function readRepo(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

/**
 * @param {string} moduleBaseName e.g. "officecli-plugin"
 * @returns {string[]}
 */
function findImporters(moduleBaseName) {
  /** @type {string[]} */
  const importers = [];
  /**
   * @param {string} dir
   */
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name === "node_modules" ||
          ent.name === "dist" ||
          ent.name === ".turbo"
        ) {
          continue;
        }
        walk(full);
      } else if (/\.(tsx|ts|mjs|jsx|js)$/.test(ent.name)) {
        const text = readFileSync(full, "utf8");
        const hit =
          text.includes(`/${moduleBaseName}"`) ||
          text.includes(`/${moduleBaseName}'`) ||
          text.includes(`./${moduleBaseName}"`) ||
          text.includes(`./${moduleBaseName}'`) ||
          text.includes(`./${moduleBaseName}.tsx"`) ||
          text.includes(`./${moduleBaseName}.tsx'`);
        if (hit) {
          importers.push(path.relative(repoRoot, full).replaceAll("\\", "/"));
        }
      }
    }
  }
  walk(path.join(repoRoot, "apps/app/src"));
  return importers.sort();
}

test("owned recommended-managed-cli paths still exist", () => {
  for (const rel of REQUIRED_PATHS) {
    assert.equal(
      existsSync(path.join(repoRoot, rel)),
      true,
      `missing owned path: ${rel}`,
    );
  }
});

test("recommended managed CLI IPC commands stay declared and handled", () => {
  const declared = new Set(desktopCommandNames);
  const handled = new Set(HANDLER_COMMAND_NAMES);
  for (const name of REQUIRED_IPC) {
    assert.equal(declared.has(name), true, `desktopCommandNames missing ${name}`);
    assert.equal(handled.has(name), true, `managed-tools handlers missing ${name}`);
  }
});

test("launcher templates keep real digit escapes (not literal d.d.d)", () => {
  // After template evaluation the string must still contain \d (written as \\d in source).
  assert.match(
    LARK_CLI_LAUNCHER_SOURCE,
    /\/\^\\d\+\\.\\d\+\\.\\d\+\$\//,
    "LARK_CLI_LAUNCHER_SOURCE must contain /^\\d+\\.\\d+\\.\\d+$/ after template eval",
  );
  assert.match(
    OFFICECLI_LAUNCHER_SOURCE,
    /\/\^\\d\+\\.\\d\+\\.\\d\+\$\//,
    "OFFICECLI_LAUNCHER_SOURCE must contain /^\\d+\\.\\d+\\.\\d+$/ after template eval",
  );
  assert.equal(
    /\^d\+/.test(LARK_CLI_LAUNCHER_SOURCE),
    false,
    "LARK launcher must not use literal d+ version regex",
  );
  assert.equal(
    /\^d\+/.test(OFFICECLI_LAUNCHER_SOURCE),
    false,
    "OfficeCLI launcher must not use literal d+ version regex",
  );
});

test("plugins-page still mounts both recommended CLI cards", () => {
  const page = readRepo(
    "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
  );
  assert.match(page, /OfficeCliPluginCard/);
  assert.match(page, /LarkCliPluginCard/);
  assert.match(page, /from ["']\.\/officecli-plugin["']/);
  assert.match(page, /from ["']\.\/larkcli-plugin["']/);
  assert.match(page, /<OfficeCliPluginCard\s*\/>/);
  assert.match(page, /<LarkCliPluginCard\s*\/>/);
});

test("plugins-page mounts Tencent Docs connector card (no managed-cli download)", () => {
  const page = readRepo(
    "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
  );
  assert.match(page, /TencentDocsPluginCard/);
  assert.match(page, /from ["']\.\/tencent-docs-plugin["']/);
  assert.match(page, /<TencentDocsPluginCard\s*\/>/);

  const manager = readRepo(
    "apps/desktop/electron/tencent-docs-connector/manager.mjs",
  );
  assert.equal(
    manager.includes("managed-cli/"),
    false,
    "tencent-docs manager must not import managed-cli download stack",
  );
  assert.equal(
    existsSync(
      path.join(repoRoot, "apps/desktop/electron/tencent-docs-connector/manager.mjs"),
    ),
    true,
  );
});

test("recommended CLI cards stay inside plugins domain mount surface", () => {
  // Allowed: self module, domain barrel, plugins-page mount only.
  const allow = new Set([
    "apps/app/src/react-app/domains/plugins/officecli-plugin.tsx",
    "apps/app/src/react-app/domains/plugins/larkcli-plugin.tsx",
    "apps/app/src/react-app/domains/plugins/index.ts",
    "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
  ]);
  for (const name of ["officecli-plugin", "larkcli-plugin"]) {
    const importers = findImporters(name);
    const unexpected = importers.filter((p) => !allow.has(p));
    assert.deepEqual(
      unexpected,
      [],
      `${name} leaked outside plugins mount surface: ${unexpected.join(", ")}`,
    );
    assert.equal(
      importers.includes(
        "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
      ),
      true,
      `${name} must still be imported by plugins-page`,
    );
  }
});

test("office and feishu card modules do not cross-import each other", () => {
  const office = readRepo(
    "apps/app/src/react-app/domains/plugins/officecli-plugin.tsx",
  );
  const lark = readRepo(
    "apps/app/src/react-app/domains/plugins/larkcli-plugin.tsx",
  );
  assert.equal(office.includes("larkcli"), false);
  assert.equal(office.includes("lark-cli"), false);
  assert.equal(lark.includes("officecli-plugin"), false);
  // Lark reuses OfficeCli *types* for install status — allowed.
  assert.match(lark, /@onmyagent\/types\/officecli/);
});
