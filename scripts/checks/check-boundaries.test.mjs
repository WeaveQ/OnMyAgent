import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const checkScript = join(here, "check-boundaries.mjs");
const repoRoot = join(here, "..", "..");

function run(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [checkScript], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BOUNDARIES_ROOT: cwd },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

test("boundary gate passes on real repo tip", () => {
  const result = run(repoRoot);
  assert.equal(
    result.status,
    0,
    `expected pass on real tree:\n${result.stderr}\n${result.stdout}`,
  );
  assert.match(result.stdout, /Architecture boundary checks passed/);
});

test("orchestrator src cannot import onmyagent-server module (exports server source)", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "boundaries-orch-pkg-"));
  try {
    mkdirSync(join(sandbox, "apps/orchestrator/src"), { recursive: true });
    writeFileSync(
      join(sandbox, "apps/orchestrator/src/leak.ts"),
      `import { startServer } from "onmyagent-server";\nexport { startServer };\n`,
    );
    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /do not import server source/);
    assert.match(result.stderr, /onmyagent-server/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("orchestrator src cannot import apps/server/src", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "boundaries-orch-src-"));
  try {
    mkdirSync(join(sandbox, "apps/orchestrator/src"), { recursive: true });
    writeFileSync(
      join(sandbox, "apps/orchestrator/src/leak.ts"),
      `import { workspaceIdForPath } from "../../server/src/workspace/workspaces.ts";\nexport { workspaceIdForPath };\n`,
    );
    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /do not import server source/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("orchestrator tests may import server source for hash parity", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "boundaries-orch-test-"));
  try {
    mkdirSync(join(sandbox, "apps/orchestrator/tests"), { recursive: true });
    writeFileSync(
      join(sandbox, "apps/orchestrator/tests/parity.test.ts"),
      `import { workspaceIdForPath } from "../../server/src/workspace/workspaces.ts";\nexport { workspaceIdForPath };\n`,
    );
    const result = run(sandbox);
    assert.equal(
      result.status,
      0,
      `tests/ import should be allowed:\n${result.stderr}\n${result.stdout}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("require.resolve of onmyagent-server/package.json is not an import of server source", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "boundaries-orch-resolve-"));
  try {
    mkdirSync(join(sandbox, "apps/orchestrator/src"), { recursive: true });
    writeFileSync(
      join(sandbox, "apps/orchestrator/src/ok.ts"),
      `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport const pkg = require.resolve("onmyagent-server/package.json");\n`,
    );
    const result = run(sandbox);
    assert.equal(
      result.status,
      0,
      `package.json resolve should pass:\n${result.stderr}\n${result.stdout}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
