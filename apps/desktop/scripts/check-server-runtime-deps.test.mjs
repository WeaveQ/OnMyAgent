import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gateScript = resolve(__dirname, "check-server-runtime-deps.mjs");

// The gate runs against <desktopRoot>/server. We point ONMYAGENT_DESKTOP_ROOT
// at a temp desktop fixture containing:
//   server/dist/core/jsonc.js   (imports "jsonc-parser")
//   server/node_modules/<pkg>   (a minimal resolvable package when present)
let fixtureRoot;
let desktopRoot;

function writeFile(rel, content) {
  const full = join(fixtureRoot, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writePackage(pkgDir, name, main = "index.js") {
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main, type: "module" }),
  );
  writeFileSync(join(pkgDir, main), "export default {};\n");
}

function runGate() {
  // Production always invokes this gate with Node (electron-build uses
  // process.execPath = node). Bun's import.meta.resolve resolves bare
  // specifiers globally regardless of parent URL, which would mask a missing
  // dependency — so force Node here to match the real runtime.
  const nodeBin = process.env.NODE || process.execPath.endsWith("bun")
    ? (process.platform === "win32" ? "node.exe" : "node")
    : process.execPath;
  return spawnSync(nodeBin, [gateScript], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: { ...process.env, ONMYAGENT_DESKTOP_ROOT: desktopRoot },
  });
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "oma-server-deps-gate-"));
  desktopRoot = join(fixtureRoot, "desktop");
  mkdirSync(join(desktopRoot, "server", "dist", "core"), { recursive: true });
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("check-server-runtime-deps", () => {
  test("passes when every bare import resolves against staged node_modules", () => {
    writeFile(
      "desktop/server/dist/core/jsonc.js",
      'import { parse } from "jsonc-parser";\nexport const x = parse("{}");\n',
    );
    writePackage(
      join(desktopRoot, "server", "node_modules", "jsonc-parser"),
      "jsonc-parser",
    );

    const result = runGate();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("jsonc-parser");
    expect(result.stdout).toContain("OK");
  });

  test("fails and names the missing package when a bare import cannot resolve", () => {
    writeFile(
      "desktop/server/dist/core/jsonc.js",
      'import { parse } from "jsonc-parser";\nparse("{}");\n',
    );
    // Deliberately do NOT create node_modules/jsonc-parser.

    const result = runGate();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("jsonc-parser");
    expect(result.stderr).toContain("dist/core/jsonc.js");
  });

  test("accepts an ESM-only package subpath export from staged node_modules", () => {
    writeFile(
      "desktop/server/dist/services/client.js",
      'import { createClient } from "@example/sdk/v2/client";\nexport { createClient };\n',
    );
    const pkgDir = join(desktopRoot, "server", "node_modules", "@example", "sdk");
    mkdirSync(join(pkgDir, "dist", "v2"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@example/sdk",
        version: "1.0.0",
        type: "module",
        exports: {
          "./v2/client": { import: "./dist/v2/client.js" },
        },
      }),
    );
    writeFileSync(
      join(pkgDir, "dist", "v2", "client.js"),
      "export const createClient = () => ({});\n",
    );

    const result = runGate();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("@example/sdk/v2/client");
  });

  test("ignores generated plugin-source string literals that quote @opencode-ai/plugin", () => {
    // browser-tool-source.js emits an array of source lines; the host module
    // does not statically import @opencode-ai/plugin, so it must not be flagged.
    writeFile(
      "desktop/server/dist/workspace/browser-tool-source.js",
      [
        'export function source() {',
        '  return [',
        '    \'import { tool } from "@opencode-ai/plugin"\',',
        '  ];',
        '}',
        '',
      ].join("\n"),
    );
    writePackage(
      join(desktopRoot, "server", "node_modules", "jsonc-parser"),
      "jsonc-parser",
    );
    writeFile(
      "desktop/server/dist/core/jsonc.js",
      'import { parse } from "jsonc-parser";\nexport const x = parse("{}");\n',
    );

    const result = runGate();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).not.toContain("@opencode-ai/plugin");
  });

  test("ignores node: and bun: builtins and relative imports", () => {
    writeFile(
      "desktop/server/dist/core/sqlite.js",
      [
        'import { join } from "node:path";',
        'let db;',
        'try { db = require("bun:sqlite"); } catch {}',
        'import { x } from "./utils.js";',
        'export const y = join;',
        '',
      ].join("\n"),
    );
    const result = runGate();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("0 bare specifier");
  });
});
