import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const checkScript = join(here, "check-file-size.mjs");
const repoRoot = join(here, "..", "..");

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [checkScript, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FILE_SIZE_ROOT: cwd },
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

function writeBaseline(root, entries) {
  const dir = join(root, "scripts/checks/baselines");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "file-size.json"), `${JSON.stringify({ entries }, null, 2)}\n`);
}

test("file-size gate passes against frozen baseline on real repo", () => {
  const result = run([], repoRoot);
  assert.equal(
    result.status,
    0,
    `expected gate to pass on committed baseline, got:\n${result.stderr}\n${result.stdout}`,
  );
  assert.match(result.stdout, /file-size baseline OK/);
});

test("file-size gate rejects marketplace / bundled-skill baseline entries", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "file-size-"));
  try {
    const vendorRel = "apps/desktop/resources/marketplace/shared/skills/evolve.js";
    const vendorAbs = join(sandbox, vendorRel);
    mkdirSync(dirname(vendorAbs), { recursive: true });
    writeFileSync(vendorAbs, "console.log(1);\n");
    writeBaseline(sandbox, { [vendorRel]: 1 });

    const result = run([], sandbox);
    assert.equal(result.status, 1);
    assert.match(
      `${result.stderr}\n${result.stdout}`,
      /vendor\/content-pack path is not a file-size target/,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("file-size --write drops vendor paths from the baseline", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "file-size-write-"));
  try {
    const keepRel = "apps/app/src/keep.ts";
    const vendorRel = "apps/desktop/resources/bundled-skills/demo/SKILL.md";
    mkdirSync(dirname(join(sandbox, keepRel)), { recursive: true });
    mkdirSync(dirname(join(sandbox, vendorRel)), { recursive: true });
    writeFileSync(join(sandbox, keepRel), "export const n = 1;\n");
    writeFileSync(join(sandbox, vendorRel), "# skill\n");
    writeBaseline(sandbox, { [keepRel]: 99, [vendorRel]: 99 });

    const written = run(["--write"], sandbox);
    assert.equal(written.status, 0, written.stderr);

    const next = JSON.parse(
      readFileSync(join(sandbox, "scripts/checks/baselines/file-size.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(next.entries), [keepRel]);
    assert.equal(next.entries[keepRel], 1);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("file-size discovery catches a new large source file", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "file-size-discovery-"));
  try {
    const sourceRel = "apps/app/src/new-god-file.ts";
    mkdirSync(dirname(join(sandbox, sourceRel)), { recursive: true });
    writeFileSync(join(sandbox, sourceRel), `${"export const line = 1;\n".repeat(801)}`);
    writeBaseline(sandbox, {});
    mkdirSync(join(sandbox, "scripts/checks/baselines"), { recursive: true });
    writeFileSync(
      join(sandbox, "scripts/checks/baselines/file-size-discovery.json"),
      `${JSON.stringify({ threshold: 800, entries: {} }, null, 2)}\n`,
    );
    const result = run([], sandbox);
    assert.equal(result.status, 1);
    assert.match(`${result.stderr}\n${result.stdout}`, /missing from discovery baseline/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
