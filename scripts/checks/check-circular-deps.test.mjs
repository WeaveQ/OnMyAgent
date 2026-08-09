import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const checkScript = join(here, "check-circular-deps.mjs");
const repoRoot = join(here, "..", "..");

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [checkScript, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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

test("circular-deps gate passes against frozen baseline on real repo", () => {
  const result = run([], repoRoot);
  assert.equal(
    result.status,
    0,
    `expected gate to pass on committed baseline, got:\n${result.stderr}\n${result.stdout}`,
  );
  assert.match(result.stdout, /Circular dependency check passed/);
});

test("circular-deps gate flags a newly introduced cycle", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "circular-deps-"));
  try {
    // Build a minimal repo layout that matches the scanner's scan roots.
    const srcDir = join(sandbox, "apps/app/src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "a.ts"),
      `import { b } from "./b";\nexport const a = 1;\nvoid b;\n`,
    );
    writeFileSync(
      join(srcDir, "b.ts"),
      `import { a } from "./a";\nexport const b = 2;\nvoid a;\n`,
    );
    // No baseline yet — should fail.
    const fresh = run([], sandbox);
    assert.equal(fresh.status, 1);
    assert.match(fresh.stderr, /New circular dependencies detected/);

    // After writing baseline, it passes.
    const write = run(["--write"], sandbox);
    assert.equal(write.status, 0, write.stderr);
    const baselinePath = join(
      sandbox,
      "scripts/checks/baselines/circular-deps.json",
    );
    assert.ok(existsSync(baselinePath), "baseline file was written");

    const after = run([], sandbox);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /acknowledged cycle/);

    // Breaking the cycle makes the baseline stale, which also fails.
    writeFileSync(
      join(srcDir, "b.ts"),
      `export const b = 2;\n`,
    );
    const stale = run([], sandbox);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /baseline is stale/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
