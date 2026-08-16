import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const checkScript = join(here, "check-session-hub-budget.mjs");
const repoRoot = join(here, "..", "..");

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [checkScript, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SESSION_HUB_ROOT: cwd },
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

function writeBaseline(root, values) {
  const dir = join(root, "scripts/checks/baselines");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session-hub-budget.json"), `${JSON.stringify(values, null, 2)}\n`);
}

function seedSessionTree(root, { sessionFiles = 1, knowledgeFiles = 0, settingsFiles = 1 } = {}) {
  const sessionDir = join(root, "apps/app/src/react-app/domains/session");
  mkdirSync(sessionDir, { recursive: true });
  for (let i = 0; i < sessionFiles; i += 1) {
    writeFileSync(join(sessionDir, `keep-${i}.ts`), `export const n${i} = ${i};\n`);
  }
  if (knowledgeFiles > 0) {
    const knowledgeDir = join(sessionDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    for (let i = 0; i < knowledgeFiles; i += 1) {
      writeFileSync(join(knowledgeDir, `note-${i}.ts`), `export const k${i} = ${i};\n`);
    }
  }
  const settingsDir = join(root, "apps/app/src/react-app/domains/settings");
  mkdirSync(settingsDir, { recursive: true });
  for (let i = 0; i < settingsFiles; i += 1) {
    writeFileSync(join(settingsDir, `pref-${i}.ts`), `export const s${i} = ${i};\n`);
  }
}

test("session-hub gate passes against frozen baseline on real repo", () => {
  const result = run([], repoRoot);
  assert.equal(
    result.status,
    0,
    `expected gate to pass on committed baseline, got:\n${result.stderr}\n${result.stdout}`,
  );
  assert.match(result.stdout, /session-hub budget OK/);
});

test("session-hub gate rejects growth of domains/session file count", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "session-hub-"));
  try {
    seedSessionTree(sandbox, { sessionFiles: 3, knowledgeFiles: 0 });
    writeBaseline(sandbox, { maxSessionFiles: 2, maxSessionKnowledgeFiles: 0, maxSettingsFiles: 10 });

    const result = run([], sandbox);
    assert.equal(result.status, 1);
    assert.match(`${result.stderr}\n${result.stdout}`, /domains\/session: 3 files > baseline max 2/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("session-hub gate rejects new files under session/knowledge", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "session-hub-knowledge-"));
  try {
    seedSessionTree(sandbox, { sessionFiles: 1, knowledgeFiles: 2 });
    writeBaseline(sandbox, { maxSessionFiles: 10, maxSessionKnowledgeFiles: 1, maxSettingsFiles: 10 });

    const result = run([], sandbox);
    assert.equal(result.status, 1);
    assert.match(`${result.stderr}\n${result.stdout}`, /session\/knowledge: 2 files > baseline max 1/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("session-hub gate rejects growth of domains/settings file count", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "settings-hub-"));
  try {
    seedSessionTree(sandbox, { sessionFiles: 1, knowledgeFiles: 0, settingsFiles: 4 });
    writeBaseline(sandbox, { maxSessionFiles: 10, maxSessionKnowledgeFiles: 0, maxSettingsFiles: 2 });

    const result = run([], sandbox);
    assert.equal(result.status, 1);
    assert.match(`${result.stderr}\n${result.stdout}`, /domains\/settings: 4 files > baseline max 2/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("session-hub --write only shrinks the baseline", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "session-hub-write-"));
  try {
    seedSessionTree(sandbox, { sessionFiles: 2, knowledgeFiles: 0, settingsFiles: 2 });
    writeBaseline(sandbox, { maxSessionFiles: 9, maxSessionKnowledgeFiles: 4, maxSettingsFiles: 8 });

    const written = run(["--write"], sandbox);
    assert.equal(written.status, 0, written.stderr);

    const next = JSON.parse(
      readFileSync(join(sandbox, "scripts/checks/baselines/session-hub-budget.json"), "utf8"),
    );
    assert.equal(next.maxSessionFiles, 2);
    assert.equal(next.maxSessionKnowledgeFiles, 0);
    assert.equal(next.maxSettingsFiles, 2);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
